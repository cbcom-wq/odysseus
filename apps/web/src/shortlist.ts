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
