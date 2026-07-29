import type { Conflict } from './conflicts.js';
import { sortConflicts } from './conflicts.js';
import { toMinutes } from './dates.js';
import { placeCards } from './layout.js';
import type { PlacedCard } from './layout.js';
import type { Schedule } from './scheduler.js';
import type { Trip } from './types.js';

/**
 * Compatibility conflicts: two chosen options that cannot both be true.
 *
 * This is the family users actually hit while comparing. Capacity conflicts (the trip does not fit
 * the time available) come from the scheduler; these come from the specific combination of options
 * currently selected, and they are what makes an alternative *cost* something beyond its price.
 *
 * Nothing here mutates or discards. A conflicting option stays selected and stays visible; the user
 * decides whether the tradeoff is worth it.
 */

/** Slack allowed between arriving somewhere and departing again, in minutes. */
const TRANSFER_BUFFER_MINUTES = 90;

function endMinutes(placed: PlacedCard): number | undefined {
  const t = placed.option.timing;
  if (!t) return undefined;
  if (t.kind === 'slot') return toMinutes(t.endTime);
  if (t.kind === 'journey') return toMinutes(t.arriveTime);
  return undefined;
}

function startMinutes(placed: PlacedCard): number | undefined {
  const t = placed.option.timing;
  if (!t) return undefined;
  if (t.kind === 'slot') return toMinutes(t.startTime);
  if (t.kind === 'journey') return toMinutes(t.departTime);
  return undefined;
}

function label(placed: PlacedCard): string {
  return placed.option.title;
}

export function detectCompatibilityConflicts(trip: Trip, schedule: Schedule): Conflict[] {
  const placed = placeCards(trip, schedule);
  const conflicts: Conflict[] = [];

  conflicts.push(...orphanedCards(trip, placed));
  conflicts.push(...uncoveredNights(trip, schedule, placed));
  conflicts.push(...unlinkedStops(trip, placed));
  conflicts.push(...incompleteLegs(trip, placed));
  conflicts.push(...timingClashes(placed));

  return sortConflicts(conflicts);
}

/**
 * A leg you know you are taking but nothing about.
 *
 * This is the other half of a return fare imported from a listing that only showed the outbound
 * flight. The card exists, so `MISSING_CONNECTION` has gone quiet — creating the placeholder
 * silenced the only warning there was, and something has to take its place.
 *
 * Derived rather than stored: a journey with no timing is incomplete whether it arrived as a
 * placeholder or was typed in half-finished. It pins nothing and floats with the schedule, which is
 * the honest behaviour, but the traveller still needs telling that the schedule is guessing.
 */
function incompleteLegs(trip: Trip, placed: readonly PlacedCard[]): Conflict[] {
  const name = (id: string | null) =>
    id === null ? 'home' : (trip.segments.find((s) => s.id === id)?.location.name ?? 'this stop');

  return placed
    .filter((p) => p.card.anchor.kind === 'connection' && p.option.timing?.kind !== 'journey')
    .map((p) => {
      const id = (p.card.anchor as { connectionId: string }).connectionId;
      const conn = trip.connections.find((c) => c.id === id);
      const route = conn ? ` from ${name(conn.fromSegmentId)} to ${name(conn.toSegmentId)}` : '';
      return {
        code: 'INCOMPLETE_LEG' as const,
        severity: 'warning' as const,
        message: `${label(p)} has no times yet, so the leg${route} is not being scheduled around.`,
        segmentIds: [],
        cardIds: [p.card.id],
        flexible: { segmentIds: [], cardIds: [p.card.id] },
      };
    });
}

/**
 * A stop with no way to reach it.
 *
 * The Structure view says this inline — "No way onward yet" sits right where the leg would be — but
 * a traveller working in the Day view would never see it, and "5 nights in Berlin have nowhere to
 * stay" is a strange thing to be told about a city you also cannot get to.
 */
function unlinkedStops(trip: Trip, placed: readonly PlacedCard[]): Conflict[] {
  const served = new Set(
    placed
      .filter((p) => p.card.anchor.kind === 'connection')
      .map((p) => (p.card.anchor as { connectionId: string }).connectionId),
  );

  const missing = trip.connections.filter((c) => !served.has(c.id));
  if (missing.length === 0) return [];

  const name = (id: string | null) =>
    id === null ? 'home' : (trip.segments.find((s) => s.id === id)?.location.name ?? 'this stop');

  // One conflict for all of them, not one each. A trip that has not been given any travel yet has
  // every leg missing, and a banner per leg is a wall rather than a warning.
  const legs = missing.map((c) => `${name(c.fromSegmentId)} to ${name(c.toSegmentId)}`);
  const segmentIds = [
    ...new Set(
      missing.flatMap((c) => [c.fromSegmentId, c.toSegmentId]).filter((id): id is string => id !== null),
    ),
  ];

  return [
    {
      code: 'MISSING_CONNECTION',
      severity: 'warning',
      message:
        legs.length === 1
          ? `Nothing gets you from ${legs[0]} yet.`
          : `Nothing gets you from ${legs.slice(0, -1).join(', ')}, or ${legs[legs.length - 1]} yet.`,
      segmentIds,
      cardIds: [],
      flexible: { segmentIds, cardIds: [] },
    },
  ];
}

