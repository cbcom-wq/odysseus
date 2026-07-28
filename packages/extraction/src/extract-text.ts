import type Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import type { CardKind } from '@odysseus/domain';
import { EXTRACTION_EFFORT, EXTRACTION_MODEL } from './client.js';
import { RefusalError } from './errors.js';
import { FIELD_GUIDE, buildExtractionSchema } from './schema.js';
import type { ExtractedBatch } from './schema.js';

/**
 * The one extractor.
 *
 * Text pasted from a listing, text lifted off a screenshot, and text fetched from a link all end up
 * here. Keeping a single call means the three paste routes cannot drift into extracting different
 * things from the same words.
 */

const SYSTEM = `
You read travel listings — flights, trains, hotels, tours, restaurant bookings — and pull out the
few facts a trip planner needs to compare one against another.

You are filling in a form the traveller is about to check, so being wrong is worse than being empty.
Report only what the source actually states. Anything it does not say is null.

${FIELD_GUIDE}
`.trim();

export interface ExtractOptions {
  readonly allowedKinds: readonly CardKind[];
  readonly signal?: AbortSignal;
}

/**
 * Run the extraction over whatever content blocks were assembled.
 *
 * Shared by the text and screenshot routes, which differ only in what they put in front of the
 * instruction — a block of text in one case, an image in the other.
 */
export async function runStructuredCall(
  client: Anthropic,
  content: Anthropic.ContentBlockParam[],
  { allowedKinds, signal }: ExtractOptions,
): Promise<ExtractedBatch> {
  const schema = buildExtractionSchema(allowedKinds);

  const response = await client.messages.parse(
    {
      model: EXTRACTION_MODEL,
      max_tokens: 2048,
      system: SYSTEM,
      output_config: {
        effort: EXTRACTION_EFFORT,
        format: zodOutputFormat(schema),
      },
      messages: [{ role: 'user', content }],
    },
    signal ? { signal } : {},
  );

  // A refusal comes back as a perfectly successful response with nothing in it, so it has to be
  // checked before the output is read rather than caught.
  if (response.stop_reason === 'refusal') {
    throw new RefusalError(response.stop_details?.category ?? null);
  }

  const parsed = response.parsed_output;
  if (!parsed) throw new Error('The response did not contain the expected fields.');

  return parsed as ExtractedBatch;
}

export function extractFromText(
  client: Anthropic,
  text: string,
  options: ExtractOptions,
): Promise<ExtractedBatch> {
  return runStructuredCall(
    client,
    [
      { type: 'text', text: 'Here is the listing:' },
      { type: 'text', text },
    ],
    options,
  );
}
