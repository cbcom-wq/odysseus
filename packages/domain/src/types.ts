/**
 * Core entities for the trip model.
 *
 * Two ideas carry the whole design and are worth stating up front:
 *
 * 1. A Card is a *slot* in the trip ("lodging in Paris"). An Option is a *candidate* that could
 *    fill it ("Hotel Alpha, $110/night"). Keeping them separate is what lets a decision be settled
 *    while its contents stay under comparison.
 *
 * 2. Planning state governs *policy* — whether the system may suggest or apply changes. It does not
 *    govern scheduling. Scheduling is driven by the timing of whichever option is selected, whatever
 *    state the card is in. An Exploring flight still lands at a specific hour.
 */

/** Calendar date, `YYYY-MM-DD`. */
export type IsoDate = string;

/**
 * Wall-clock time at the relevant location, `HH:mm`.
 *
 * Slice 1 deliberately does not model timezones. Departure and arrival are stored as local wall
 * time at each end, exactly as they appear on a ticket, with duration held separately. This is what
 * travellers actually reason about and it keeps the scheduler free of timezone arithmetic. Revisit
 * when the map view needs true instants.
 */
export type WallTime = string;

export type CardKind = 'flight' | 'lodging' | 'transport' | 'activity' | 'dining' | 'note';

export type PlanningState = 'unplanned' | 'exploring' | 'selected' | 'locked' | 'booked';

/** `discovered` options were found by a search the user asked for; they never outrank `user` ones. */
export type OptionSource = 'fixture' | 'user' | 'discovered';

/** Nights a segment may run for. `min <= ideal <= max`. */
export interface DurationRange {
  readonly min: number;
  readonly ideal: number;
  readonly max: number;
}

/**
 * What a card is attached to.
 *
 * Always relative, never an absolute date — an absolute anchor breaks the moment an upstream option
 * changes and the trip reflows.
 *
 * `fromNight` is the night of the stay a lodging starts on, counted from arrival; absent means the
 * first. **No end is stored.** A lodging runs until the next lodging in the same stop begins, or
 * until the stay ends if it is the last. That omission is the whole design: stretching Paris from
 * five nights to six lengthens the last stay with no code doing anything, and there is no stored end
 * that can disagree with the schedule. Interpreted for lodging only — a note on a segment covers the
 * whole stay regardless.
 */
export type CardAnchor =
  | { readonly kind: 'segment'; readonly segmentId: string; readonly fromNight?: number }
  | { readonly kind: 'segment-day'; readonly segmentId: string; readonly dayOffset: number }
  | { readonly kind: 'connection'; readonly connectionId: string };

/**
 * When an option happens.
 *
 * Absent means the option pins nothing and floats with the schedule. This is the common case for
 * lodging: a hotel option from a search is a property and a nightly rate, not a reservation. It only
 * acquires fixed dates once actually booked, and only then does it constrain the schedule.
 */
export type OptionTiming =
  /** A journey between two places on a specific date. Always pins. */
  | {
      readonly kind: 'journey';
      readonly departDate: IsoDate;
      readonly departTime: WallTime;
      readonly arriveTime: WallTime;
      /** 1 for red-eyes and night trains, which push the downstream boundary a day later. */
      readonly nightsInTransit: 0 | 1;
      readonly durationMinutes: number;
    }
  /** A stay with dates already fixed, e.g. a confirmed reservation. Pins its segment. */
  | {
      readonly kind: 'stay';
      readonly checkIn: IsoDate;
      readonly checkOut: IsoDate;
    }
  /** A slot within whatever day the card is anchored to. Pins nothing; may still conflict. */
  | {
      readonly kind: 'slot';
      readonly startTime: WallTime;
      readonly endTime: WallTime;
    };

export type OptionCost =
  | { readonly kind: 'fixed'; readonly amount: number }
  | { readonly kind: 'per-night'; readonly amount: number };

export interface Option {
  readonly id: string;
  readonly source: OptionSource;
  readonly title: string;
  readonly detail?: string;
  readonly cost: OptionCost;
  readonly timing?: OptionTiming;
  /**
   * Where this was found, when it came from somewhere with an address.
   *
   * A reference for the traveller to go back to, and nothing more — it is never re-fetched. An
   * option is a snapshot of what a listing said when it was captured, and quietly re-reading the
   * page later would mean prices and times changing underneath a decision that was already made.
   */
  readonly sourceUrl?: string;
  /**
   * Options on different cards that were bought as one fare — the two legs of a return flight.
   *
   * The link belongs here rather than on the Card because a slot can hold a return fare and a
   * one-way as rivals. Linking the cards would declare the trip permanently round-trip; linking the
   * options means choosing the return fare settles both legs, while choosing the one-way leaves the
   * other leg free to shop separately.
   *
   * At most one option per card may carry a given id: two alternatives on one card cannot both be
   * halves of a single purchase.
   */
  readonly fareGroupId?: string;
  readonly attributes?: Readonly<Record<string, string | number | boolean>>;
}

export interface Card {
  readonly id: string;
  readonly kind: CardKind;
  readonly state: PlanningState;
  readonly anchor: CardAnchor;
  readonly selectedOptionId?: string;
  readonly options: readonly Option[];
}

export interface Location {
  readonly name: string;
  readonly code?: string;
  readonly lat?: number;
  readonly lon?: number;
}

/** A stay in one place. */
export interface Segment {
  readonly id: string;
  readonly location: Location;
  readonly duration: DurationRange;
}

/**
 * Movement between segments.
 *
 * Endpoints are nullable because the legs at each end of a trip are real connections with real
 * timing but only one segment: `from: null` is the inbound leg that pins the trip's first night,
 * `to: null` is the return leg that pins its end. Modelling them as connections rather than as
 * special cases keeps the scheduler free of "is this the first segment" branching.
 */
export interface Connection {
  readonly id: string;
  readonly fromSegmentId: string | null;
  readonly toSegmentId: string | null;
}

/** Weighting preset for option ranking. Surfaced in the UI as Budget Style. */
export type RankingPreset = 'best-value' | 'balanced' | 'comfort';

export interface TripPreferences {
  readonly ranking: RankingPreset;
  /** Hours considered usable for experiences at a destination, used by `usableHoursDelta`. */
  readonly dayStart: WallTime;
  readonly dayEnd: WallTime;
}

export interface Trip {
  readonly id: string;
  readonly name: string;
  readonly travelers: number;
  /**
   * Date of the trip's first night. Absent for a trip still being shaped, which schedules to
   * relative days instead — this is how "start flexible" is honoured in the model rather than
   * bolted on.
   */
  readonly anchorDate?: IsoDate;
  /**
   * When a still-undated trip may start: the first night falls somewhere inside it. A planning
   * constraint for searches, not a scheduling input — meaningful only while `anchorDate` is absent,
   * and superseded the moment a date is declared or a flight pins the calendar.
   */
  readonly dateWindow?: { readonly earliest: IsoDate; readonly latest: IsoDate };
  /** Total nights the trip may run for. `min === max` when the length is exact. */
  readonly length: { readonly min: number; readonly max: number };
  readonly currency: string;
  readonly segments: readonly Segment[];
  readonly connections: readonly Connection[];
  readonly cards: readonly Card[];
  readonly preferences: TripPreferences;
  readonly schemaVersion: number;
}

export const SCHEMA_VERSION = 1;
