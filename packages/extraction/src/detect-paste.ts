/**
 * What did the user just paste?
 *
 * One box accepts a link, a screenshot, or copied text, so something has to decide which arrived.
 * That decision is pure and lives here rather than in the paste handler, because it is the part with
 * edge cases worth testing and the paste handler is the part that cannot be tested without a
 * clipboard.
 */

export type PasteKind = 'url' | 'image' | 'text';

export interface PasteContent {
  readonly text: string;
  readonly hasImage: boolean;
}

function isHttpUrl(candidate: string): boolean {
  try {
    const url = new URL(candidate);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Classify a paste.
 *
 * An image wins outright: copying an image from a browser often puts its page URL on the clipboard
 * too, and the picture is the richer source.
 *
 * Text only counts as a link when the *whole* paste is one. A confirmation email quoting a booking
 * URL is still an email, and reading it as a link would throw away everything around it — so any
 * whitespace at all disqualifies it. That is stricter than hunting for a URL inside the text, and
 * deliberately so: guessing wrong sends the wrong extractor at the content.
 */
export function detectPasteKind(content: PasteContent): PasteKind {
  if (content.hasImage) return 'image';

  const trimmed = content.text.trim();
  if (trimmed.length > 0 && !/\s/.test(trimmed) && isHttpUrl(trimmed)) return 'url';

  return 'text';
}
