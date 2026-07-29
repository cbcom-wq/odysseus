import { addDays, connectionDays, connectionFor, schedule } from '@odysseus/domain';
import type { Card, CardKind, Trip } from '@odysseus/domain';

/**
 * Everything a search needs to know about a card's slot, read off the trip.
 *
 * Pure assembly: the scheduler already knows the dates, the segments already know the places, and
 * the card already holds whatever the user has gathered. The one thing the model genuinely cannot
 * state is home — the trip starts when you leave it and ends when you get back, but no field says
 * where it is. The endpoints of the trip therefore go out with a null origin or destination, and
 * `hints` (the titles and details of options already on the card) carry what the trip cannot.
 */
export interface SearchQuery {
  readonly cardKind: CardKind;
  /** Null only on the homeward leg, where the destination is an unmodelled home. */
  readonly destination: string | null;
  readonly destinationCode: string | null;
  /** Null on the inbound leg, and for anything anchored to a stay rather than a leg. */
  readonly origin: string | null;
  readonly startDate: string | null;
  readonly endDate: string | null;
  readonly nights: number | null;
  /** Set only while the trip is undated and carries a window — a dated trip searches its dates. */
  readonly windowEarliest: string | null;
  readonly windowLatest: string | null;
  readonly lengthMin: number | null;
  readonly lengthMax: number | null;
  readonly travelers: number;
  readonly currency: string;
  readonly hints: readonly string[];
}

const MAX_HINTS = 10;

/** What this card's slot asks of the world, or undefined when it asks nothing searchable. */
export function buildSearchQuery(trip: Trip, card: Card): SearchQuery | undefined {
  if (card.kind === 'note') return undefined;

  const sched = schedule(trip);
  // The window matters only while nothing dates the trip. Once a flight or a declared date pins the
  // calendar, hunting across the window would search dates the trip can no longer take.
  const flexible = sched.startDate === undefined && trip.dateWindow !== undefined;

  const base = {
    cardKind: card.kind,
    travelers: trip.travelers,
    currency: trip.currency,
    hints: card.options
      .flatMap((o) => [o.title, o.detail])
      .filter((s): s is string => typeof s === 'string' && s !== '')
      .slice(0, MAX_HINTS),
    windowEarliest: flexible ? trip.dateWindow!.earliest : null,
    windowLatest: flexible ? trip.dateWindow!.latest : null,
    lengthMin: flexible ? trip.length.min : null,
    lengthMax: flexible ? trip.length.max : null,
  };

  if (card.anchor.kind === 'segment' || card.anchor.kind === 'segment-day') {
    const segmentId = card.anchor.segmentId;
    const seg = trip.segments.find((s) => s.id === segmentId);
    const placed = sched.segments.find((s) => s.segmentId === segmentId);
    if (!seg || !placed) return undefined;

    const start = placed.startDate;
    const where = {
      destination: seg.location.name,
      destinationCode: seg.location.code ?? null,
      origin: null,
    };

    if (card.anchor.kind === 'segment-day') {
      return {
        ...base,
        ...where,
        startDate: start === undefined ? null : addDays(start, card.anchor.dayOffset),
        endDate: null,
        nights: null,
      };
    }
    return {
      ...base,
      ...where,
      startDate: start ?? null,
      endDate: start === undefined ? null : addDays(start, placed.nights),
      nights: placed.nights,
    };
  }

  const conn = connectionFor(trip, card);
  if (!conn) return undefined;

  const endpoint = (id: string | null) =>
    id === null ? undefined : trip.segments.find((s) => s.id === id);
  const from = endpoint(conn.fromSegmentId);
  const to = endpoint(conn.toSegmentId);

  const day = connectionDays(trip, sched).get(conn.id);
  const date =
    sched.startDate === undefined || day === undefined ? null : addDays(sched.startDate, day);

  return {
    ...base,
    destination: to?.location.name ?? null,
    destinationCode: to?.location.code ?? null,
    origin: from?.location.name ?? null,
    startDate: date,
    endDate: null,
    nights: null,
  };
}
