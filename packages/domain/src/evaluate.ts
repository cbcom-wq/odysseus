import { computeBudget } from './budget.js';
import { detectCompatibilityConflicts } from './compatibility.js';
import type { Conflict } from './conflicts.js';
import { toMinutes } from './dates.js';
import { connectionFor, placeCards } from './layout.js';
import { schedule } from './scheduler.js';
import type { Schedule } from './scheduler.js';
import { mayMutate } from './state.js';
import type { IsoDate, Option, RankingPreset, Trip } from './types.js';

/**
 * Option evaluation: what does this candidate do to the *whole trip*?
 *
 * Ranking an alternative by its own price is what every booking site already does, and precisely
 * what this workspace exists not to do. A flight that costs $40 more but saves a hotel night is
 * cheaper. A cheap one landing at 23:00 costs an evening. Neither fact is visible from the option.
 *
 * The mechanism is deliberately dumb: apply the candidate to a copy of the trip, run the real
 * scheduler, and diff. There is no separate estimation model, so the preview cannot drift from what
 * the user gets after swapping. That only holds because `domain` is pure and deterministic — which
 * is what purity.test.ts is there to defend.
 */

export interface TripImpact {
  readonly costDelta: number;
  readonly transitTimeDelta: number;
  /** Nights the whole trip gains or loses. A red-eye and a morning flight differ by a night away. */
  readonly tripNightsDelta: number;
  /** Waking hours at a destination rather than in transit. Turns a timestamp into a reason. */
  readonly usableHoursDelta: number;
  readonly conflictsIntroduced: readonly Conflict[];
  readonly conflictsResolved: readonly Conflict[];
  readonly cardsOrphaned: readonly string[];
  readonly scheduleShift: readonly SegmentDateChange[];
}

export interface SegmentDateChange {
  readonly segmentId: string;
  readonly fromDate?: IsoDate;
  readonly toDate?: IsoDate;
  readonly fromNights: number;
  readonly toNights: number;
}

export interface RankedOption {
  readonly option: Option;
  readonly impact: TripImpact;
  readonly score: number;
  /** Set when the option would break something. Demoted, never hidden. */
  readonly warning?: string;
  readonly isCurrent: boolean;
}

/** Apply an option without touching the original. Returns undefined if the swap is not allowed. */
export function applyOption(trip: Trip, cardId: string, optionId: string): Trip | undefined {
  const card = trip.cards.find((c) => c.id === cardId);
  if (!card || !mayMutate(card.state)) return undefined;
  if (!card.options.some((o) => o.id === optionId)) return undefined;

  return {
    ...trip,
    cards: trip.cards.map((c) => (c.id === cardId ? { ...c, selectedOptionId: optionId } : c)),
  };
}

function conflictKey(c: Conflict): string {
  return `${c.code}|${[...c.cardIds].sort().join(',')}|${[...c.segmentIds].sort().join(',')}`;
}

function allConflicts(trip: Trip, s: Schedule): Conflict[] {
  return [...s.conflicts, ...detectCompatibilityConflicts(trip, s)];
}

/**
 * Waking hours actually available at destinations.
 *
 * A full day at a destination contributes the whole waking window. A travel day contributes only
 * the part of that window not spent in transit. This is the number behind "gains you an evening in
 * Amsterdam" — a flight landing at 11:35 instead of 19:00 does not merely arrive earlier, it hands
 * back usable time the user can plan into.
 */
function usableHours(trip: Trip, s: Schedule): number {
  const dayStart = toMinutes(trip.preferences.dayStart);
  const dayEnd = toMinutes(trip.preferences.dayEnd);
  const windowMinutes = Math.max(0, dayEnd - dayStart);
  const overlap = (from: number, to: number) =>
    Math.max(0, Math.min(to, dayEnd) - Math.max(from, dayStart));

  let total = s.totalDays * windowMinutes;

  for (const { card, option, days } of placeCards(trip, s)) {
    const timing = option.timing;
    if (timing?.kind !== 'journey' || days.length === 0) continue;

    const depart = toMinutes(timing.departTime);
    const arrive = toMinutes(timing.arriveTime);

    if (timing.nightsInTransit === 0) {
      total -= overlap(depart, arrive);
    } else {
      // An overnight leg eats the rest of the departure day and the morning it lands on. That
      // arrival morning is where the difference between a 09:50 and an 11:35 landing actually
      // lives — without it, two red-eyes score identically and the panel has nothing to say.
      total -= overlap(depart, dayEnd);
      total -= overlap(dayStart, arrive);
    }

    // Time on a travel day is only usable if you are somewhere to use it. On the inbound leg the
    // hours before departure are spent at home and in an airport, not at the destination; on the
    // return leg the hours after landing are spent back home.
    const connection = connectionFor(trip, card);
    if (connection?.fromSegmentId === null) total -= overlap(dayStart, depart);
    if (connection?.toSegmentId === null) {
      total -= overlap(timing.nightsInTransit === 0 ? arrive : dayStart, dayEnd);
    }
  }

  return total / 60;
}

function transitMinutes(trip: Trip, s: Schedule): number {
  let total = 0;
  for (const { option, days } of placeCards(trip, s)) {
    if (option.timing?.kind === 'journey' && days.length > 0) {
      total += option.timing.durationMinutes;
    }
  }
  return total;
}

function orphanedIds(trip: Trip, s: Schedule): string[] {
  return placeCards(trip, s)
    .filter((p) => p.orphaned)
    .map((p) => p.card.id);
}

