import type { Conflict } from './conflicts.js';
import { sortConflicts } from './conflicts.js';
import { addDays, daysBetween, fromDayNumber, toDayNumber } from './dates.js';
import type { Card, IsoDate, Option, Trip } from './types.js';

/**
 * The scheduler: turn an authored trip structure into concrete days.
 *
 * The whole problem collapses to one observation. Define boundaries B_0..B_k, where B_i is the
 * first night of segment i and B_k is the trip's end. Then:
 *
 *     B_{i+1} = B_i + nights_i + transitNights_i
 *
 * and *every* constraint a chosen option imposes — an inbound flight, a train between cities, a
 * booked hotel, a return leg — reduces to the same statement: "boundary B_j falls on date D_j".
 *
 * So scheduling is: distribute nights across the spans between pinned boundaries, respecting each
 * segment's [min, max]. No general constraint solver, and every decision stays explainable.
 *
 * Pins come from *option timing*, never from planning state. An Exploring flight lands at a
 * specific hour exactly as a Booked one does.
 */

export type NightsReason =
  | 'ideal'
  | 'at-minimum'
  | 'at-maximum'
  | 'compressed-to-fit'
  | 'expanded-to-fit'
  | 'pinned-by-option';

export interface ScheduledSegment {
  readonly segmentId: string;
  readonly nights: number;
  /** 0-based day index from the start of the trip. Always present, dated or not. */
  readonly startDay: number;
  /** Absent when nothing pins the trip to the calendar. */
  readonly startDate?: IsoDate;
  readonly reason: NightsReason;
  readonly pinnedBy?: string;
}

export interface Schedule {
  readonly segments: readonly ScheduledSegment[];
  readonly totalNights: number;
  readonly totalDays: number;
  readonly startDate?: IsoDate;
  readonly conflicts: readonly Conflict[];
}

function selectedOption(card: Card): Option | undefined {
  if (card.selectedOptionId === undefined) return undefined;
  return card.options.find((o) => o.id === card.selectedOptionId);
}

/**
 * A boundary fixed to a date, and what fixed it.
 *
 * `cardId: null` means the trip's own `anchorDate` — the user's declared start. It pins like any
 * other constraint, but yields to a card: a real flight beats a tentative date.
 */
interface Pin {
  readonly boundary: number;
  readonly date: IsoDate;
  readonly cardId: string | null;
}

interface Constraints {
  readonly pins: readonly Pin[];
  /** Nights spent in transit in the gap *before* segment i. */
  readonly transitBefore: readonly number[];
  /** Segment lengths forced by a fixed stay, keyed by segment index. */
  readonly forced: ReadonlyMap<number, { nights: number; cardId: string }>;
  readonly conflicts: readonly Conflict[];
}

function gatherConstraints(trip: Trip): Constraints {
  const segmentIndex = new Map(trip.segments.map((s, i) => [s.id, i]));
  const connections = new Map(trip.connections.map((c) => [c.id, c]));

  const pins: Pin[] = [];
  const transitBefore = new Array<number>(trip.segments.length + 1).fill(0);
  const forced = new Map<number, { nights: number; cardId: string }>();
  const conflicts: Conflict[] = [];

  for (const card of trip.cards) {
    const option = selectedOption(card);
    if (!option?.timing) continue;

    if (option.timing.kind === 'journey' && card.anchor.kind === 'connection') {
      const conn = connections.get(card.anchor.connectionId);
      if (!conn) continue;

      const { departDate, nightsInTransit } = option.timing;

      // The boundary this leg governs: the start of the segment it arrives at, or the trip's end
      // for a return leg.
      const boundary =
        conn.toSegmentId === null
          ? trip.segments.length
          : (segmentIndex.get(conn.toSegmentId) ?? -1);
      if (boundary < 0) continue;

      if (boundary < transitBefore.length) transitBefore[boundary] = nightsInTransit;
      pins.push({ boundary, date: addDays(departDate, nightsInTransit), cardId: card.id });
    }

    if (option.timing.kind === 'stay' && card.anchor.kind === 'segment') {
      const index = segmentIndex.get(card.anchor.segmentId);
      if (index === undefined) continue;

      const { checkIn, checkOut } = option.timing;
      pins.push({ boundary: index, date: checkIn, cardId: card.id });
      forced.set(index, { nights: daysBetween(checkIn, checkOut), cardId: card.id });
    }
  }

  return { pins, transitBefore, forced, conflicts: [...conflicts, ...detectPinClashes(pins)] };
}

