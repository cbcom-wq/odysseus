import { linkReturnLeg, nextOptionId, removeOption } from '@odysseus/domain';
import type { Option, Trip } from '@odysseus/domain';
import { mergeOptions } from '@odysseus/providers';
import { returnTimingFrom } from './import-fares.js';
import type { ReturnLegFields } from './import-fares.js';

/**
 * Landing a search's results on a card.
 *
 * `mergeOptions` alone is not enough, and the gap is round trips: a discovered fare's leg home
 * lives on a *different* card, which the merge never sees. Replacing last search's options without
 * first removing them properly would strand their half-priced return legs on the homeward card
 * forever. So: remove every previously fetched option through `removeOption` (which takes fare
 * partners with it), merge, then build return legs for the new arrivals.
 */

export interface DiscoveryOutcome {
  readonly trip: Trip;
  /** How many options the search added, for the notice. */
  readonly added: number;
  /** A return leg that went in blank, and so is worth asking the traveller about. */
  readonly promptCardId: string | null;
  /** A fare whose leg home was already spoken for. Its price was left whole. */
  readonly occupied: boolean;
}

/** The round-trip facts a discovered option carries in `attributes`, back in field shape. */
function returnFields(option: Option): ReturnLegFields {
  const attrs = option.attributes ?? {};
  const str = (v: unknown) => (typeof v === 'string' ? v : null);
  const num = (v: unknown) => (typeof v === 'number' ? v : null);
  const bool = (v: unknown) => (typeof v === 'boolean' ? v : null);
  return {
    returnDate: str(attrs['returnDate']),
    returnDepartTime: str(attrs['returnDepartTime']),
    returnArriveTime: str(attrs['returnArriveTime']),
    returnOvernight: bool(attrs['returnOvernight']),
    returnDurationMinutes: num(attrs['returnDurationMinutes']),
  };
}

export function applyDiscovery(
  trip: Trip,
  cardId: string,
  found: readonly Option[],
): DiscoveryOutcome {
  const card = trip.cards.find((c) => c.id === cardId);
  if (!card) return { trip, added: 0, promptCardId: null, occupied: false };

  // Out with the old, whole fares at a time. Everything fetched goes — discovered and fixture
  // alike — because the merge below replaces both, and a fixture round trip has partners too.
  let next = trip;
  for (const option of card.options) {
    if (option.source !== 'user') next = removeOption(next, cardId, option.id);
  }

  const cleaned = next.cards.find((c) => c.id === cardId)!;

  // Re-number against the card as it is *now*. The search minted these ids minutes ago, against the
  // card as it was when the button was clicked, and the app stayed live in between — an option the
  // traveller added while waiting has already taken the number this one is carrying. Two options
  // sharing an id is not cosmetic: every lookup is a `find`, so choosing one would choose the other.
  let idSource = cleaned;
  const landed: Option[] = [];
  for (const option of found) {
    const renumbered = { ...option, id: nextOptionId(idSource) };
    landed.push(renumbered);
    idSource = { ...idSource, options: [...idSource.options, renumbered] };
  }

  const merged = mergeOptions(cleaned, landed);

  // Candidates and no decision *is* exploring, and a card holding five of them while reading
  // "unplanned" tells the traveller something untrue. Only that one step is automatic: anything
  // further along was decided by them, and a search is not entitled to undo it.
  const withState =
    merged.state === 'unplanned' && merged.options.length > 0
      ? { ...merged, state: 'exploring' as const }
      : merged;
  next = { ...next, cards: next.cards.map((c) => (c.id === cardId ? withState : c)) };

  // Round-trip fares get their leg home, provenance intact. Flights only — the same guard as the
  // paste flow, for the same reason: the built leg is a flight.
  let promptCardId: string | null = null;
  let occupied = false;
  if (card.kind === 'flight') {
    for (const option of landed) {
      if (option.attributes?.['roundTrip'] !== true) continue;
      const fields = returnFields(option);
      const timing = returnTimingFrom(fields);
      const linked = linkReturnLeg(next, cardId, option.id, {
        ...(fields.returnDate === null ? {} : { returnDate: fields.returnDate }),
        ...(timing === undefined ? {} : { returnTiming: timing }),
        source: 'discovered',
      });

      if (linked.kind === 'linked') {
        next = linked.trip;
        if (!linked.complete) promptCardId = linked.returnCardId;
      } else if (linked.kind === 'occupied') {
        occupied = true;
      }
    }
  }

  return { trip: next, added: found.length, promptCardId, occupied };
}
