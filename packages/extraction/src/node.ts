import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CardKind } from '@odysseus/domain';
import type { CliRequest } from './cli-invocation.js';
import {
  CliFailedError,
  CliUnavailableError,
  buildCliArgs,
  buildPrompt,
  parseCliOutput,
} from './cli-invocation.js';
import { buildExtractionSchema } from './schema.js';
import type { ExtractedBatch } from './schema.js';

/**
 * Running the Claude Code CLI.
 *
 * Node only, and only ever reached from the desktop shell's main process — the renderer is
 * sandboxed and has no business starting processes. Everything about *what* to run is in
 * `cli-invocation.ts` and tested there; this file is the part that cannot be tested without a
 * machine, and it is kept small for that reason.
 */

/** Long enough for a page fetch plus a screenshot read; short enough that a wedged run gives up. */
const TIMEOUT_MS = 120_000;

/** Answers can be a few kB. A runaway one should fail rather than be held in memory. */
const MAX_OUTPUT_BYTES = 4 * 1024 * 1024;

export interface CliExtractionRequest {
  readonly kind: 'url' | 'image' | 'text';
  /** Link, pasted text, or base64 image data depending on `kind`. */
  readonly payload: string;
  /** Required for images, ignored otherwise. */
  readonly mediaType?: string;
  readonly allowedKinds: readonly CardKind[];
}

function extensionFor(mediaType: string | undefined): string {
  switch (mediaType) {
    case 'image/jpeg':
      return '.jpg';
    case 'image/gif':
      return '.gif';
    case 'image/webp':
      return '.webp';
    default:
      return '.png';
  }
}

/**
 * Run `claude` and hand back what it printed.
 *
 * Two rules here are load-bearing, and the first one is a security boundary:
 *
 * The prompt goes in over **stdin**, never as an argument, and there is deliberately no `shell`
 * option. The prompt contains whatever the user pasted, and `shell: true` concatenates arguments
 * into a command line without escaping them — a listing containing shell metacharacters would run
 * as a command. Passing the prompt over stdin means it is never parsed by anything. It also dodges
 * the Windows command-line length limit, which a long screenshot or a wall of pasted text would
 * otherwise blow straight past.
 *
 * The arguments that remain carry no user input: fixed flags, and a schema built from a closed set
 * of card kinds.
 */
function runClaude(prompt: string, args: string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      'claude',
      args,
      { cwd, timeout: TIMEOUT_MS, maxBuffer: MAX_OUTPUT_BYTES, windowsHide: true },
      (error, stdout, stderr) => {
        if (!error) return resolve(stdout);

        const code = (error as NodeJS.ErrnoException).code;
        if (code === 'ENOENT') return reject(new CliUnavailableError());

        // A non-zero exit with a parseable envelope on stdout is a failed extraction, not a broken
        // install — let the parser report what the CLI actually said.
        if (stdout.trim().startsWith('{')) return resolve(stdout);

        reject(new CliFailedError(stderr.trim() || error.message));
      },
    );

    child.stdin?.on('error', () => {
      // The process died before it read anything; the exit handler above reports why.
    });
    child.stdin?.end(prompt);
  });
}

/**
 * Extract fields from a paste using the locally installed Claude Code.
 *
 * The work happens in a fresh temporary directory. That is not tidiness: the CLI reads any
 * CLAUDE.md above its working directory, and running this inside a project would prepend that
 * project's instructions to every paste.
 */
export async function extractWithCli(
  request: CliExtractionRequest,
): Promise<ExtractedBatch> {
  const workdir = await mkdtemp(join(tmpdir(), 'odysseus-extract-'));

  try {
    let subject = request.payload;

    if (request.kind === 'image') {
      // The CLI reads images from disk, so the screenshot has to land somewhere first. It goes in
      // the same throwaway directory and dies with it.
      const file = join(workdir, `${randomUUID()}${extensionFor(request.mediaType)}`);
      await writeFile(file, Buffer.from(request.payload, 'base64'));
      subject = file;
    }

    const cliRequest: CliRequest = {
      kind: request.kind,
      subject,
      allowedKinds: request.allowedKinds,
    };

    const stdout = await runClaude(
      buildPrompt(cliRequest),
      buildCliArgs(cliRequest),
      workdir,
    );

    // Validated twice on purpose: the CLI checks its own answer against the JSON Schema, and this
    // side checks it against the schema the form actually needs. They should agree; if they ever
    // stop agreeing, failing here is better than writing junk into someone's trip.
    return buildExtractionSchema(request.allowedKinds).parse(
      parseCliOutput(stdout),
    ) as ExtractedBatch;
  } finally {
    await rm(workdir, { recursive: true, force: true }).catch(() => {
      // A leftover temp directory is not worth failing a paste over.
    });
  }
}
