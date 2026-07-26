import type { SaveState } from './useTripStore.js';

/**
 * Quiet reassurance that the work is being kept.
 *
 * There is no save button, so this is the only thing telling someone their afternoon of planning
 * still exists. It stays out of the way when everything is fine and gets loud only when it is not.
 *
 * On the desktop it also says where the files are, because a local-first app that will not tell you
 * where your data lives is only half keeping the promise.
 */
export function SaveStatus({
  state,
  savedAt,
  ephemeral,
  location,
  onReveal,
}: {
  state: SaveState;
  savedAt: string | undefined;
  ephemeral: boolean;
  location?: string | undefined;
  onReveal?: (() => void) | undefined;
}) {
  if (ephemeral) {
    return (
      <span className="save save--warn">
        Storage is unavailable here, so this trip will be gone when you close the tab.
      </span>
    );
  }

  const status =
    state === 'error'
      ? 'Not saved. Changes are only in this window.'
      : state === 'loading'
        ? 'Opening…'
        : state === 'saving'
          ? 'Saving…'
          : `Saved ${savedAt ? relative(savedAt) : 'on this device'}`;

  return (
    <span className="save">
      <span className={state === 'error' ? 'save--warn' : undefined}>{status}</span>
      {location && onReveal ? (
        <>
          {' '}
          <button type="button" className="link link--rail" onClick={onReveal} title={location}>
            Show files
          </button>
        </>
      ) : null}
    </span>
  );
}

function relative(iso: string): string {
  const seconds = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 45) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  return `${Math.round(hours / 24)} days ago`;
}
