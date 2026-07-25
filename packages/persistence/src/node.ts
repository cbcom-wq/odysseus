import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Trip } from '@odysseus/domain';
import type { LoadResult, Repository, StoredTrip, UnreadableTrip } from './repository.js';
import { UnreadableTripError, readTrip } from './repository.js';

/**
 * One readable JSON file per trip, for the desktop build.
 *
 * Local-first in the sense that actually matters: the file is yours. You can open it, diff it, back
 * it up, keep it in a git repository, or fix it in a text editor when something goes wrong. That is
 * worth more than the query performance a database would buy for data this small.
 *
 * Imported from `@odysseus/persistence/node` rather than the package root, so the browser bundle
 * never pulls `node:fs` in.
 */

interface FileShape {
  readonly updatedAt: string;
  readonly trip: unknown;
}

/** Keeps a stray id from escaping the trips directory. */
function fileNameFor(id: string): string {
  const safe = id.replace(/[^a-zA-Z0-9._-]/g, '_');
  if (safe === '' || safe === '.' || safe === '..') {
    throw new Error(`Unusable trip id: ${JSON.stringify(id)}`);
  }
  return `${safe}.json`;
}

export class FileRepository implements Repository {
  constructor(private readonly directory: string) {}

  private async ensureDirectory(): Promise<void> {
    await mkdir(this.directory, { recursive: true });
  }

  async loadAll(): Promise<LoadResult> {
    await this.ensureDirectory();
    const names = (await readdir(this.directory)).filter((n) => n.endsWith('.json'));

    const trips: StoredTrip[] = [];
    const problems: UnreadableTrip[] = [];

    for (const name of names) {
      const id = name.replace(/\.json$/, '');
      try {
        const parsed = JSON.parse(await readFile(join(this.directory, name), 'utf8')) as FileShape;
        trips.push({
          trip: readTrip(parsed.trip),
          updatedAt: parsed.updatedAt ?? new Date(0).toISOString(),
        });
      } catch (error) {
        // A file someone hand-edited into invalid JSON should cost them that trip, not all of them.
        problems.push({
          id,
          reason:
            error instanceof UnreadableTripError
              ? error.message
              : error instanceof SyntaxError
                ? `${name} is not valid JSON.`
                : `${name} could not be read.`,
        });
      }
    }

    trips.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return { trips, problems };
  }

  async save(trip: Trip): Promise<StoredTrip> {
    await this.ensureDirectory();
    const record: StoredTrip = { trip, updatedAt: new Date().toISOString() };
    const target = join(this.directory, fileNameFor(trip.id));

    // Write beside the target and rename over it. A crash mid-write then loses the new version
    // rather than corrupting the trip that was already there.
    const temporary = `${target}.tmp`;
    const body: FileShape = { updatedAt: record.updatedAt, trip };
    await writeFile(temporary, `${JSON.stringify(body, null, 2)}\n`, 'utf8');
    await rename(temporary, target);

    return record;
  }

  async remove(id: string): Promise<void> {
    await rm(join(this.directory, fileNameFor(id)), { force: true });
  }
}
