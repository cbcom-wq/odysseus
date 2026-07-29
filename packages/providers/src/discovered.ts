import { nextOptionId } from '@odysseus/domain';
import type { Card, CardKind, Option, OptionTiming } from '@odysseus/domain';

/**
 * Turning what a search found into options a card can hold.
 *
 * The field shape is a structural twin of extraction's `DiscoveredFields` — this package describes
 * candidates for cards and should not depend on the machinery that fetched them, the same reason
 * the persistence bridge speaks in plain strings.
 */
export interface DiscoveredOptionFields {
  readonly kind: string | null;
  readonly title: string | null;
  readonly detail: string | null;
  readonly amount: number | null;
  readonly perNight: boolean | null;
  readonly perTraveler: boolean | null;
  readonly departDate: string | null;
  readonly departTime: string | null;
  readonly arriveTime: string | null;
  readonly overnight: boolean | null;
  readonly durationMinutes: number | null;
  readonly startTime: string | null;
  readonly endTime: string | null;
  readonly roundTrip: boolean | null;
  readonly returnDate: string | null;
  readonly returnDepartTime: string | null;
  readonly returnArriveTime: string | null;
  readonly returnOvernight: boolean | null;
  readonly returnDurationMinutes: number | null;
  readonly confidence: 'high' | 'medium' | 'low' | null;
  readonly warnings: readonly string[] | null;
  readonly sourceUrl: string;
  readonly sourceName: string | null;
}

const JOURNEY_KINDS: readonly CardKind[] = ['flight', 'transport'];
const SLOT_KINDS: readonly CardKind[] = ['activity', 'dining'];

/**
 * Costs in this model are for the whole party; a per-traveller price is multiplied out here.
 * Same arithmetic as the form's `partyAmount` (CardEditor.tsx), which binds string drafts and so
 * cannot be shared directly — including the rounding back to cents, because 1304.05 × 3 lands on
 * 3912.1499999999996 in floating point and a stored price must not disagree with itself.
 */
function partyPrice(amount: number, perTraveler: boolean | null, travelers: number): number {
  if (perTraveler !== true) return amount;
  return Math.round(amount * Math.max(1, travelers) * 100) / 100;
}

/**
 * Timing per kind, mirroring the form's `timingFrom`, defaults included.
 *
 * Lodging deliberately gets none: a search result is a property and a nightly rate, not a
 * reservation with dates — the stay follows the schedule, exactly like a hand-typed hotel.
 */
function timingFor(kind: CardKind, f: DiscoveredOptionFields): OptionTiming | undefined {
  if (JOURNEY_KINDS.includes(kind)) {
    if (f.departDate === null) return undefined;
    return {
      kind: 'journey',
      departDate: f.departDate,
      departTime: f.departTime ?? '09:00',
      arriveTime: f.arriveTime ?? '12:00',
      nightsInTransit: f.overnight === true ? 1 : 0,
      durationMinutes: f.durationMinutes ?? 120,
    };
  }
  if (SLOT_KINDS.includes(kind) && f.startTime !== null) {
    return { kind: 'slot', startTime: f.startTime, endTime: f.endTime ?? f.startTime };
  }
  return undefined;
}

/**
 * The round-trip facts ride along in `attributes`, so a provider can keep returning plain
 * `Option[]` while the app layer builds the second leg — `linkReturnLeg` needs the trip, which a
 * provider result does not have.
 */
/**
 * What the source would not vouch for.
 *
 * Not optional detail. A live lodging search returned five real hotels whose every price was a
 * "starting from" figure for dates other than the ones asked for — and said so. Dropped, those
 * become quotes the traveller has no reason to doubt, which is the opposite of what this app is
 * for. Joined into one string because `attributes` holds scalars.
 */
function caveatAttributes(
  f: DiscoveredOptionFields,
): Record<string, string | number | boolean> | undefined {
  const warnings = (f.warnings ?? []).filter((w) => w !== '');
  const confidence = f.confidence;
  if (warnings.length === 0 && confidence === null) return undefined;
  return {
    ...(confidence === null ? {} : { confidence }),
    ...(warnings.length === 0 ? {} : { warnings: warnings.join(' · ') }),
  };
}

function roundTripAttributes(
  f: DiscoveredOptionFields,
): Record<string, string | number | boolean> | undefined {
  if (f.roundTrip !== true) return undefined;
  return {
    roundTrip: true,
    ...(f.returnDate === null ? {} : { returnDate: f.returnDate }),
    ...(f.returnDepartTime === null ? {} : { returnDepartTime: f.returnDepartTime }),
    ...(f.returnArriveTime === null ? {} : { returnArriveTime: f.returnArriveTime }),
    ...(f.returnOvernight === null ? {} : { returnOvernight: f.returnOvernight }),
    ...(f.returnDurationMinutes === null ? {} : { returnDurationMinutes: f.returnDurationMinutes }),
  };
}

/**
 * Convert a batch of search results into options for a card.
 *
 * Ids are minted against the card as it stands, so they cannot collide with anything already there —
 * whatever the merge later keeps or discards.
 */
export function discoveredOptions(
  card: Card,
  batch: readonly DiscoveredOptionFields[],
  travelers: number,
): readonly Option[] {
  const options: Option[] = [];
  let idSource = card;

  for (const f of batch) {
    const id = nextOptionId(idSource);
    const timing = timingFor(card.kind, f);
    const attributes = { ...caveatAttributes(f), ...roundTripAttributes(f) };
    const detail = [f.detail, f.sourceName].filter((s) => s !== null && s !== '').join(' — ');

    const option: Option = {
      id,
      source: 'discovered',
      title: f.title ?? 'Found option',
      ...(detail === '' ? {} : { detail }),
      cost: {
        kind: f.perNight === true ? 'per-night' : 'fixed',
        amount: partyPrice(Math.max(0, f.amount ?? 0), f.perTraveler, travelers),
      },
      ...(timing === undefined ? {} : { timing }),
      sourceUrl: f.sourceUrl,
      ...(Object.keys(attributes).length === 0 ? {} : { attributes }),
    };

    options.push(option);
    idSource = { ...idSource, options: [...idSource.options, option] };
  }

  return options;
}
