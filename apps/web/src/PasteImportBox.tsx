import type { CardKind } from '@odysseus/domain';
import type {
  DraftPatch,
  ExtractedFields,
  OptionExtractor,
  PasteInput,
  PasteKind,
} from '@odysseus/extraction';
import {
  describeExtractionError,
  detectPasteKind,
  isSupportedImageType,
  runExtraction,
} from '@odysseus/extraction';
import { useRef, useState } from 'react';

/**
 * Paste what you found, instead of typing it out.
 *
 * Most options are not invented in this app — they are found on Google Flights or Expedia or in a
 * confirmation email, and re-keying them is the tax that stops a card from ever having a second
 * option to compare against.
 *
 * Everything here is a shortcut around the form below it, never a gate in front of it. Every
 * failure path ends with the form sitting there, ready to be filled in by hand.
 */

type Status =
  | { readonly state: 'idle' }
  | { readonly state: 'working'; readonly kind: PasteKind }
  | { readonly state: 'done'; readonly kind: PasteKind; readonly note: string | null }
  | { readonly state: 'failed'; readonly message: string };

const SOURCE_LABEL: Record<PasteKind, string> = {
  url: 'that link',
  image: 'that screenshot',
  text: 'what you pasted',
};

/** Read an image off the clipboard as base64, which is how the API wants it. */
function readImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('That image could not be read.'));
    reader.onload = () => {
      // A data URL, of which we want only the payload.
      const result = String(reader.result);
      resolve(result.slice(result.indexOf(',') + 1));
    };
    reader.readAsDataURL(file);
  });
}

/**
 * What is on the clipboard, read synchronously.
 *
 * This has to happen before any `await`. A clipboard event is only inspectable, and only
 * cancellable, during its own dispatch — reach for it after yielding and the data is gone and the
 * browser has already pasted into the field.
 */
function readClipboard(clipboard: DataTransfer): { kind: PasteKind; text: string; image?: File } {
  const text = clipboard.getData('text/plain');
  const image = [...clipboard.items]
    .map((item) => (item.kind === 'file' ? item.getAsFile() : null))
    .find((file): file is File => file !== null && isSupportedImageType(file.type));

  const kind = detectPasteKind({ text, hasImage: image !== undefined });
  return image ? { kind, text, image } : { kind, text };
}

export function PasteImportBox({
  allowedKinds,
  extractor,
  onExtracted,
  onBusyChange,
  onOpenSettings,
}: {
  allowedKinds: readonly CardKind[];
  extractor: OptionExtractor;
  /**
   * The raw fields come through alongside the patch because not everything extracted is a form
   * field. `roundTrip` decides whether saving this builds a second leg, which the form has no way
   * to express and the user should not have to restate.
   */
  onExtracted: (patch: Partial<DraftPatch>, fields: ExtractedFields) => void;
  /** Lets the form disable itself while a paste is being read. */
  onBusyChange: (busy: boolean) => void;
  onOpenSettings: () => void;
}) {
  const [status, setStatus] = useState<Status>({ state: 'idle' });
  const [typed, setTyped] = useState('');
  const abort = useRef<AbortController | null>(null);
  const working = status.state === 'working';

  const read = async (input: PasteInput) => {
    const controller = new AbortController();
    abort.current = controller;
    onBusyChange(true);
    setStatus({ state: 'working', kind: input.kind });

    try {
      const outcome = await runExtraction(extractor, input, {
        allowedKinds,
        signal: controller.signal,
      });

      onExtracted(outcome.patch, outcome.fields);
      setTyped('');
      finish({
        state: 'done',
        kind: input.kind,
        note: outcome.needsReview
          ? (outcome.warnings[0] ?? 'Worth checking the dates and price against the source.')
          : null,
      });
    } catch (error) {
      const { failure, message } = describeExtractionError(error);
      // A cancel is the user's own doing; drop back to idle rather than reporting it at them.
      finish(failure === 'cancelled' ? { state: 'idle' } : { state: 'failed', message });
    }
  };

  function finish(next: Status) {
    abort.current = null;
    onBusyChange(false);
    setStatus(next);
  }

  const handlePaste = (event: React.ClipboardEvent) => {
    if (working) return;

    const { kind, text, image } = readClipboard(event.clipboardData);

    // A screenshot has nothing sensible to show in a text box and a wall of pasted text would swamp
    // it, so those two never reach the field. A link is short and worth seeing, so it lands
    // normally. Both decisions have to be made now, while the event is still cancellable.
    if (kind !== 'url') event.preventDefault();

    if (kind === 'image') {
      if (!image || !isSupportedImageType(image.type)) return;
      const mediaType = image.type;
      void readImage(image)
        .then((base64) => read({ kind: 'image', base64, mediaType }))
        .catch(() => finish({ state: 'failed', message: 'That image could not be read.' }));
      return;
    }

    if (text.trim() === '') return;
    void read(kind === 'url' ? { kind: 'url', url: text.trim() } : { kind: 'text', text });
  };

  // Typed, dropped, or pasted through a context menu that gave us no clipboard event.
  const readTyped = () => {
    const text = typed.trim();
    if (text === '') return;
    void read(detectPasteKind({ text, hasImage: false }) === 'url'
      ? { kind: 'url', url: text }
      : { kind: 'text', text });
  };

  const cancel = () => abort.current?.abort();

  // Only the API backend can be unready, and only for want of a key.
  if (!extractor.ready) {
    return (
      <div className="paste paste--muted">
        <span>Found this somewhere else?</span>{' '}
        <button type="button" className="linkish" onClick={onOpenSettings}>
          Add an API key
        </button>{' '}
        <span>
          and paste the link, a screenshot, or the text. The desktop app does this without a key,
          using Claude Code.
        </span>
      </div>
    );
  }

  return (
    <div className="paste">
      <label className="label" htmlFor="paste-import">
        Found it somewhere else?
      </label>

      <div className="paste__row">
        <input
          id="paste-import"
          className="paste__input"
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          onKeyDown={(e) => {
            // Enter here means "read this", not "save the card" — the form is not finished yet.
            if (e.key === 'Enter') {
              e.preventDefault();
              readTyped();
            }
          }}
          placeholder={
            working ? `Reading ${SOURCE_LABEL[status.kind]}…` : 'Paste a link, screenshot, or text'
          }
          onPaste={handlePaste}
          disabled={working}
          aria-busy={working}
          aria-describedby="paste-import-status"
        />
        {working ? (
          <button type="button" className="btn" onClick={cancel}>
            Cancel
          </button>
        ) : typed.trim() !== '' ? (
          <button type="button" className="btn" onClick={readTyped}>
            Read it
          </button>
        ) : null}
      </div>

      <div className="field__hint" id="paste-import-status" role="status">
        {status.state === 'idle'
          ? 'Everything below stays editable — this only fills it in.'
          : null}
        {status.state === 'working' ? 'Reading it now.' : null}
        {status.state === 'done'
          ? `Filled in from ${SOURCE_LABEL[status.kind]}.${status.note ? ` ${status.note}` : ' Check it over before saving.'}`
          : null}
        {status.state === 'failed' ? status.message : null}
      </div>
    </div>
  );
}