function detectPinClashes(pins: readonly Pin[]): Conflict[] {
  const byBoundary = new Map<number, Pin[]>();
  for (const pin of pins) {
    const existing = byBoundary.get(pin.boundary);
    if (existing) existing.push(pin);
    else byBoundary.set(pin.boundary, [pin]);
  }

  const conflicts: Conflict[] = [];
  for (const group of byBoundary.values()) {
    const dates = new Set(group.map((p) => p.date));
    if (dates.size <= 1) continue;

    const sorted = [...dates].sort();
    const cardIds = group.map((p) => p.cardId).filter((id): id is string => id !== null);
    conflicts.push({
      code: 'CONTRADICTORY_PINS',
      severity: 'blocking',
      message: `Two choices disagree about the same date: ${sorted.join(' and ')}. One of them has to give.`,
      segmentIds: [],
      cardIds,
      flexible: { segmentIds: [], cardIds },
      detail: { from: sorted[0]!, to: sorted[sorted.length - 1]! },
    });
  }
  return conflicts;
}

/**
 * Hand out `slack` units across `weights`, capped, by largest remainder.
 *
 * Largest-remainder with a lowest-index tiebreak is what makes scheduling deterministic, which
 * everything downstream depends on: option ranking diffs two schedules, and an unstable scheduler
 * would turn every diff into noise.
 */
function allocate(slack: number, weights: readonly number[], caps: readonly number[]): number[] {
  const n = weights.length;
  const result = new Array<number>(n).fill(0);
  if (slack <= 0 || n === 0) return result;

  // All segments equally happy at their minimum: spread evenly rather than favouring the first.
  const total = weights.reduce((a, b) => a + b, 0);
  const effective = total > 0 ? weights : new Array<number>(n).fill(1);
  const effectiveTotal = total > 0 ? total : n;

  const remainders: { index: number; remainder: number }[] = [];
  let assigned = 0;

  for (let i = 0; i < n; i++) {
    const exact = (slack * effective[i]!) / effectiveTotal;
    const floored = Math.min(caps[i]!, Math.floor(exact));
    result[i] = floored;
    assigned += floored;
    remainders.push({ index: i, remainder: exact - floored });
  }

  remainders.sort((a, b) => b.remainder - a.remainder || a.index - b.index);

  let leftover = slack - assigned;
  while (leftover > 0) {
    const eligible = remainders.filter(({ index }) => result[index]! < caps[index]!);
    if (eligible.length === 0) break; // capped out; caller reports EXCESS_TIME
    for (const { index } of eligible) {
      if (leftover === 0) break;
      result[index]!++;
      leftover--;
    }
  }

  return result;
}

interface SpanResult {
  readonly nights: readonly number[];
  readonly conflict?: Conflict;
}