function orphanedCards(trip: Trip, placed: readonly PlacedCard[]): Conflict[] {
  return placed
    .filter((p) => p.orphaned)
    .map((p) => {
      const anchor = p.card.anchor;
      const segmentIds =
        anchor.kind === 'segment-day' || anchor.kind === 'segment' ? [anchor.segmentId] : [];
      const place = trip.segments.find((s) => s.id === segmentIds[0])?.location.name ?? 'the stay';

      // A stay that lost its nights is a different thing from an activity that lost its day, and it
      // has to read like one — with the place named, or the user cannot find what broke.
      const message =
        p.card.kind === 'lodging'
          ? `${label(p)} has no nights left — ${place} got shorter than the night it was due to start on.`
          : `${label(p)} no longer has a day to sit on — the stay got shorter than the day it was planned for.`;

      return {
        code: 'ORPHANED_CARD' as const,
        severity: 'warning' as const,
        message,
        segmentIds,
        cardIds: [p.card.id],
        flexible: { segmentIds, cardIds: [p.card.id] },
      };
    });
}

function uncoveredNights(
  trip: Trip,
  schedule: Schedule,
  placed: readonly PlacedCard[],
): Conflict[] {
  const lodgingNights = new Set<number>();
  for (const p of placed) {
    if (p.card.kind === 'lodging') for (const day of p.days) lodgingNights.add(day);
  }

  const conflicts: Conflict[] = [];
  for (const segment of schedule.segments) {
    if (segment.nights === 0) continue;
    const nights = Array.from({ length: segment.nights }, (_, i) => segment.startDay + i);
    const uncovered = nights.filter((n) => !lodgingNights.has(n));
    if (uncovered.length === 0) continue;

    const location = trip.segments.find((s) => s.id === segment.segmentId)?.location.name ?? 'this stop';
    conflicts.push({
      code: 'UNCOVERED_NIGHT',
      severity: 'warning',
      message:
        `${uncovered.length} night${uncovered.length === 1 ? '' : 's'} in ${location} ` +
        `${uncovered.length === 1 ? 'has' : 'have'} nowhere to stay.`,
      segmentIds: [segment.segmentId],
      cardIds: [],
      flexible: { segmentIds: [segment.segmentId], cardIds: [] },
      detail: { requiredNights: uncovered.length },
    });
  }
  return conflicts;
}

function timingClashes(placed: readonly PlacedCard[]): Conflict[] {
  const byDay = new Map<number, PlacedCard[]>();
  for (const p of placed) {
    for (const day of p.days) {
      // A multi-night stay has no time-of-day to clash with; skip it.
      if (p.option.cost.kind === 'per-night') continue;
      const existing = byDay.get(day);
      if (existing) existing.push(p);
      else byDay.set(day, [p]);
    }
  }

  const conflicts: Conflict[] = [];
  for (const [, sameDay] of [...byDay.entries()].sort((a, b) => a[0] - b[0])) {
    const timed = sameDay
      .filter((p) => startMinutes(p) !== undefined && endMinutes(p) !== undefined)
      .sort((a, b) => startMinutes(a)! - startMinutes(b)! || a.card.id.localeCompare(b.card.id));

    for (let i = 0; i < timed.length; i++) {
      for (let j = i + 1; j < timed.length; j++) {
        const first = timed[i]!;
        const second = timed[j]!;
        const firstEnd = endMinutes(first)!;
        const secondStart = startMinutes(second)!;

        const bothJourneys =
          first.option.timing?.kind === 'journey' && second.option.timing?.kind === 'journey';

        if (bothJourneys) {
          if (secondStart < firstEnd + TRANSFER_BUFFER_MINUTES) {
            conflicts.push({
              code: 'IMPOSSIBLE_TRANSFER',
              severity: 'blocking',
              message:
                `${label(first)} arrives at ${fmt(firstEnd)} and ${label(second)} leaves at ` +
                `${fmt(secondStart)} — not enough time to make the connection.`,
              segmentIds: [],
              cardIds: [first.card.id, second.card.id],
              flexible: { segmentIds: [], cardIds: [first.card.id, second.card.id] },
            });
          }
          continue;
        }

        if (secondStart < firstEnd) {
          // Say what is actually wrong. A journey that lands too late is not "running long", it is
          // one you have not got off yet — and the sentence has to make that obvious without the
          // reader reconstructing it from two timestamps.
          const ends = first.option.timing?.kind === 'journey' ? "doesn't get in until" : 'runs until';
          const starts = second.option.timing?.kind === 'journey' ? 'leaves at' : 'starts at';
          conflicts.push({
            code: 'TIMING_OVERLAP',
            severity: 'warning',
            message:
              `${label(first)} ${ends} ${fmt(firstEnd)}, but ${label(second)} ${starts} ` +
              `${fmt(secondStart)}.`,
            segmentIds: [],
            cardIds: [first.card.id, second.card.id],
            flexible: { segmentIds: [], cardIds: [first.card.id, second.card.id] },
          });
        }
      }
    }
  }
  return conflicts;
}

function fmt(minutes: number): string {
  const h = String(Math.floor(minutes / 60)).padStart(2, '0');
  const m = String(minutes % 60).padStart(2, '0');
  return `${h}:${m}`;
}