export function diffTrips(before: Trip, after: Trip): TripImpact {
  const scheduleBefore = schedule(before);
  const scheduleAfter = schedule(after);

  const budgetBefore = computeBudget(before, scheduleBefore);
  const budgetAfter = computeBudget(after, scheduleAfter);

  const conflictsBefore = allConflicts(before, scheduleBefore);
  const conflictsAfter = allConflicts(after, scheduleAfter);
  const keysBefore = new Set(conflictsBefore.map(conflictKey));
  const keysAfter = new Set(conflictsAfter.map(conflictKey));

  const nightsBefore = new Map(scheduleBefore.segments.map((s) => [s.segmentId, s]));
  const scheduleShift: SegmentDateChange[] = [];
  for (const after_ of scheduleAfter.segments) {
    const before_ = nightsBefore.get(after_.segmentId);
    if (!before_) continue;
    if (before_.startDate === after_.startDate && before_.nights === after_.nights) continue;
    scheduleShift.push({
      segmentId: after_.segmentId,
      ...(before_.startDate === undefined ? {} : { fromDate: before_.startDate }),
      ...(after_.startDate === undefined ? {} : { toDate: after_.startDate }),
      fromNights: before_.nights,
      toNights: after_.nights,
    });
  }

  const orphanedBefore = new Set(orphanedIds(before, scheduleBefore));

  return {
    costDelta: budgetAfter.total - budgetBefore.total,
    tripNightsDelta: scheduleAfter.totalNights - scheduleBefore.totalNights,
    transitTimeDelta: transitMinutes(after, scheduleAfter) - transitMinutes(before, scheduleBefore),
    usableHoursDelta: usableHours(after, scheduleAfter) - usableHours(before, scheduleBefore),
    conflictsIntroduced: conflictsAfter.filter((c) => !keysBefore.has(conflictKey(c))),
    conflictsResolved: conflictsBefore.filter((c) => !keysAfter.has(conflictKey(c))),
    cardsOrphaned: orphanedIds(after, scheduleAfter).filter((id) => !orphanedBefore.has(id)),
    scheduleShift,
  };
}

/**
 * Weights per preset. These are the Budget Style control from the Explorer mockup.
 *
 * Deliberately visible and few. A ranking the user cannot reason about is a ranking they will not
 * trust, and the panel shows the raw deltas regardless — the score only orders the list.
 */
const WEIGHTS: Readonly<Record<RankingPreset, { cost: number; usableHours: number; transit: number }>> =
  {
    'best-value': { cost: 1, usableHours: 8, transit: 0.02 },
    balanced: { cost: 1, usableHours: 20, transit: 0.05 },
    comfort: { cost: 1, usableHours: 45, transit: 0.15 },
  };

/** Penalty large enough to sink an option below any honest alternative, without hiding it. */
const CONFLICT_PENALTY = 10_000;

export function scoreImpact(impact: TripImpact, preset: RankingPreset): number {
  const w = WEIGHTS[preset];
  let score = 0;

  score -= impact.costDelta * w.cost;
  score += impact.usableHoursDelta * w.usableHours;
  score -= impact.transitTimeDelta * w.transit;

  const blocking = impact.conflictsIntroduced.filter((c) => c.severity === 'blocking').length;
  const warnings = impact.conflictsIntroduced.filter((c) => c.severity === 'warning').length;
  score -= blocking * CONFLICT_PENALTY;
  score -= warnings * (CONFLICT_PENALTY / 10);
  score += impact.conflictsResolved.length * (CONFLICT_PENALTY / 20);
  score -= impact.cardsOrphaned.length * (CONFLICT_PENALTY / 10);

  return score;
}

/**
 * Rank every option on a card by what it would do to the trip.
 *
 * The currently selected option is included, scoring zero by definition — it is the baseline
 * everything else is measured against, and seeing it in the list is what makes the deltas legible.
 */
export function rankOptions(trip: Trip, cardId: string): RankedOption[] {
  const card = trip.cards.find((c) => c.id === cardId);
  if (!card) return [];

  const ranked: RankedOption[] = [];

  for (const option of card.options) {
    const isCurrent = option.id === card.selectedOptionId;
    const candidate = isCurrent ? trip : applyOption(trip, cardId, option.id);

    // A booked card refuses mutation, so nothing can be evaluated against it. Alternatives are
    // still listed — locking never hides them — they simply carry no impact until it is unlocked.
    if (!candidate) {
      ranked.push({
        option,
        impact: emptyImpact(),
        score: 0,
        isCurrent,
        warning: 'This card is booked. Unlock it to compare alternatives.',
      });
      continue;
    }

    const impact = diffTrips(trip, candidate);
    const blocking = impact.conflictsIntroduced.find((c) => c.severity === 'blocking');
    const warning = blocking ?? impact.conflictsIntroduced[0];

    ranked.push({
      option,
      impact,
      score: scoreImpact(impact, trip.preferences.ranking),
      isCurrent,
      ...(warning ? { warning: warning.message } : {}),
    });
  }

  // Best first. Stable on option id so equal-scoring alternatives do not shuffle between renders.
  return ranked.sort((a, b) => b.score - a.score || a.option.id.localeCompare(b.option.id));
}

function emptyImpact(): TripImpact {
  return {
    costDelta: 0,
    tripNightsDelta: 0,
    transitTimeDelta: 0,
    usableHoursDelta: 0,
    conflictsIntroduced: [],
    conflictsResolved: [],
    cardsOrphaned: [],
    scheduleShift: [],
  };
}
