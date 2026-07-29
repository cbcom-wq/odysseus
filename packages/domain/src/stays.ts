import type { Card, Trip } from './types.js';

/**
 * The order lodging is slept in.
 *
 * Where you sleep is decided per place, not per night: one hotel is one decision covering the whole
 * stay. A split records only where the next stay *starts*, never where one ends, so the last stay
 * always runs to the end of the place and reflow needs no rule of its own.
 *
 * Both the layout and the scheduler need this ordering and they must agree on it — a stay the
 * scheduler treats as last while the layout gives its nights to something else would let a booked
 * hotel set a length it does not actually cover.
 */

/** The night of a stay a lodging starts on, counted from arrival. */
export function startNight(card: Card): number {
  if (card.anchor.kind !== 'segment') return 0;
  return Math.max(card.anchor.fromNight ?? 0, 0);
}

/**
 * A stop's lodging, in the order it is slept in.
 *
 * Card id breaks ties so the same trip always resolves the same way. Determinism is not cosmetic
 * here: option ranking diffs two schedules, and an unstable order would turn every diff into noise.
 */
export function staysInOrder(trip: Trip, segmentId: string): readonly Card[] {
  return trip.cards
    .filter(
      (c) =>
        c.kind === 'lodging' && c.anchor.kind === 'segment' && c.anchor.segmentId === segmentId,
    )
    .sort((a, b) => startNight(a) - startNight(b) || a.id.localeCompare(b.id));
}

/**
 * The stay that runs to the end of the place.
 *
 * When two stays claim the same night the one already there keeps it, so the tail is the *first*
 * card at the latest start — not the last one in the list.
 */
export function tailStay(trip: Trip, segmentId: string): Card | undefined {
  const stays = staysInOrder(trip, segmentId);
  const last = stays[stays.length - 1];
  if (!last) return undefined;
  const latest = startNight(last);
  return stays.find((c) => startNight(c) === latest);
}
