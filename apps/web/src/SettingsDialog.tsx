import { PRODUCT_NAME } from '@odysseus/brand';
import type { AppSettings } from '@odysseus/persistence';
import { useState } from 'react';

/**
 * Where the API key lives.
 *
 * One field, and a plain account of where it goes. The key buys one thing — reading pasted links
 * and screenshots — and the app is fully usable without it, so this dialog should read as an offer
 * rather than as setup the user failed to complete.
 */
export function SettingsDialog({
  settings,
  persistent,
  onSave,
  onClose,
}: {
  settings: AppSettings;
  /** False in private browsing, where anything saved here dies with the tab. */
  persistent: boolean;
  onSave: (next: AppSettings) => boolean;
  onClose: () => void;
}) {
  const [key, setKey] = useState(settings.anthropicApiKey ?? '');
  const [failed, setFailed] = useState(false);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (onSave(key.trim() ? { anthropicApiKey: key } : {})) onClose();
    else setFailed(true);
  };

  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-label="Settings">
      <form className="dialog" onSubmit={submit}>
        <h2>Settings</h2>
        <p>
          With an Anthropic API key, {PRODUCT_NAME} can read a link, a screenshot, or copied text and
          fill a card in for you. Without one, everything still works — you just type it in yourself.
        </p>

        <div className="field">
          <label className="label" htmlFor="settings-key">
            Anthropic API key
          </label>
          <input
            id="settings-key"
            type="password"
            value={key}
            onChange={(e) => {
              setKey(e.target.value);
              setFailed(false);
            }}
            placeholder="sk-ant-…"
            autoComplete="off"
            spellCheck={false}
            autoFocus
          />
          <div className="field__hint">
            Kept on this device, in plain text, and sent only to Anthropic when you paste something.
            Leave it blank to remove it. You can revoke it any time at console.anthropic.com.
          </div>
        </div>

        {!persistent ? (
          <div className="field__hint">
            This browser will not let anything be stored, so the key will be forgotten when you close
            the tab.
          </div>
        ) : null}

        {failed ? (
          <div className="field__hint">That could not be saved. Storage may be full or blocked.</div>
        ) : null}

        <div className="actions">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn--primary">
            Save
          </button>
        </div>
      </form>
    </div>
  );
}