/** Distribute `available` nights across one run of segments. */
function fillSpan(
  trip: Trip,
  from: number,
  to: number,
  available: number,
  forced: Constraints['forced'],
  pinCardIds: readonly string[],
): SpanResult {
  const segments = trip.segments.slice(from, to);
  const bounds = segments.map((s, i) => {
    const force = forced.get(from + i);
    return force
      ? { min: force.nights, max: force.nights, ideal: force.nights }
      : { min: s.duration.min, max: s.duration.max, ideal: s.duration.ideal };
  });

  const minSum = bounds.reduce((a, b) => a + b.min, 0);
  const maxSum = bounds.reduce((a, b) => a + b.max, 0);
  const ids = segments.map((s) => s.id);

  // "Flexible" means room to move *from where a segment ended up*, not room in its declared range.
  // In both failure cases below every segment is already pinned against the wall — at its minimum
  // when time is short, at its maximum when there is too much — so no duration here can absorb the
  // difference. Reporting that honestly is what points the user at the pinned legs instead of at
  // durations they cannot usefully change.

  if (available < minSum) {
    return {
      nights: bounds.map((b) => b.min),
      conflict: {
        code: 'INSUFFICIENT_TIME',
        severity: 'blocking',
        message:
          `${describeSpan(segments.map((s) => s.location.name))} need at least ${minSum} ` +
          `night${minSum === 1 ? '' : 's'}, but only ${available} ` +
          `${available === 1 ? 'is' : 'are'} available.`,
        segmentIds: ids,
        cardIds: pinCardIds,
        flexible: { segmentIds: [], cardIds: pinCardIds },
        detail: { availableNights: available, requiredNights: minSum },
      },
    };
  }

  if (available > maxSum) {
    return {
      nights: bounds.map((b) => b.max),
      conflict: {
        code: 'EXCESS_TIME',
        severity: 'warning',
        message:
          `${describeSpan(segments.map((s) => s.location.name))} can absorb at most ${maxSum} ` +
          `night${maxSum === 1 ? '' : 's'}, leaving ${available - maxSum} unaccounted for.`,
        segmentIds: ids,
        cardIds: pinCardIds,
        flexible: { segmentIds: [], cardIds: pinCardIds },
        detail: { availableNights: available, requiredNights: maxSum },
      },
    };
  }

  const extra = allocate(
    available - minSum,
    bounds.map((b) => Math.max(0, b.ideal - b.min)),
    bounds.map((b) => b.max - b.min),
  );
  return { nights: bounds.map((b, i) => b.min + extra[i]!) };
}

