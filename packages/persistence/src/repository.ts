import { SCHEMA_VERSION } from '@odysseus/domain';
import type { Trip } from '@odysseus/domain';

/**
 * Storing trips.
 *
 * One interface, several backings: a JSON file per trip on the desktop, IndexedDB in a browser, a
 * hosted API later. The domain never touches any of them, so moving between them is a change of
 * adapter rather than a change of design.
 */

export interface StoredTrip {
  readonly trip: Trip;
  /** ISO instant of the last write. Drives "saved just now" and orders the trip list. */
  readonly updatedAt: string;
}

/** A trip that could not be read back, kept so the interface can say so instead of staying silent. */
export interface UnreadableTrip {
  readonly id: string;
  readonly reason: string;
}

export interface LoadResult {
  readonly trips: readonly StoredTrip[];
  readonly problems: readonly UnreadableTrip[];
}

export interface Repository {
  loadAll(): Promise<LoadResult>;
  save(trip: Trip): Promise<StoredTrip>;
  remove(id: string): Promise<void>;
}

export const CURRENT_SCHEMA_VERSION = SCHEMA_VERSION;

export class UnreadableTripError extends Error {}

/**
 * Turn whatever came back off disk into a Trip, or explain why it cannot be.
 *
 * A single corrupt record must never take the whole application down with it — someone with four
 * good trips and one bad one should still see four trips. Callers collect the failures and surface
 * them rather than throwing them away.
 */
export function readTrip(raw: unknown): Trip {
  if (typeof raw !== 'object' || raw === null) {
    throw new UnreadableTripError('The saved data is not a trip.');
  }

  const record = raw as Record<string, unknown>;
  const version = record.schemaVersion;

  if (typeof version !== 'number') {
    throw new UnreadableTripError('The saved data has no version, so it cannot be read safely.');
  }
  if (version > CURRENT_SCHEMA_VERSION) {
    throw new UnreadableTripError(
      `This trip was saved by a newer version of the app (format ${version}). Update to open it.`,
    );
  }

  // Migrations from older formats belong here, applied in order. There are none yet, but writing
  // the version from the first save is what makes adding them possible later without guesswork.
  const migrated = record;

  for (const field of ['id', 'name'] as const) {
    if (typeof migrated[field] !== 'string') {
      throw new UnreadableTripError(`This trip is missing its ${field}.`);
    }
  }
  for (const field of ['segments', 'connections', 'cards'] as const) {
    if (!Array.isArray(migrated[field])) {
      throw new UnreadableTripError(`This trip is missing its ${field}.`);
    }
  }

  return migrated as unknown as Trip;
}

/** Kept in memory only. Used by tests, and as a fallback when a browser blocks storage. */
export class MemoryRepository implements Repository {
  private readonly records = new Map<string, StoredTrip>();

  loadAll(): Promise<LoadResult> {
    const trips = [...this.records.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return Promise.resolve({ trips, problems: [] });
  }

  save(trip: Trip): Promise<StoredTrip> {
    const record: StoredTrip = { trip, updatedAt: new Date().toISOString() };
    this.records.set(trip.id, record);
    return Promise.resolve(record);
  }

  remove(id: string): Promise<void> {
    this.records.delete(id);
    return Promise.resolve();
  }
}
