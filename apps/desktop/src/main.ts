import { join } from 'node:path';
import { PRODUCT_NAME, STORAGE_NAMESPACE, WINDOW_TITLE } from '@odysseus/brand';
import { FileRepository } from '@odysseus/persistence/node';
import { BrowserWindow, Menu, app, dialog, ipcMain, shell } from 'electron';
import { TRIPS_LOAD_ALL, TRIPS_REMOVE, TRIPS_REVEAL, TRIPS_SAVE } from '@odysseus/persistence';

/**
 * The desktop shell.
 *
 * A window, a menu, and a door to the filesystem. No planning logic lives here — if anything
 * non-trivial starts accumulating in this file it belongs in packages/domain instead, where it can
 * be tested and where the browser build can reach it too.
 */

app.setName(PRODUCT_NAME);

/**
 * Pin the data directory to the storage namespace before anything reads it.
 *
 * Electron derives `userData` from the application *name*, so leaving it alone would have quietly
 * undone the whole point of keeping STORAGE_NAMESPACE separate from PRODUCT_NAME: renaming the
 * product would move the folder and every saved trip would look like it had vanished. Setting it
 * explicitly means the name is free to change and the files stay where they are.
 */
app.setPath('userData', join(app.getPath('appData'), STORAGE_NAMESPACE));

const tripsDirectory = join(app.getPath('userData'), 'trips');
const repository = new FileRepository(tripsDirectory);

/** Set by the dev script so the shell loads the Vite server instead of the built bundle. */
const devServerUrl = process.env.ODYSSEUS_DEV_URL;

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    title: WINDOW_TITLE,
    backgroundColor: '#eaeeec',
    show: false,
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'),
      // Hand the preload the real directory. A sandboxed preload cannot call app.getPath, and
      // reconstructing it from environment variables would guess wrong on macOS.
      additionalArguments: [`--trips-directory=${tripsDirectory}`],
      // The renderer runs our own interface, but it is still the part that would handle anything
      // pasted in from outside. It gets no Node access; the four calls in ipc.ts are the whole
      // surface.
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // Wait for the first paint rather than showing an empty frame.
  window.once('ready-to-show', () => window.show());

  // A window that fails to load its own interface should say so. Without this the failure mode is a
  // blank frame and an empty log, which is a miserable thing to debug.
  window.webContents.on('did-fail-load', (_event, code, description, url) => {
    console.error(`Could not load the interface (${code} ${description}): ${url}`);
  });

  if (devServerUrl) {
    void window.loadURL(devServerUrl);
  } else {
    void window.loadFile(join(__dirname, '../../web/dist/index.html'));
  }

  // Nothing in the workspace should be opening other sites. Send any attempt to the real browser
  // rather than letting it take over the app window.
  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });
  window.webContents.on('will-navigate', (event, url) => {
    const target = new URL(url);
    const allowed = devServerUrl !== undefined && url.startsWith(devServerUrl);
    if (!allowed && target.protocol !== 'file:') {
      event.preventDefault();
      void shell.openExternal(url);
    }
  });

  return window;
}

function buildMenu(): void {
  const isMac = process.platform === 'darwin';

  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      ...(isMac ? [{ role: 'appMenu' as const }] : []),
      {
        label: 'File',
        submenu: [
          {
            label: 'Show trips folder',
            accelerator: 'CmdOrCtrl+Shift+O',
            click: () => void shell.openPath(tripsDirectory),
          },
          { type: 'separator' as const },
          isMac ? { role: 'close' as const } : { role: 'quit' as const },
        ],
      },
      { role: 'editMenu' as const },
      {
        label: 'View',
        submenu: [
          { role: 'reload' as const },
          { role: 'toggleDevTools' as const },
          { type: 'separator' as const },
          { role: 'resetZoom' as const },
          { role: 'zoomIn' as const },
          { role: 'zoomOut' as const },
          { type: 'separator' as const },
          { role: 'togglefullscreen' as const },
        ],
      },
      {
        label: 'Help',
        submenu: [
          {
            label: `About ${PRODUCT_NAME}`,
            click: () =>
              void dialog.showMessageBox({
                type: 'info',
                title: `About ${PRODUCT_NAME}`,
                message: WINDOW_TITLE,
                detail:
                  `Your trips are kept as readable JSON files, one per trip, in:\n${tripsDirectory}\n\n` +
                  'They are yours: open them, back them up, keep them in version control, or fix ' +
                  'them in a text editor.',
              }),
          },
        ],
      },
    ]),
  );
}

function registerHandlers(): void {
  ipcMain.handle(TRIPS_LOAD_ALL, () => repository.loadAll());

  ipcMain.handle(TRIPS_SAVE, (_event, trip: unknown) => {
    // The renderer is our own code, but a handler that trusts whatever arrives is a handler that
    // writes junk to disk the first time something upstream goes wrong.
    if (typeof trip !== 'object' || trip === null || typeof (trip as { id?: unknown }).id !== 'string') {
      throw new Error('Refusing to save something that is not a trip.');
    }
    return repository.save(trip as Parameters<typeof repository.save>[0]);
  });

  ipcMain.handle(TRIPS_REMOVE, (_event, id: unknown) => {
    if (typeof id !== 'string') throw new Error('Refusing to remove without a trip id.');
    return repository.remove(id);
  });

  ipcMain.handle(TRIPS_REVEAL, () => shell.openPath(tripsDirectory));
}

// One window at a time. A second instance should raise the first rather than open a rival copy
// writing to the same files.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const [existing] = BrowserWindow.getAllWindows();
    if (existing) {
      if (existing.isMinimized()) existing.restore();
      existing.focus();
    }
  });

  void app.whenReady().then(() => {
    registerHandlers();
    buildMenu();
    createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
