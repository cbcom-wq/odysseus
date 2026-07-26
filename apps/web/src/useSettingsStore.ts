import { STORAGE_NAMESPACE } from '@odysseus/brand';
import type { AppSettings } from '@odysseus/persistence';
import { loadSettings, saveSettings, settingsArePersistent } from '@odysseus/persistence';
import { useCallback, useState } from 'react';

/**
 * Settings for this installation.
 *
 * Much simpler than the trip store on purpose: one small record, read once at startup and written
 * when the user presses Save. There is no debounce and no autosave because there is no continuous
 * editing to protect — you type a key in a dialog and close it.
 */
export function useSettingsStore() {
  const [settings, setSettings] = useState<AppSettings>(() => loadSettings(STORAGE_NAMESPACE));
  const [persistent] = useState(settingsArePersistent);

  const update = useCallback((next: AppSettings): boolean => {
    setSettings(next);
    return saveSettings(STORAGE_NAMESPACE, next);
  }, []);

  return { settings, update, persistent };
}
