import { STORAGE_NAMESPACE } from '@odysseus/brand';
import type { Trip } from '@odysseus/domain';
import type { Repository, UnreadableTrip } from '@odysseus/persistence';
import { MemoryRepository, browserRepository } from '@odysseus/persistence';
import { buildFixtureTrip } from '@odysseus/providers';
import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Trips, loaded once and saved as you work.
 *
 * There is no save button. Planning a trip is a long, fiddly, interrupted activity, and asking
 * someone to remember to save it is asking them to lose it. Writes are debounced so that dragging a
 * duration slider does not mean a write per frame, and flushed when the tab goes away.
 */

export type SaveState = 'loading' | 'clean' | 'saving' | 'saved' | 'error';

const DEBOUNCE_MS = 400;

function makeRepository(): { repo: Repository; ephemeral: boolean } {
  // Private browsing and locked-down storage settings make IndexedDB throw. Running in memory keeps
  // the app usable for the session; the caller warns that nothing will be kept. An app that refuses
  // to start is worse than one that admits it cannot remember.
  try {
    if (typeof indexedDB === 'undefined') return { repo: new MemoryRepository(), ephemeral: true };
    return { repo: browserRepository(STORAGE_NAMESPACE), ephemeral: false };
  } catch {
    return { repo: new MemoryRepository(), ephemeral: true };
  }
}

export function useTripStore() {
  const [{ repo, ephemeral }] = useState(makeRepository);
  const [trips, setTrips] = useState<Trip[]>([]);
  const [saveState, setSaveState] = useState<SaveState>('loading');
  const [savedAt, setSavedAt] = useState<string | undefined>();
  const [problems, setProblems] = useState<readonly UnreadableTrip[]>([]);
  const [error, setError] = useState<string | undefined>();

  const pending = useRef(new Map<string, Trip>());
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const started = useRef(false);

  const flush = useCallback(async () => {
    const batch = [...pending.current.values()];
    pending.current.clear();
    if (batch.length === 0) return;

    try {
      for (const trip of batch) await repo.save(trip);
      setSavedAt(new Date().toISOString());
      setSaveState('saved');
      setError(undefined);
    } catch (cause) {
      setSaveState('error');
      setError(cause instanceof Error ? cause.message : 'Your changes could not be saved.');
    }
  }, [repo]);

  const queueSave = useCallback(
    (trip: Trip) => {
      pending.current.set(trip.id, trip);
      setSaveState('saving');
      clearTimeout(timer.current);
      timer.current = setTimeout(() => void flush(), DEBOUNCE_MS);
    },
    [flush],
  );

  // Load once. The ref guard keeps React's development double-invoke from seeding two demo trips.
  useEffect(() => {
    if (started.current) return;
    started.current = true;

    void (async () => {
      try {
        const { trips: stored, problems } = await repo.loadAll();
        setProblems(problems);

        if (stored.length === 0 && problems.length === 0) {
          // Nothing saved and nothing broken: this is a first run, so give them something to look
          // at rather than an empty screen.
          const demo = buildFixtureTrip();
          setTrips([demo]);
          await repo.save(demo);
          setSavedAt(new Date().toISOString());
        } else {
          setTrips(stored.map((s) => s.trip));
          setSavedAt(stored[0]?.updatedAt);
        }
        setSaveState('clean');
      } catch (cause) {
        setSaveState('error');
        setError(cause instanceof Error ? cause.message : 'Your trips could not be loaded.');
      }
    })();
  }, [repo]);

  // A debounce window is a window in which work can be lost. Closing a tab mid-edit should not cost
  // the last few seconds of planning.
  useEffect(() => {
    const onHide = () => {
      if (pending.current.size > 0) void flush();
    };
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', onHide);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', onHide);
    };
  }, [flush]);

  const saveTrip = useCallback(
    (next: Trip) => {
      setTrips((all) => (all.some((t) => t.id === next.id) ? all.map((t) => (t.id === next.id ? next : t)) : [...all, next]));
      queueSave(next);
    },
    [queueSave],
  );

  const deleteTrip = useCallback(
    (id: string) => {
      setTrips((all) => all.filter((t) => t.id !== id));
      pending.current.delete(id);
      void repo.remove(id).catch(() => {
        setSaveState('error');
        setError('That trip could not be removed from storage.');
      });
    },
    [repo],
  );

  const dismissProblems = useCallback(() => setProblems([]), []);

  return {
    trips,
    saveTrip,
    deleteTrip,
    saveState,
    savedAt,
    problems,
    dismissProblems,
    error,
    ephemeral,
  };
}
