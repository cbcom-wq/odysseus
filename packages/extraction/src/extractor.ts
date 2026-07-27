import type { CardKind } from '@odysseus/domain';
import type { DraftPatch } from './draft.js';
import { needsReviewNote, toDraftPatch } from './draft.js';
import type { PasteInput } from './extract.js';
import type { ExtractedFields } from './schema.js';

/**
 * Somewhere to send a paste and get fields back.
 *
 * There are two ways to reach Claude from this app and they suit different builds. The desktop
 * shell can run the Claude Code CLI that is already installed and already signed in, so a desktop
 * user needs no key and no second subscription. A browser tab cannot start a process, so it calls
 * the API with a key the user supplies.
 *
 * Same split, and the same reasoning, as `Repository`: one interface, a file-backed implementation
 * for the shell and a browser-backed one for the tab. Neither the paste box nor the card editor
 * knows or cares which one it got.
 */
export interface OptionExtractor {
  /** Named for the user, e.g. in "reading that with Claude Code". */
  readonly id: 'cli' | 'api';
  /** Whether this can run at all. False for the API backend with no key saved. */
  readonly ready: boolean;
  extract(input: PasteInput, options: ExtractRequestOptions): Promise<ExtractedFields>;
}

export interface ExtractRequestOptions {
  readonly allowedKinds: readonly CardKind[];
  readonly signal?: AbortSignal;
}

export interface ExtractionOutcome {
  readonly fields: ExtractedFields;
  /** Ready to spread over the editor's draft. */
  readonly patch: Partial<DraftPatch>;
  /** Whether to tell the user to look twice before saving. */
  readonly needsReview: boolean;
  readonly warnings: readonly string[];
}

/**
 * Run a paste through whichever backend is in play and shape the result for the form.
 *
 * The shaping is deliberately out here rather than in each backend: what the fields mean and how
 * they reach the editor should not depend on which way the request travelled.
 */
export async function runExtraction(
  extractor: OptionExtractor,
  input: PasteInput,
  options: ExtractRequestOptions,
): Promise<ExtractionOutcome> {
  const fields = await extractor.extract(input, options);
  const sourceUrl = input.kind === 'url' ? input.url : undefined;

  return {
    fields,
    patch: toDraftPatch(fields, sourceUrl),
    needsReview: needsReviewNote(fields),
    warnings: fields.warnings ?? [],
  };
}
