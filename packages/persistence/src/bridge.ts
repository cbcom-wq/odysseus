import type { Trip } from '@odysseus/domain';
import type { LoadResult, Repository, StoredTrip } from './repository.js';

/**
 * The contract between a desktop shell and the interface running inside it.
 *
 * It lives here rather than in the shell because it is a storage contract, and keeping one copy is
 * what stops the main process, the preload bridge, and the renderer drifting apart. The shell
 * imports the channel names; the interface imports the repository.
 */

export const TRIPS_LOAD_ALL = 'trips:loadAll';
export const TRIPS_SAVE = 'trips:save';
export const TRIPS_REMOVE = 'trips:remove';
export const TRIPS_REVEAL = 'trips:reveal';

/**
 * The global the preload script exposes.
 *
 * Named for what it is rather than for the product, so renaming Odysseus cannot quietly break the
 * handshake between the shell and the interface.
 */
export const BRIDGE_GLOBAL = 'desktopBridge';

export interface DesktopBridge {
  readonly platform: 'desktop';
  /** Where trips are kept on disk. Shown to the user; never used to open anything from here. */
  readonly tripsDirectory: string;
  loadAll(): Promise<LoadResult>;
  save(trip: Trip): Promise<StoredTrip>;
  remove(id: string): Promise<void>;
  /** Open the trips folder in the system file manager. */
  reveal(): Promise<void>;
}

/** The bridge if this is running inside a desktop shell, otherwise undefined. */
export function findDesktopBridge(): DesktopBridge | undefined {
  if (typeof globalThis === 'undefined') return undefined;
  const candidate = (globalThis as Record<string, unknown>)[BRIDGE_GLOBAL];
  if (typeof candidate !== 'object' || candidate === null) return undefined;
  return (candidate as DesktopBridge).platform === 'desktop'
    ? (candidate as DesktopBridge)
    : undefined;
}

/**
 * Storage backed by the desktop shell's filesystem.
 *
 * A pass-through by design: the real work happens in FileRepository on the other side of the
 * bridge, so the desktop and browser builds share both the file format and its migrations.
 */
export class DesktopRepository implements Repository {
  constructor(private readonly bridge: DesktopBridge) {}

  loadAll(): Promise<LoadResult> {
    return this.bridge.loadAll();
  }

  save(trip: Trip): Promise<StoredTrip> {
    return this.bridge.save(trip);
  }

  remove(id: string): Promise<void> {
    return this.bridge.remove(id);
  }
}
