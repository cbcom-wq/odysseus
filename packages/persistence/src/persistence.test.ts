import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SCHEMA_VERSION } from '@odysseus/domain';
import type { Trip } from '@odysseus/domain';
import { buildFixtureTrip, buildNewTrip } from '@odysseus/providers';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { IndexedDbRepository } from './indexeddb.js';
import { FileRepository } from './node.js';
import { MemoryRepository, UnreadableTripError, readTrip } from './repository.js';
import type { Repository } from './repository.js';

const sample = (): Trip =>
  buildNewTrip({
    name: 'Japan in spring',
    travelers: 2,
    nights: { min: 7, max: 14 },
    destinations: ['Tokyo', 'Kyoto'],
  });

describe('reading stored data', () => {
  it('accepts a trip written by this version', () => {
    expect(readTrip(JSON.parse(JSON.stringify(sample()))).name).toBe('Japan in spring');
  });

  it('refuses data from a newer version instead of guessing', () => {
    const future = { ...sample(), schemaVersion: SCHEMA_VERSION + 1 };
    expect(() => readTrip(future)).toThrow(UnreadableTripError);
    expect(() => readTrip(future)).toThrow(/newer version/i);
  });

  it('refuses data with no version at all', () => {
    const { schemaVersion: _gone, ...rest } = sample();
    expect(() => readTrip(rest)).toThrow(/no version/i);
  });

  it('names the missing piece when a trip is incomplete', () => {
    expect(() => readTrip({ schemaVersion: SCHEMA_VERSION, id: 'x' })).toThrow(/name/);
    expect(() => readTrip({ schemaVersion: SCHEMA_VERSION, id: 'x', name: 'y' })).toThrow(/segments/);
  });

  it('rejects things that are not trips', () => {
    for (const junk of [null, 42, 'hello', []]) {
      expect(() => readTrip(junk)).toThrow(UnreadableTripError);
    }
  });
});

/** Both adapters have to behave identically, so they get the same tests. */
function behavesLikeARepository(name: string, make: () => Repository) {
  describe(name, () => {
    it('returns nothing before anything is saved', async () => {
      expect((await make().loadAll()).trips).toEqual([]);
    });

    it('round-trips a trip without losing anything', async () => {
      const repo = make();
      const trip = buildFixtureTrip();
      await repo.save(trip);

      const { trips } = await repo.loadAll();
      expect(trips).toHaveLength(1);
      expect(trips[0]!.trip).toEqual(trip);
    });

    it('overwrites rather than duplicating on a second save', async () => {
      const repo = make();
      const trip = sample();
      await repo.save(trip);
      await repo.save({ ...trip, name: 'Japan in autumn' });

      const { trips } = await repo.loadAll();
      expect(trips).toHaveLength(1);
      expect(trips[0]!.trip.name).toBe('Japan in autumn');
    });

    it('keeps several trips apart', async () => {
      const repo = make();
      await repo.save(sample());
      await repo.save(buildFixtureTrip());
      expect((await repo.loadAll()).trips).toHaveLength(2);
    });

    it('removes one without touching the others', async () => {
      const repo = make();
      const a = sample();
      const b = buildFixtureTrip();
      await repo.save(a);
      await repo.save(b);
      await repo.remove(a.id);

      const { trips } = await repo.loadAll();
      expect(trips.map((t) => t.trip.id)).toEqual([b.id]);
    });

    it('is untroubled by removing something that is not there', async () => {
      await expect(make().remove('never-existed')).resolves.toBeUndefined();
    });

    it('records when each trip was last written', async () => {
      const repo = make();
      const before = Date.now();
      const record = await repo.save(sample());
      expect(new Date(record.updatedAt).getTime()).toBeGreaterThanOrEqual(before - 1000);
    });
  });
}

behavesLikeARepository('MemoryRepository', () => new MemoryRepository());

describe('IndexedDbRepository', () => {
  let factory: IDBFactory;
  beforeEach(() => {
    factory = new IDBFactory();
  });

  behavesLikeARepositoryWith(() => new IndexedDbRepository(factory));

  function behavesLikeARepositoryWith(make: () => Repository) {
    it('round-trips a trip', async () => {
      const repo = make();
      const trip = buildFixtureTrip();
      await repo.save(trip);
      expect((await repo.loadAll()).trips[0]!.trip).toEqual(trip);
    });

    it('survives a fresh connection to the same store', async () => {
      // The real test of persistence: a new repository instance, as a page reload would create.
      const trip = sample();
      await make().save(trip);

      const { trips } = await make().loadAll();
      expect(trips.map((t) => t.trip.id)).toEqual([trip.id]);
    });

    it('keeps the good trips when one record is corrupt', async () => {
      const repo = make();
      const good = sample();
      await repo.save(good);

      // Write a broken record straight past the repository, as a bad migration might leave behind.
      await new Promise<void>((resolve, reject) => {
        const open = factory.open('odysseus', 1);
        open.onsuccess = () => {
          const tx = open.result.transaction('trips', 'readwrite');
          tx.objectStore('trips').put({ id: 'broken', updatedAt: '2026-01-01T00:00:00.000Z', trip: { nope: true } });
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        };
        open.onerror = () => reject(open.error);
      });

      const { trips, problems } = await repo.loadAll();
      expect(trips.map((t) => t.trip.id)).toEqual([good.id]);
      expect(problems).toHaveLength(1);
      expect(problems[0]!.id).toBe('broken');
    });
  }
});

describe('FileRepository', () => {
  let directory: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'odysseus-test-'));
  });
  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  behavesLikeARepository('as a repository', () => new FileRepository(directory));

  it('writes a file a human can read and edit', async () => {
    const repo = new FileRepository(directory);
    const trip = sample();
    await repo.save(trip);

    const text = await readFile(join(directory, `${trip.id}.json`), 'utf8');
    expect(text).toContain('"name": "Japan in spring"');
    expect(text.endsWith('\n')).toBe(true);
    expect(JSON.parse(text).trip.id).toBe(trip.id);
  });

  it('picks up an edit made outside the app', async () => {
    // The whole point of a readable file: someone can fix it by hand and the app respects that.
    const repo = new FileRepository(directory);
    const trip = sample();
    await repo.save(trip);

    const path = join(directory, `${trip.id}.json`);
    const parsed = JSON.parse(await readFile(path, 'utf8'));
    parsed.trip.name = 'Renamed by hand';
    await writeFile(path, JSON.stringify(parsed, null, 2), 'utf8');

    expect((await repo.loadAll()).trips[0]!.trip.name).toBe('Renamed by hand');
  });

  it('reports a file broken by hand without losing the others', async () => {
    const repo = new FileRepository(directory);
    await repo.save(sample());
    await writeFile(join(directory, 'mangled.json'), '{ this is not json', 'utf8');

    const { trips, problems } = await repo.loadAll();
    expect(trips).toHaveLength(1);
    expect(problems.map((p) => p.id)).toEqual(['mangled']);
    expect(problems[0]!.reason).toMatch(/not valid JSON/);
  });

  it('leaves no temporary files behind', async () => {
    const repo = new FileRepository(directory);
    await repo.save(sample());
    const { readdir } = await import('node:fs/promises');
    expect((await readdir(directory)).every((n) => !n.endsWith('.tmp'))).toBe(true);
  });

  it('refuses to let a trip id escape the directory', async () => {
    const repo = new FileRepository(directory);
    const escaping = { ...sample(), id: '../../etc/passwd' };
    await repo.save(escaping);

    const { readdir } = await import('node:fs/promises');
    const names = await readdir(directory);
    expect(names).toEqual(['.._.._etc_passwd.json']);
  });
});
