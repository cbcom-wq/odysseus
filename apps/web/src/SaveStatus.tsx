import type { SaveState } from './useTripStore.js';

/**
 * Quiet reassurance that the work is being kept.
 *
 * There is no save button, so this is the only thing telling someone their afternoon of planning
 * still exists. It stays out of the way when everything is fine and gets loud only when it is not.
 */
export function SaveStatus({
  state,
  savedAt,
  ephemeral,
}: {
  state: SaveState;
  savedAt: string | undefined;
  ephemeral: boolean;
}) {
  if (ephemeral) {
    return (
      <span className="save save--warn">
        Storage is unavailable here, so this trip will be gone when you close the tab.
      </span>
    );
  }

  if (state === 'error') return <span className="save save--warn">Not saved. Changes are only in this tab.</span>;
  if (state === 'loading') return <span className="save">Opening…</span>;
  if (state === 'saving') return <span className="save">Saving…</span>;

  return <span className="save">Saved {savedAt ? relative(savedAt) : 'on this device'}</span>;
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
