import { useState } from 'react';

/**
 * One short question, asked where the answer will land.
 *
 * The shell has no `window.prompt` — Electron does not implement it — so every question has to be
 * asked in the page. That turns out to be the better shape anyway: the field appears in the gap the
 * new stop will fill, so you can see where you are inserting it while you type. Enter commits,
 * Escape backs out, and an empty answer is the same as backing out.
 */
export function InlinePrompt({
  label,
  placeholder,
  choices,
  submitLabel = 'Add',
  onSubmit,
  onCancel,
}: {
  label: string;
  placeholder?: string;
  /** Present when the answer is one of a known set — nights to move hotels on, say. */
  choices?: readonly { value: string; label: string }[];
  submitLabel?: string;
  onSubmit: (value: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(choices?.[0]?.value ?? '');

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const answer = value.trim();
    if (answer) onSubmit(answer);
    else onCancel();
  };

  return (
    <form
      className="inlineq"
      onSubmit={submit}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onCancel();
      }}
    >
      {choices ? (
        <select
          className="inlineq__field select"
          value={value}
          aria-label={label}
          autoFocus
          onChange={(e) => setValue(e.target.value)}
        >
          {choices.map((choice) => (
            <option key={choice.value} value={choice.value}>
              {choice.label}
            </option>
          ))}
        </select>
      ) : (
        <input
          className="inlineq__field"
          value={value}
          aria-label={label}
          placeholder={placeholder}
          autoFocus
          onChange={(e) => setValue(e.target.value)}
          onBlur={() => {
            if (!value.trim()) onCancel();
          }}
        />
      )}
      <button type="submit" className="btn btn--primary btn--small">
        {submitLabel}
      </button>
      <button type="button" className="btn btn--small" onClick={onCancel}>
        Cancel
      </button>
    </form>
  );
}
