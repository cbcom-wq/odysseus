import { describe, expect, it } from 'vitest';
import { detectPasteKind } from './detect-paste.js';

describe('detectPasteKind', () => {
  it('reads a bare link as a link', () => {
    expect(detectPasteKind({ text: 'https://www.expedia.com/h123456', hasImage: false })).toBe(
      'url',
    );
  });

  it('tolerates the whitespace a copy picks up', () => {
    expect(detectPasteKind({ text: '  https://example.com/flight\n', hasImage: false })).toBe('url');
  });

  it('treats prose containing a link as text', () => {
    // The email is the source, not the link inside it. Reading this as a URL would throw away the
    // confirmation number, the price, and the times.
    const email = 'Your booking is confirmed. Manage it at https://example.com/abc — KLM 602, $412.';
    expect(detectPasteKind({ text: email, hasImage: false })).toBe('text');
  });

  it('prefers the image when a copy carries both', () => {
    // Copying an image out of a browser often puts the page URL on the clipboard alongside it.
    expect(detectPasteKind({ text: 'https://example.com/page', hasImage: true })).toBe('image');
  });

  it('reads an image with no text as an image', () => {
    expect(detectPasteKind({ text: '', hasImage: true })).toBe('image');
  });

  it('falls back to text for anything that is not a link', () => {
    expect(detectPasteKind({ text: 'Hotel Lumiere, $180/night', hasImage: false })).toBe('text');
    expect(detectPasteKind({ text: 'not.a.url', hasImage: false })).toBe('text');
    expect(detectPasteKind({ text: '', hasImage: false })).toBe('text');
  });

  it('ignores schemes that are not web pages', () => {
    // A pasted file path or mail link is not something to go and fetch.
    expect(detectPasteKind({ text: 'file:///C:/trips/itinerary.pdf', hasImage: false })).toBe(
      'text',
    );
    expect(detectPasteKind({ text: 'mailto:someone@example.com', hasImage: false })).toBe('text');
  });
});
