import type Anthropic from '@anthropic-ai/sdk';
import type { DraftPatch } from './draft.js';
import { needsReviewNote, toDraftPatch } from './draft.js';
import type { ScreenshotMediaType } from './extract-image.js';
import { extractFromImage } from './extract-image.js';
import type { ExtractOptions } from './extract-text.js';
import { extractFromText } from './extract-text.js';
import { extractFromUrl } from './extract-url.js';
import type { ExtractedFields } from './schema.js';

/**
 * One way in, whatever was pasted.
 *
 * The three routes differ in how they reach the words and not in what they do with them, so the
 * interface should not have to care which one ran. It hands over a paste and gets back fields to
 * put in the form.
 */

export type PasteInput =
  | { readonly kind: 'url'; readonly url: string }
  | { readonly kind: 'image'; readonly base64: string; readonly mediaType: ScreenshotMediaType }
  | { readonly kind: 'text'; readonly text: string };

export interface ExtractionOutcome {
  readonly fields: ExtractedFields;
  /** Ready to spread over the editor's draft. */
  readonly patch: Partial<DraftPatch>;
  /** Whether to tell the user to look twice before saving. */
  readonly needsReview: boolean;
  readonly warnings: readonly string[];
}

export async function extractFromPaste(
  client: Anthropic,
  input: PasteInput,
  options: ExtractOptions,
): Promise<ExtractionOutcome> {
  const fields = await run(client, input, options);
  const sourceUrl = input.kind === 'url' ? input.url : undefined;

  return {
    fields,
    patch: toDraftPatch(fields, sourceUrl),
    needsReview: needsReviewNote(fields),
    warnings: fields.warnings ?? [],
  };
}

function run(
  client: Anthropic,
  input: PasteInput,
  options: ExtractOptions,
): Promise<ExtractedFields> {
  switch (input.kind) {
    case 'url':
      return extractFromUrl(client, input.url, options);
    case 'image':
      return extractFromImage(
        client,
        { base64: input.base64, mediaType: input.mediaType },
        options,
      );
    case 'text':
      return extractFromText(client, input.text, options);
  }
}
