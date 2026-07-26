import { beforeEach, describe, expect, it } from 'vitest';
import { EMPTY_SETTINGS, loadSettings, saveSettings, settingsArePersistent } from './settings.js';

/** A stand-in for localStorage, with a switch for the ways real storage fails. */
class FakeStorage implements Storage {
  private data = new Map<string, string>();
  failing = false;

  get length(): number {
    return this.data.size;
  }
  clear(): void {
    this.data.clear();
  }
  key(index: number): string | null {
    return [...this.data.keys()][index] ?? null;
  }
  getItem(key: string): string | null {
    if (this.failing) throw new Error('storage is not available');
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    if (this.failing) throw new Error('storage is not available');
    this.data.set(key, value);
  }
  removeItem(key: string): void {
    if (this.failing) throw new Error('storage is not available');
    this.data.delete(key);
  }
}

let store: FakeStorage;
beforeEach(() => {
  store = new FakeStorage();
});

describe('settings round-trip', () => {
  it('gives back what was saved', () => {
    saveSettings('odysseus', { anthropicApiKey: 'sk-ant-test' }, store);
    expect(loadSettings('odysseus', store)).toEqual({ anthropicApiKey: 'sk-ant-test' });
  });

  it('starts empty', () => {
    expect(loadSettings('odysseus', store)).toEqual(EMPTY_SETTINGS);
  });

  it('keeps namespaces apart', () => {
    saveSettings('odysseus', { anthropicApiKey: 'sk-ant-one' }, store);
    expect(loadSettings('something-else', store)).toEqual(EMPTY_SETTINGS);
  });

  it('trims what was pasted', () => {
    // Copying a key out of a console tends to bring whitespace with it, and a key with a trailing
    // newline fails authentication in a way that looks like a wrong key.
    saveSettings('odysseus', { anthropicApiKey: '  sk-ant-test\n' }, store);
    expect(loadSettings('odysseus', store).anthropicApiKey).toBe('sk-ant-test');
  });
});

describe('clearing the key', () => {
  it('treats blank as removed', () => {
    saveSettings('odysseus', { anthropicApiKey: 'sk-ant-test' }, store);
    saveSettings('odysseus', { anthropicApiKey: '   ' }, store);

    expect(loadSettings('odysseus', store)).toEqual(EMPTY_SETTINGS);
    expect(store.length).toBe(0); // and does not leave an empty record behind
  });

  it('removes the record when the key goes', () => {
    saveSettings('odysseus', { anthropicApiKey: 'sk-ant-test' }, store);
    saveSettings('odysseus', {}, store);
    expect(loadSettings('odysseus', store)).toEqual(EMPTY_SETTINGS);
  });
});

describe('when storage misbehaves', () => {
  it('reads blanks rather than throwing', () => {
    store.failing = true;
    expect(loadSettings('odysseus', store)).toEqual(EMPTY_SETTINGS);
  });

  it('reports a failed write instead of throwing', () => {
    store.failing = true;
    expect(saveSettings('odysseus', { anthropicApiKey: 'sk-ant-test' }, store)).toBe(false);
  });

  it('confirms a successful write', () => {
    expect(saveSettings('odysseus', { anthropicApiKey: 'sk-ant-test' }, store)).toBe(true);
  });

  it('survives a corrupt record', () => {
    // Something else wrote to our key, or a half-written record was left behind.
    store.setItem('odysseus:settings', 'not json at all');
    expect(loadSettings('odysseus', store)).toEqual(EMPTY_SETTINGS);

    store.setItem('odysseus:settings', '"a bare string"');
    expect(loadSettings('odysseus', store)).toEqual(EMPTY_SETTINGS);

    store.setItem('odysseus:settings', '{"anthropicApiKey": 12345}');
    expect(loadSettings('odysseus', store)).toEqual(EMPTY_SETTINGS);
  });
});

describe('settingsArePersistent', () => {
  it('is true for working storage', () => {
    expect(settingsArePersistent(store)).toBe(true);
  });

  it('is false when storage throws', () => {
    store.failing = true;
    expect(settingsArePersistent(store)).toBe(false);
  });

  it('is false when there is no storage at all', () => {
    expect(settingsArePersistent(undefined)).toBe(false);
  });

  it('leaves nothing behind', () => {
    settingsArePersistent(store);
    expect(store.length).toBe(0);
  });
});
