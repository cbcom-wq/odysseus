import { addCard, nextCardId } from '@odysseus/domain';
import type { Card, Option, Trip } from '@odysseus/domain';

/**
 * Accepting one candidate from a "things to do" search.
 *
 * A museum, a beach day and a food tour are not three answers to one question, so they never become
 * competing options on one card. Each is its own slot in the trip, and which day it happens on is
 * the traveller's to say — the search cannot know.
 */

/**
 * Put one candidate on the trip as its own activity card.
 *
 * Null when the stop is gone: the shortlist sits around while the trip stays live, and re-creating
 * a stop the traveller deleted would be worse than losing the candidate.
 *
 * The option is selected, unlike one that lands from a slot search. Nothing was decided *for* the
 * traveller here — they picked this thing and named the day it happens on, which is the same act as
 * typing it in by hand.
 */
export function addCandidate(
  trip: Trip,
  candidate: Option,
  segmentId: string,
  dayOffset: number,
): Trip | null {
  if (!trip.segments.some((s) => s.id === segmentId)) return null;

  const id = nextCardId(trip);
  const optionId = `${id}-opt-1`;
  const card: Card = {
    id,
    kind: 'activity',
    state: 'exploring',
    anchor: { kind: 'segment-day', segmentId, dayOffset },
    options: [{ ...candidate, id: optionId }],
    selectedOptionId: optionId,
  };
  return addCard(trip, card);
}

/**
 * Re-key a batch of found candidates so their ids are unique to this search.
 *
 * A "things to do" search runs against a throwaway card (`findThingsToDo` in `App.tsx` builds one
 * with id `'pending'` and no options, just to shape the query) and `discoveredOptions` mints its
 * option ids against *that* card, not against the trip. Every activities search therefore produces
 * the same `pending-opt-1`, `pending-opt-2`, … no matter what it actually found. `CandidateRow` is
 * keyed on `candidate.id`, so a second search whose results carry the same ids as the first makes
 * React reuse the same row instances — and the day already chosen on the old candidate survives
 * onto whichever different activity the new search put in its place. That is exactly the "no
 * default" invariant `CandidateRow`'s day picker exists to protect, so it is fixed here, before the
 * results ever reach state, rather than by teaching the component about a quirk of where its ids
 * came from.
 *
 * Safe to rewrite: a shortlist id is a UI key, nothing more. `addCandidate` renumbers the option
 * again against the card it actually lands on (`${cardId}-opt-1`), so nothing downstream ever reads
 * the id minted here.
 */
export function stampCandidates(
  found: readonly Option[],
  segmentId: string,
  batch: number,
): readonly Option[] {
  return found.map((option, index) => ({ ...option, id: `${segmentId}-search${batch}-${index}` }));
}
