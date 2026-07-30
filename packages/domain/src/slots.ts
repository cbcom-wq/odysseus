import { stayNights } from './layout.js';
import type { Schedule } from './scheduler.js';
import { staysInOrder } from './stays.js';
import type { Card, CardKind, Trip } from './types.js';

/**
 * What the trip is made of, slot by slot.
 *
 * The panel needs a standing account of the trip's open questions, not just of the cards that
 * happen to exist — a leg with nothing on it is the most important thing the panel can say, and
 * `placeCards` deliberately cannot see it (it skips anything with nothing chosen).
 *
 * Derived, never stored, for the same reason the day grid is: a slot list that could disagree with
 * the schedule would be a second source of truth about the shape of the trip.
 *
 * A connection is one slot however it is filled. A flight and a train are two answers to "how do we
 * get there", not two questions, so the cards on a leg are returned whatever their kind and it is
 * the caller's tab that decides what a search should ask for.
 */

export interface ConnectionSlot {
  readonly id: string;
  readonly connectionId: string;
  /** Null at the ends of the trip, where the other endpoint is an unmodelled home. */
  readonly fromName: string | null;
  readonly toName: string | null;
  /** Every card on this leg, whatever its kind. */
  readonly cards: readonly Card[];
}

export interface StaySlot {
  readonly id: string;
  readonly segmentId: string;
  readonly placeName: string;
  /** Nights this stay actually covers, which a split makes different from the stop's length. */
  readonly nights: number;
  readonly card: Card | undefined;
}

/** Everything of one sort attached to one stop, which is as much structure as these kinds have. */
export interface StopGroup {
  readonly id: string;
  readonly segmentId: string;
  readonly placeName: string;
  readonly cards: readonly Card[];
}

export interface TripSlots {
  readonly connections: readonly ConnectionSlot[];
  readonly stays: readonly StaySlot[];
  readonly localTransport: readonly StopGroup[];
  readonly activities: readonly StopGroup[];
}

const ACTIVITY_KINDS: ReadonlySet<CardKind> = new Set<CardKind>(['activity', 'dining', 'note']);

export function tripSlots(trip: Trip, schedule: Schedule): TripSlots {
  const placeOf = (id: string | null): string | null =>
    id === null ? null : (trip.segments.find((s) => s.id === id)?.location.name ?? null);

  const connections: ConnectionSlot[] = trip.connections.map((conn) => ({
    id: `connection:${conn.id}`,
    connectionId: conn.id,
    fromName: placeOf(conn.fromSegmentId),
    toName: placeOf(conn.toSegmentId),
    cards: trip.cards.filter(
      (c) => c.anchor.kind === 'connection' && c.anchor.connectionId === conn.id,
    ),
  }));

  const nights = stayNights(trip, schedule);
  const stays: StaySlot[] = [];
  const localTransport: StopGroup[] = [];
  const activities: StopGroup[] = [];

  for (const scheduled of schedule.segments) {
    const segmentId = scheduled.segmentId;
    const placeName = trip.segments.find((s) => s.id === segmentId)?.location.name ?? segmentId;

    const staying = staysInOrder(trip, segmentId);
    if (staying.length === 0) {
      // A stop the schedule gives no nights has nothing to cover, so it is not an open question.
      if (scheduled.nights > 0) {
        stays.push({
          id: `stay:${segmentId}`,
          segmentId,
          placeName,
          nights: scheduled.nights,
          card: undefined,
        });
      }
    } else {
      for (const card of staying) {
        stays.push({
          id: `stay:${card.id}`,
          segmentId,
          placeName,
          nights: nights.get(card.id)?.length ?? 0,
          card,
        });
      }
    }

    localTransport.push({
      id: `stop:${segmentId}`,
      segmentId,
      placeName,
      cards: trip.cards.filter(
        (c) =>
          c.kind === 'transport' &&
          c.anchor.kind === 'segment-day' &&
          c.anchor.segmentId === segmentId,
      ),
    });

    activities.push({
      id: `stop:${segmentId}`,
      segmentId,
      placeName,
      cards: trip.cards.filter(
        (c) =>
          ACTIVITY_KINDS.has(c.kind) &&
          (c.anchor.kind === 'segment-day' || c.anchor.kind === 'segment') &&
          c.anchor.segmentId === segmentId,
      ),
    });
  }

  return { connections, stays, localTransport, activities };
}
