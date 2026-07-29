import type { CardKind } from '@odysseus/domain';
import { z } from 'zod';
import type { ExtractedFields } from './schema.js';
import { buildOptionSchema } from './schema.js';

/**
 * What a search brings back: the same fields a paste yields, plus where each one was found.
 *
 * Extraction reads a source the user already chose, so provenance is the paste itself. A search
 * chooses its own sources, which makes attribution part of the answer: an option the model cannot
 * tie to a page it visited is not reportable, however plausible it sounds.
 */
export interface DiscoveredFields extends ExtractedFields {
  /** The page this option was found on. Carried on the card, never re-fetched. */
  readonly sourceUrl: string;
  /** The site a traveller would say they found it on, e.g. "Booking.com". */
  readonly sourceName: string | null;
}

export interface DiscoveredBatch {
  readonly options: readonly DiscoveredFields[];
}

/**
 * The Zod schema a search result must satisfy.
 *
 * Two deliberate differences from the extraction schema it extends:
 *
 * - `sourceUrl` is required and must be a real web page, for the reason above.
 * - The list may be empty. A paste that yields nothing is a failure to report; a search that finds
 *   nothing is an answer, and forcing at least one item would force an invented one.
 *
 * `kind` is pinned to the single kind of the card being searched — the slot already decided.
 */
export function buildSearchResultSchema(kind: CardKind) {
  const option = buildOptionSchema([kind]).extend({
    sourceUrl: z.string().regex(/^https?:\/\//),
    sourceName: z.string().nullable(),
  });

  return z.object({ options: z.array(option) });
}
