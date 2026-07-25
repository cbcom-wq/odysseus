import type { Schedule } from './scheduler.js';
import type { Card, Connection, Option, Trip } from './types.js';

/**
 * Where each card lands once the schedule is resolved.
 *
 * Both the budget and conflict detection need this, and they must agree: a cost charged to a day the
 * user cannot see, or a conflict reported against a day that does not exist, are the same bug.
 */

export interface PlacedCard {
  readonly card: Card;
  readonly option: Option;
  /** Day indices the card occupies. Empty when the card has been orphaned by a reflow. */
  readonly days: readonly number[];
  /** True when the card points at a day its segment no longer reaches. */
  readonly orphaned: boolean;
}

export function selectedOption(card: Card): Option | undefined {
  if (card.selectedOptionId === undefined) return undefined;
  return card.options.find((o) => o.id === card.selectedOptionId);
}

/** The day each connection's travel happens on: the boundary between the segments it joins. */
export function connectionDays(trip: Trip, schedule: Schedule): Map<string, number> {
  const byId = new Map(schedule.segments.map((s) => [s.segmentId, s]));
  const days = new Map<string, number>();

  for (const connection of trip.connections) {
    if (connection.fromSegmentId === null) {
      days.set(connection.id, 0);
      continue;
    }
    const from = byId.get(connection.fromSegmentId);
    if (from) days.set(connection.id, from.startDay + from.nights);
  }
  return days;
}

export function placeCards(trip: Trip, schedule: Schedule): PlacedCard[] {
  const byId = new Map(schedule.segments.map((s) => [s.segmentId, s]));
  const connDays = connectionDays(trip, schedule);
  const placed: PlacedCard[] = [];

  for (const card of trip.cards) {
    const option = selectedOption(card);
    if (!option) continue;

    switch (card.anchor.kind) {
      case 'segment': {
        const segment = byId.get(card.anchor.segmentId);
        if (!segment) continue;
        placed.push({
          card,
          option,
          days: Array.from({ length: segment.nights }, (_, i) => segment.startDay + i),
          orphaned: false,
        });
        break;
      }
      case 'segment-day': {
        const segment = byId.get(card.anchor.segmentId);
        if (!segment) continue;
        const orphaned = card.anchor.dayOffset >= segment.nights;
        placed.push({
          card,
          option,
          days: orphaned ? [] : [segment.startDay + card.anchor.dayOffset],
          orphaned,
        });
        break;
      }
      case 'connection': {
        const day = connDays.get(card.anchor.connectionId);
        if (day === undefined) continue;
        placed.push({ card, option, days: [day], orphaned: false });
        break;
      }
    }
  }

  return placed;
}

export function connectionFor(trip: Trip, card: Card): Connection | undefined {
  if (card.anchor.kind !== 'connection') return undefined;
  const id = card.anchor.connectionId;
  return trip.connections.find((c) => c.id === id);
}