function describeSpan(names: readonly string[]): string {
  if (names.length === 0) return 'This span';
  if (names.length === 1) return names[0]!;
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

function reasonFor(
  nights: number,
  duration: { min: number; ideal: number; max: number },
  forced: boolean,
): NightsReason {
  if (forced) return 'pinned-by-option';
  if (nights === duration.ideal) return 'ideal';
  if (nights === duration.min) return 'at-minimum';
  if (nights === duration.max) return 'at-maximum';
  return nights < duration.ideal ? 'compressed-to-fit' : 'expanded-to-fit';
}

export function schedule(trip: Trip): Schedule {
  const { pins, transitBefore, forced, conflicts: setupConflicts } = gatherConstraints(trip);
  const conflicts: Conflict[] = [...setupConflicts];
  const count = trip.segments.length;

  if (count === 0) {
    return { segments: [], totalNights: 0, totalDays: 0, conflicts: sortConflicts(conflicts) };
  }

  // One authoritative date per boundary. Contradictions are already reported above; take the
  // earliest so the rest of the schedule still resolves and the user sees a whole trip.
  const pinned = new Map<number, Pin>();
  for (const pin of pins) {
    const existing = pinned.get(pin.boundary);
    if (!existing || pin.date < existing.date) pinned.set(pin.boundary, pin);
  }

  // The declared trip start pins B_0 too, unless a card already speaks for it. Without this a
  // downstream pin would back-compute the first segment's start and quietly move the trip off the
  // date the user chose.
  if (trip.anchorDate !== undefined && !pinned.has(0)) {
    pinned.set(0, { boundary: 0, date: trip.anchorDate, cardId: null });
  }

  const pinnedBoundaries = [...pinned.keys()].sort((a, b) => a - b);
  const nights = new Array<number>(count).fill(0);

  const spans: { from: number; to: number; available: number; cardIds: string[] }[] = [];
  for (let i = 0; i < pinnedBoundaries.length - 1; i++) {
    const a = pinnedBoundaries[i]!;
    const b = pinnedBoundaries[i + 1]!;
    const transit = sumTransit(transitBefore, a + 1, b + 1);
    spans.push({
      from: a,
      to: b,
      available: daysBetween(pinned.get(a)!.date, pinned.get(b)!.date) - transit,
      cardIds: [pinned.get(a)!.cardId, pinned.get(b)!.cardId].filter(
        (id): id is string => id !== null,
      ),
    });
  }

  for (const span of spans) {
    const { nights: filled, conflict } = fillSpan(
      trip,
      span.from,
      span.to,
      span.available,
      forced,
      span.cardIds,
    );
    filled.forEach((n, i) => (nights[span.from + i] = n));
    if (conflict) conflicts.push(conflict);
  }

  // Segments outside any pinned span have nothing pulling on them: give them their ideal.
  const firstPin = pinnedBoundaries[0];
  const lastPin = pinnedBoundaries[pinnedBoundaries.length - 1];
  for (let i = 0; i < count; i++) {
    const insideSpan =
      firstPin !== undefined && lastPin !== undefined && i >= firstPin && i < lastPin;
    if (insideSpan) continue;
    const force = forced.get(i);
    nights[i] = force ? force.nights : trip.segments[i]!.duration.ideal;
  }

  // Day offset of each segment's first night, measured from the trip's day 0.
  const startDayOf: number[] = [];
  let offset = 0;
  for (let i = 0; i < count; i++) {
    offset += transitBefore[i] ?? 0;
    startDayOf.push(offset);
    offset += nights[i]!;
  }

  // Anchor the calendar. A pin wins; otherwise the trip's tentative anchorDate; otherwise the trip
  // stays undated and schedules to relative days.
  //
  // A pin dates a *segment boundary*, while startDate is the trip's day 0. With an overnight
  // inbound leg those are different days, so the offset has to come back out — subtracting it here
  // rather than re-deriving it is what stops the transit night being counted twice.
  let startDate: IsoDate | undefined;
  if (firstPin !== undefined) {
    const pinDay = toDayNumber(pinned.get(firstPin)!.date);
    const pinOffset = firstPin < count ? startDayOf[firstPin]! : offset;
    startDate = fromDayNumber(pinDay - pinOffset);
  } else if (trip.anchorDate !== undefined) {
    startDate = trip.anchorDate;
  }

  const scheduled: ScheduledSegment[] = [];
  let cursor = 0;
  for (let i = 0; i < count; i++) {
    cursor += transitBefore[i] ?? 0;
    const segment = trip.segments[i]!;
    const force = forced.get(i);
    scheduled.push({
      segmentId: segment.id,
      nights: nights[i]!,
      startDay: cursor,
      ...(startDate === undefined ? {} : { startDate: addDays(startDate, cursor) }),
      reason: reasonFor(nights[i]!, segment.duration, force !== undefined),
      ...(force ? { pinnedBy: force.cardId } : {}),
    });
    cursor += nights[i]!;
  }

  const totalNights = cursor;
  if (totalNights < trip.length.min || totalNights > trip.length.max) {
    conflicts.push({
      code: 'TRIP_LENGTH_MISMATCH',
      severity: 'warning',
      message:
        `This trip works out to ${totalNights} night${totalNights === 1 ? '' : 's'}, outside the ` +
        `${trip.length.min}–${trip.length.max} you were aiming for.`,
      segmentIds: trip.segments.map((s) => s.id),
      cardIds: [],
      flexible: {
        segmentIds: trip.segments.filter((s) => s.duration.max > s.duration.min).map((s) => s.id),
        cardIds: [],
      },
      detail: { availableNights: totalNights },
    });
  }

  return {
    segments: scheduled,
    totalNights,
    totalDays: totalNights + 1,
    ...(startDate === undefined ? {} : { startDate }),
    conflicts: sortConflicts(conflicts),
  };
}

function sumTransit(transitBefore: readonly number[], from: number, to: number): number {
  let total = 0;
  for (let i = from; i < to; i++) total += transitBefore[i] ?? 0;
  return total;
}
