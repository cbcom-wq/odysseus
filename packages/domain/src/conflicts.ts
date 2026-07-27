import type { IsoDate } from './types.js';

/**
 * Conflicts are output, not errors.
 *
 * A conflict is never a reason to refuse to produce a schedule, and never a reason to quietly
 * adjust one. The user asked for something that does not fit; the job is to say so precisely enough
 * that they can decide what to give up.
 *
 * Every conflict therefore names both what broke and *what still has room to move* — a conflict the
 * user cannot act on is merely nagging.
 */

export type ConflictCode =
  // Capacity — the trip's shape cannot fit the time available.
  | 'INSUFFICIENT_TIME'
  | 'EXCESS_TIME'
  | 'CONTRADICTORY_PINS'
  | 'TRIP_LENGTH_MISMATCH'
  // Compatibility — two selected options cannot coexist. The family users hit while comparing.
  | 'TIMING_OVERLAP'
  | 'IMPOSSIBLE_TRANSFER'
  | 'UNCOVERED_NIGHT'
  | 'MISSING_CONNECTION'
  | 'ORPHANED_CARD';

export type ConflictSeverity = 'blocking' | 'warning';

export interface Conflict {
  readonly code: ConflictCode;
  readonly severity: ConflictSeverity;
  /** Human-readable, specific, and naming real values. Rendered directly in the UI. */
  readonly message: string;
  readonly segmentIds: readonly string[];
  readonly cardIds: readonly string[];
  /**
   * Cards and segments that could still move to resolve this. What turns a complaint into a next
   * step.
   */
  readonly flexible: {
    readonly segmentIds: readonly string[];
    readonly cardIds: readonly string[];
  };
  readonly detail?: {
    readonly availableNights?: number;
    readonly requiredNights?: number;
    readonly from?: IsoDate;
    readonly to?: IsoDate;
  };
}

/** Stable ordering so equal-severity conflicts do not shuffle between renders. */
export function sortConflicts(conflicts: readonly Conflict[]): Conflict[] {
  const rank = (c: Conflict) => (c.severity === 'blocking' ? 0 : 1);
  return [...conflicts].sort(
    (a, b) => rank(a) - rank(b) || a.code.localeCompare(b.code) || a.message.localeCompare(b.message),
  );
}
