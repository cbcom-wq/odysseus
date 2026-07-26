/**
 * App settings — things about this installation rather than about a trip.
 *
 * Deliberately not a Repository. Trips are the thing this app is for: they are versioned, migrated,
 * validated on read, and written as files a person can open. Settings are one small record that
 * nobody will ever hand-edit or share, and giving them that machinery would suggest a kinship that
 * is not there.
 *
 * The separation matters most in the other direction. A trip file is meant to be readable,
 * diffable, and passed to whoever you are travelling with — so an API key must never be stored in
 * one. Keeping settings out of the trip schema is what makes that impossible rather than merely
 * discouraged.
 *
 * localStorage backs both builds. It is available in the desktop shell's renderer as well as the
 * browser, so the desktop bridge stays at exactly four calls and the main process never learns that
 * settings exist.
 */

export interface AppSettings {
  /** The user's own Anthropic key, used to read pasted links and screenshots. */
  readonly anthropicApiKey?: string;
}

export const EMPTY_SETTINGS: AppSettings = {};

function keyFor(namespace: string): string {
  return `${namespace}:settings`;
}

/**
 * Read the settings, or sensible blanks.
 *
 * Never throws. Storage can be unavailable in private browsing, and the record can be corrupt if
 * something else wrote to the key. Neither is worth failing the app's startup over — the cost of
 * bad settings is one feature going quiet, and the user can just type the key in again.
 */
export function loadSettings(namespace: string, store: Storage = localStorage): AppSettings {
  try {
    const raw = store.getItem(keyFor(namespace));
    if (raw === null) return EMPTY_SETTINGS;

    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return EMPTY_SETTINGS;

    const key = (parsed as Record<string, unknown>)['anthropicApiKey'];
    return typeof key === 'string' && key !== '' ? { anthropicApiKey: key } : EMPTY_SETTINGS;
  } catch {
    return EMPTY_SETTINGS;
  }
}

/** Write the settings back. Returns whether it stuck, so the interface can be honest about it. */
export function saveSettings(
  namespace: string,
  settings: AppSettings,
  store: Storage = localStorage,
): boolean {
  try {
    // An absent key and an empty one mean the same thing; store neither.
    const trimmed = settings.anthropicApiKey?.trim();
    const next: AppSettings = trimmed ? { anthropicApiKey: trimmed } : {};

    if (next.anthropicApiKey === undefined) store.removeItem(keyFor(namespace));
    else store.setItem(keyFor(namespace), JSON.stringify(next));

    return true;
  } catch {
    return false;
  }
}

/** Whether settings will survive a reload. False in private browsing and locked-down storage. */
export function settingsArePersistent(store: Storage | undefined = globalThis.localStorage): boolean {
  if (store === undefined) return false;
  try {
    const probe = '__odysseus_probe__';
    store.setItem(probe, '1');
    store.removeItem(probe);
    return true;
  } catch {
    return false;
  }
}
