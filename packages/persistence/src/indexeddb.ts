import type { Trip } from '@odysseus/domain';
import type { LoadResult, Repository, StoredTrip, UnreadableTrip } from './repository.js';
import { UnreadableTripError, readTrip } from './repository.js';

/**
 * IndexedDB backing, for the browser build.
 *
 * Records are stored whole rather than normalised. A trip is small, always read and written in one
 * piece, and keeping it as a single document means the stored shape is the domain shape — which is
 * what lets the file adapter and this one share their migration code.
 */

const DB_VERSION = 1;
const STORE = 'trips';

interface Row {
  id: string;
  updatedAt: string;
  trip: unknown;
}

function promisify<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
  });
}

export class IndexedDbRepository implements Repository {
  private db: Promise<IDBDatabase> | undefined;

  /**
   * The database name is passed in rather than hardcoded. Storage should not know what the product
   * is called — that is the app's business, and keeping the two apart is what lets the product be
   * renamed without the saved trips going missing.
   */
  constructor(
    private readonly databaseName: string,
    private readonly factory: IDBFactory = indexedDB,
  ) {}

  private open(): Promise<IDBDatabase> {
    this.db ??= new Promise((resolve, reject) => {
      const request = this.factory.open(this.databaseName, DB_VERSION);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE)) {
          request.result.createObjectStore(STORE, { keyPath: 'id' });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('Could not open the trip store'));
      request.onblocked = () =>
        reject(new Error('Another tab is holding the trip store open. Close it and try again.'));
    });
    return this.db;
  }

  async loadAll(): Promise<LoadResult> {
    const db = await this.open();
    const rows = await promisify<Row[]>(
      db.transaction(STORE, 'readonly').objectStore(STORE).getAll() as IDBRequest<Row[]>,
    );

    const trips: StoredTrip[] = [];
    const problems: UnreadableTrip[] = [];

    for (const row of rows) {
      try {
        trips.push({ trip: readTrip(row.trip), updatedAt: row.updatedAt });
      } catch (error) {
        // One bad record must not cost the user their other trips.
        problems.push({
          id: row.id ?? 'unknown',
          reason:
            error instanceof UnreadableTripError ? error.message : 'This trip could not be read.',
        });
      }
    }

    trips.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return { trips, problems };
  }

  async save(trip: Trip): Promise<StoredTrip> {
    const db = await this.open();
    const record: StoredTrip = { trip, updatedAt: new Date().toISOString() };
    const row: Row = { id: trip.id, updatedAt: record.updatedAt, trip };

    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(row);
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('Could not save the trip'));
      tx.onabort = () => reject(tx.error ?? new Error('Saving the trip was interrupted'));
    });

    return record;
  }

  async remove(id: string): Promise<void> {
    const db = await this.open();
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(id);
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('Could not remove the trip'));
    });
  }
}

/** The repository the browser build should use, under the caller's storage namespace. */
export function browserRepository(databaseName: string): Repository {
  return new IndexedDbRepository(databaseName);
}
