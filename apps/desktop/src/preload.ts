import type { DesktopBridge } from '@odysseus/persistence';
import {
  BRIDGE_GLOBAL,
  EXTRACT_OPTION,
  TRIPS_LOAD_ALL,
  TRIPS_REMOVE,
  TRIPS_REVEAL,
  TRIPS_SAVE,
} from '@odysseus/persistence';
import { contextBridge, ipcRenderer } from 'electron';

/**
 * The only thing the interface can see of the shell.
 *
 * Five calls: four about storing trips, and one that reads a pasted listing by running the Claude
 * Code CLI. The renderer still gets no filesystem, no shell, and no general IPC — it can ask for
 * one extraction with one payload, and the main process decides everything about how that runs.
 */

// Passed in by the main process rather than rebuilt from environment variables, which would guess
// wrong on macOS. Displayed to the user; nothing is ever opened from here.
const flag = '--trips-directory=';
const tripsDirectory = process.argv.find((a) => a.startsWith(flag))?.slice(flag.length) ?? '';

const bridge: DesktopBridge = {
  platform: 'desktop',
  tripsDirectory,
  loadAll: () => ipcRenderer.invoke(TRIPS_LOAD_ALL),
  save: (trip) => ipcRenderer.invoke(TRIPS_SAVE, trip),
  remove: (id) => ipcRenderer.invoke(TRIPS_REMOVE, id),
  reveal: () => ipcRenderer.invoke(TRIPS_REVEAL),
  extractOption: (request) => ipcRenderer.invoke(EXTRACT_OPTION, request),
};

contextBridge.exposeInMainWorld(BRIDGE_GLOBAL, bridge);
