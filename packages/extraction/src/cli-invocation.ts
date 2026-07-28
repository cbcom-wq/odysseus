import type { CardKind } from '@odysseus/domain';
import { FIELD_GUIDE } from './schema.js';

/**
 * How to ask the Claude Code CLI for a card, and how to read its answer.
 *
 * Pure on purpose. Spawning a process is untestable and belongs in the shell; deciding *what* to
 * spawn is full of details that are easy to get wrong and cheap to check, so it lives here.
 *
 * Three of those details cost real money or time when missed:
 *
 * 1. Run somewhere neutral. The CLI loads any CLAUDE.md it finds above the working directory, and
 *    pointed at this repo that is thousands of tokens of project instructions on every paste.
 * 2. Ask for no more tools than the job needs. Each one carries its schema into the prompt; a text
 *    extraction with the full toolset costs about seventeen times one without it.
 * 3. Close stdin. The CLI waits several seconds for piped input that is never coming.
 */

/** Tools each kind of paste actually needs. Text needs none, which is what makes text cheap. */
const TOOLS_FOR: Record<'url' | 'image' | 'text', readonly string[]> = {
  url: ['WebFetch'],
  image: ['Read'],
  text: [],
};

export interface CliRequest {
  readonly kind: 'url' | 'image' | 'text';
  /** The link, the pasted text, or the path of the temporary file holding the screenshot. */
  readonly subject: string;
  readonly allowedKinds: readonly CardKind[];
}

/**
 * The JSON Schema the CLI validates its own answer against.
 *
 * Hand-written rather than generated from the Zod schema: this crosses a process boundary as a
 * command-line argument, so it has to be plain JSON Schema, and keeping it explicit means the shape
 * the CLI is held to is readable in one place.
 */
export function buildJsonSchema(allowedKinds: readonly CardKind[]): unknown {
  const nullableString = { type: ['string', 'null'] };
  const nullableNumber = { type: ['number', 'null'] };
  const nullableBoolean = { type: ['boolean', 'null'] };

  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      kind: { type: ['string', 'null'], enum: [...allowedKinds, null] },
      title: nullableString,
      detail: nullableString,
      amount: nullableNumber,
      perNight: nullableBoolean,
      perTraveler: nullableBoolean,
      // Patterns rather than plain strings: asked for a time, the model will happily answer with a
      // whole ISO timestamp, and the form binds to a `time` input that shows nothing for one.
      departDate: { type: ['string', 'null'], pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
      departTime: { type: ['string', 'null'], pattern: '^\\d{2}:\\d{2}$' },
      arriveTime: { type: ['string', 'null'], pattern: '^\\d{2}:\\d{2}$' },
      overnight: nullableBoolean,
      durationMinutes: nullableNumber,
      startTime: { type: ['string', 'null'], pattern: '^\\d{2}:\\d{2}$' },
      endTime: { type: ['string', 'null'], pattern: '^\\d{2}:\\d{2}$' },
      roundTrip: nullableBoolean,
      returnDate: { type: ['string', 'null'], pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
      confidence: { type: ['string', 'null'], enum: ['high', 'medium', 'low', null] },
      warnings: { type: ['array', 'null'], items: { type: 'string' } },
    },
    required: [
      'kind',
      'title',
      'detail',
      'amount',
      'perNight',
      'perTraveler',
      'departDate',
      'departTime',
      'arriveTime',
      'overnight',
      'durationMinutes',
      'startTime',
      'endTime',
      'roundTrip',
      'returnDate',
      'confidence',
      'warnings',
    ],
  };
}

export function buildPrompt(request: CliRequest): string {
  const task =
    request.kind === 'url'
      ? `Fetch this page and extract the travel option it describes.\n\n${request.subject}`
      : request.kind === 'image'
        ? `Read the image at ${request.subject}. It is a screenshot of a travel listing. Extract ` +
          'what is legible; leave anything cut off or blurred as null and note it in warnings.'
        : `Extract the travel option described here.\n\n${request.subject}`;

  return `You read travel listings and pull out the few facts a trip planner needs to compare one
against another. The answer fills a form the traveller is about to check, so being wrong is worse
than being empty: report only what the source states, and use null for the rest.

${FIELD_GUIDE}

${task}`;
}

/** Arguments for `claude`, in order. The prompt is passed separately so it can be quoted once. */
export function buildCliArgs(request: CliRequest): string[] {
  const tools = TOOLS_FOR[request.kind];

  return [
    '--print',
    '--output-format',
    'json',
    '--json-schema',
    JSON.stringify(buildJsonSchema(request.allowedKinds)),
    // Extraction is short and mechanical. The cheap model does it correctly and the difference is
    // felt on every paste.
    '--model',
    'sonnet',
    ...(tools.length > 0
      ? ['--allowedTools', tools.join(','), '--permission-mode', 'acceptEdits']
      : ['--allowedTools', '']),
  ];
}

export class CliUnavailableError extends Error {
  constructor(message = 'Claude Code is not installed, or not on the PATH.') {
    super(message);
    this.name = 'CliUnavailableError';
  }
}

export class CliFailedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CliFailedError';
  }
}

/**
 * Pull the fields out of what the CLI printed.
 *
 * `--output-format json` wraps the answer in a result envelope; `--json-schema` puts the validated
 * answer on `structured_output`. Anything else means the run did not get that far, and the
 * envelope's own error is more use than a parse failure.
 */
export function parseCliOutput(stdout: string): unknown {
  let envelope: unknown;
  try {
    envelope = JSON.parse(stdout);
  } catch {
    throw new CliFailedError('Claude Code returned something that was not JSON.');
  }

  if (typeof envelope !== 'object' || envelope === null) {
    throw new CliFailedError('Claude Code returned an unexpected result.');
  }

  const record = envelope as Record<string, unknown>;
  if (record['is_error'] === true) {
    const reason = typeof record['result'] === 'string' ? record['result'] : 'Claude Code failed.';
    throw new CliFailedError(reason);
  }

  const structured = record['structured_output'];
  if (structured === undefined || structured === null) {
    throw new CliFailedError('Claude Code did not return the fields.');
  }

  return structured;
}
