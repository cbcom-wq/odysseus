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
 * How long a journey really takes, door to door.
 *
 * A timetable measures the vehicle; a traveller pays for the trip to the airport, the bag drop, and
 * the ride into town at the far end. Ignoring that made a 07:40 flight look like it starts at 07:40
 * rather than at the 05:30 alarm it actually requires, and rewarded exactly the options a person
 * would refuse. Ground transport gets a smaller allowance because stations are central and you can
 * turn up minutes before.
 */
const TRANSFER_BUFFER: Readonly<Record<'flight' | 'ground', { before: number; after: number }>> = {
  flight: { before: 120, after: 60 },
  ground: { before: 30, after: 15 },
};

/**
 * What an hour of travel outside waking hours costs: the same as any other hour, up to a limit.
 *
 * Treating those hours as free is how a night coach came to cost nothing at all and how a 05:40
 * start scored better than a 09:00 one. Anything short of parity keeps that incentive alive in
 * miniature — a discount for taking the time out of sleep rather than out of the day — so there is
 * no discount. A night on a bus is not a night's sleep.
 *
 * The cap is what keeps that honest at long-haul scale. A night charged minute for minute against a
 * budget of waking hours can take more out of a day than the day ever contained, which drove
 * red-eyes below zero and flattened the difference between them. A badly disrupted night costs
 * you a chunk of the next day; it cannot cost you more than that.
 */
const REST_COST = 1;
const REST_COST_CAP = 4 * 60;

/**
 * Checked out, bags in hand, waiting for a later train.
 *
 * The hours between hotel checkout and departure are not a day in the city — that is the whole
 * reason an evening train "costs you the day" even though it leaves the night count untouched.
 * Discounted rather than written off: you can still see something, just not with a suitcase.
 */
const CHECKOUT = 11 * 60;
const LIMBO_COST = 0.5;

const END_OF_DAY = 24 * 60;

/**
 * Waking hours actually available at destinations.
 *
 * A full day at a destination contributes the whole waking window. A travel day contributes only
 * what is left after the journey, the padding either side of it, the rest it costs when it runs
 * through the night, and the time spent checked out waiting to leave. This is the number behind
 * "gains you an evening in Amsterdam" — and, just as importantly, behind "that cheap late train
 * costs you one".
 */
function usableHours(trip: Trip, s: Schedule): number {
  const dayStart = toMinutes(trip.preferences.dayStart);
  const dayEnd = toMinutes(trip.preferences.dayEnd);
  const windowMinutes = Math.max(0, dayEnd - dayStart);

  /** Waking minutes a block of travel consumes. */
  const overlap = (from: number, to: number) =>
    Math.max(0, Math.min(to, dayEnd) - Math.max(from, dayStart));
  /** Sleeping minutes it consumes — the part of the block outside the waking window. */
  const unsocial = (from: number, to: number) => Math.max(0, to - from) - overlap(from, to);

  let total = s.totalDays * windowMinutes;

  for (const { card, option, days } of placeCards(trip, s)) {
    const timing = option.timing;
    if (timing?.kind !== 'journey' || days.length === 0) continue;

    const buffer = TRANSFER_BUFFER[card.kind === 'flight' ? 'flight' : 'ground'];
    const depart = Math.max(0, toMinutes(timing.departTime) - buffer.before);
    const arrive = Math.min(END_OF_DAY, toMinutes(timing.arriveTime) + buffer.after);

    // An overnight leg eats the rest of the departure day and the morning it lands on. That arrival
    // morning is where the difference between a 09:50 and an 11:35 landing actually lives — without
    // it, two red-eyes score identically and the panel has nothing to say.
    const blocks: readonly [number, number][] =
      timing.nightsInTransit === 0
        ? [[depart, arrive]]
        : [
            [depart, END_OF_DAY],
            [0, arrive],
          ];

    for (const [from, to] of blocks) total -= overlap(from, to);
    const rest = blocks.reduce((sum, [from, to]) => sum + unsocial(from, to), 0);
    total -= Math.min(rest, REST_COST_CAP) * REST_COST;

    // Time on a travel day is only usable if you are somewhere to use it. On the inbound leg the
    // hours before departure are spent at home and in an airport, not at the destination; on the
    // return leg the hours after landing are spent back home. Leaving a stop you have been staying
    // at is the in-between case: you are still in the city, but you are checked out of it.
    const connection = connectionFor(trip, card);
    if (connection?.fromSegmentId === null) total -= overlap(dayStart, depart);
    else total -= overlap(Math.max(CHECKOUT, dayStart), depart) * LIMBO_COST;

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

  // A booked card refuses the swap, but it must not refuse the *question*. "It's locked, but show
  // me what I'd be giving up" is precisely what a commitment makes worth asking, and answering it
  // with zeroes would claim a $98 and a $228 hotel cost the same. Evaluate against a hypothetically
  // unlocked copy so the numbers stay true; the warning is what stops anyone acting on them.
  const inert = !mayMutate(card.state);
  const baseline: Trip = inert
    ? { ...trip, cards: trip.cards.map((c) => (c.id === cardId ? { ...c, state: 'locked' } : c)) }
    : trip;

  for (const option of card.options) {
    const isCurrent = option.id === card.selectedOptionId;
    const candidate = isCurrent ? baseline : applyOption(baseline, cardId, option.id);
    if (!candidate) continue;

    const impact = diffTrips(baseline, candidate);
    const blocking = impact.conflictsIntroduced.find((c) => c.severity === 'blocking');
    const conflict = blocking ?? impact.conflictsIntroduced[0];
    const warning = inert && !isCurrent
      ? 'This card is booked. Unlock it to switch to this.'
      : conflict?.message;

    ranked.push({
      option,
      impact,
      score: scoreImpact(impact, trip.preferences.ranking),
      isCurrent,
      ...(warning ? { warning } : {}),
    });
  }

  // Best first. Stable on option id so equal-scoring alternatives do not shuffle between renders.
  return ranked.sort((a, b) => b.score - a.score || a.option.id.localeCompare(b.option.id));
}
