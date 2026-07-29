import type { Trip } from '@odysseus/domain';
import type { LoadResult, Repository, StoredTrip } from './repository.js';

/**
 * The contract between a desktop shell and the interface running inside it.
 *
 * It lives here rather than in the shell because keeping one copy is what stops the main process,
 * the preload bridge, and the renderer drifting apart. The shell imports the channel names; the
 * interface imports the repository.
 *
 * Four of the six calls are about storing trips. The other two are not, and it is worth saying why
 * they earned their place: reading a pasted link or screenshot — and searching the web for options —
 * mean running the Claude Code CLI, and only the main process can start a process. Without them a
 * desktop user would have to hold an API key for a tool they already have installed and are already
 * signed in to. The renderer still gets no filesystem, no shell, and no general IPC — it can ask
 * for one extraction or one search and nothing else.
 */

export const TRIPS_LOAD_ALL = 'trips:loadAll';
export const TRIPS_SAVE = 'trips:save';
export const TRIPS_REMOVE = 'trips:remove';
export const TRIPS_REVEAL = 'trips:reveal';
export const EXTRACT_OPTION = 'extract:option';
export const SEARCH_OPTIONS = 'search:options';

/**
 * A paste to be read into card fields.
 *
 * Structural rather than imported from `@odysseus/extraction`: this package describes the shape of
 * the conversation, and it should not take a dependency on the thing at the far end of it.
 */
export interface BridgeExtractionRequest {
  readonly kind: 'url' | 'image' | 'text';
  /** A link, the pasted text, or base64 image data, depending on `kind`. */
  readonly payload: string;
  readonly mediaType?: string;
  readonly allowedKinds: readonly string[];
}

/**
 * A card's slot, described for a web search. Structural for the same reason as the extraction
 * request above — plain strings and numbers the main process re-validates before doing anything.
 */
export interface BridgeSearchRequest {
  readonly cardKind: string;
  /** Absent only on the homeward leg — the trip knows where it ends, but home is not modelled. */
  readonly destination?: string;
  readonly destinationCode?: string;
  readonly origin?: string;
  readonly startDate?: string;
  readonly endDate?: string;
  readonly nights?: number;
  readonly windowEarliest?: string;
  readonly windowLatest?: string;
  readonly lengthMin?: number;
  readonly lengthMax?: number;
  readonly travelers: number;
  readonly currency: string;
  readonly hints: readonly string[];
}

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
  /**
   * Read a pasted link, screenshot, or block of text into card fields using the locally installed
   * Claude Code. Rejects if it is not installed. Returns the raw fields for the caller to validate.
   */
  extractOption(request: BridgeExtractionRequest): Promise<unknown>;
  /**
   * Search the live web for options filling a card, using the locally installed Claude Code.
   * Rejects if it is not installed. Returns the raw batch for the caller to validate.
   */
  searchOptions(request: BridgeSearchRequest): Promise<unknown>;
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
