import type { OptionTiming, Trip } from '@odysseus/domain';
import { linkReturnLeg } from '@odysseus/domain';
import type { ExtractedFields } from '@odysseus/extraction';

/**
 * What an imported round-trip fare does to the rest of the trip.
 *
 * A flight listing quotes the return price against the outbound times, so saving one at face value
 * leaves the trip holding a return fare with no return. The second leg is built here rather than
 * waiting for the traveller to notice.
 *
 * This lives apart from the form because it is the same job whether the listing starts a new card or
 * joins one that already has flights on it. Comparing a second round trip against the first is the
 * ordinary case, and when this ran only for new cards that comparison silently lost its leg home and
 * carried the whole return price on the outbound.
 */

export interface ImportedFare {
  readonly optionId: string;
  /** What the listing said. Null for an option the traveller typed themselves. */
  readonly source: ExtractedFields | null;
}

export interface LinkedImport {
  readonly trip: Trip;
  /** A return leg that went in blank, and so is worth asking the traveller about. */
  readonly promptCardId: string | null;
  /** A fare whose leg home was already spoken for. Its price was left whole. */
  readonly occupied: boolean;
}

export function linkImportedFares(
  trip: Trip,
  cardId: string,
  fares: readonly ImportedFare[],
): LinkedImport {
  let next = trip;
  let promptCardId: string | null = null;
  let occupied = false;

  // Flights only. The leg this builds is a flight, and a round-trip rail fare pasted onto a train
  // card would acquire one called "Return flight" — a slot nobody asked for on a card that is not
  // about flying.
  if (trip.cards.find((c) => c.id === cardId)?.kind !== 'flight') {
    return { trip, promptCardId, occupied };
  }

  // Every round-trip candidate gets its own leg home, so choosing outbound #2 chooses return #2.
  for (const { optionId, source } of fares) {
    if (source?.roundTrip !== true) continue;
    const timing = returnTimingFrom(source);
    const linked = linkReturnLeg(next, cardId, optionId, {
      ...(source.returnDate === null ? {} : { returnDate: source.returnDate }),
      ...(timing === undefined ? {} : { returnTiming: timing }),
    });

    if (linked.kind === 'linked') {
      next = linked.trip;
      // Only ask when the leg went in blank. A checkout page states both legs, and asking for what
      // the traveller just pasted is worse than not asking at all.
      if (!linked.complete) promptCardId = linked.returnCardId;
    } else if (linked.kind === 'occupied') {
      occupied = true;
    }
  }

  return { trip: next, promptCardId, occupied };
}

/**
 * The slice of a listing that describes its return leg. Structural, so both an extraction result
 * and a discovered option's attributes can satisfy it.
 */
export interface ReturnLegFields {
  readonly returnDate: string | null;
  readonly returnDepartTime: string | null;
  readonly returnArriveTime: string | null;
  readonly returnOvernight: boolean | null;
  readonly returnDurationMinutes: number | null;
}

/**
 * The return leg's own timing, when the source gave it.
 *
 * A checkout page states both legs in full. Building a blank placeholder from that would throw away
 * details the traveller can see on screen and then ask them to type it back in. A date is the one
 * thing a journey cannot do without, so without it there is nothing to pin and the leg stays blank.
 */
export function returnTimingFrom(fields: ReturnLegFields): OptionTiming | undefined {
  if (fields.returnDate === null || fields.returnDepartTime === null) return undefined;
  return {
    kind: 'journey',
    departDate: fields.returnDate,
    departTime: fields.returnDepartTime,
    arriveTime: fields.returnArriveTime ?? fields.returnDepartTime,
    nightsInTransit: fields.returnOvernight === true ? 1 : 0,
    durationMinutes: fields.returnDurationMinutes ?? 120,
  };
}
