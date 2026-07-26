import { describe, expect, it } from 'vitest';
import { needsReviewNote, toDraftPatch } from './draft.js';
import type { ExtractedFields } from './schema.js';

function extracted(over: Partial<ExtractedFields> = {}): ExtractedFields {
  return {
    kind: null,
    title: null,
    detail: null,
    amount: null,
    perNight: null,
    departDate: null,
    departTime: null,
    arriveTime: null,
    overnight: null,
    durationMinutes: null,
    startTime: null,
    endTime: null,
    confidence: null,
    warnings: null,
    ...over,
  };
}

describe('toDraftPatch', () => {
  it('carries every field the extractor filled', () => {
    const patch = toDraftPatch(
      extracted({
        kind: 'flight',
        title: 'KLM 602',
        detail: 'ORD to AMS, nonstop',
        amount: 412,
        perNight: false,
        departDate: '2026-09-23',
        departTime: '19:45',
        arriveTime: '11:35',
        overnight: true,
        durationMinutes: 445,
      }),
    );

    expect(patch).toEqual({
      kind: 'flight',
      title: 'KLM 602',
      detail: 'ORD to AMS, nonstop',
      amount: '412',
      perNight: false,
      departDate: '2026-09-23',
      departTime: '19:45',
      arriveTime: '11:35',
      overnight: true,
      durationMinutes: '445',
    });
  });

  it('leaves out anything the source did not state', () => {
    // Absent keys are the whole mechanism: spreading this over a draft must not blank out fields
    // the user already typed just because the listing was quiet about them.
    const patch = toDraftPatch(extracted({ title: 'Hotel Lumiere' }));
    expect(Object.keys(patch)).toEqual(['title']);
    expect('amount' in patch).toBe(false);
    expect('departDate' in patch).toBe(false);
  });

  it('keeps what the user typed where the extractor found nothing', () => {
    const typed = { title: 'my note to self', amount: '95', detail: 'ask about parking' };
    const merged = { ...typed, ...toDraftPatch(extracted({ title: 'Hotel Bravo' })) };

    expect(merged.title).toBe('Hotel Bravo'); // extractor wins where it has an answer
    expect(merged.amount).toBe('95'); // and stays out of the way where it does not
    expect(merged.detail).toBe('ask about parking');
  });

  it('turns numbers into the strings the form binds to', () => {
    const patch = toDraftPatch(extracted({ amount: 180, durationMinutes: 0 }));
    expect(patch.amount).toBe('180');
    expect(patch.durationMinutes).toBe('0');
  });

  it('keeps false rather than dropping it', () => {
    // `overnight: false` is a real answer — a same-day flight — not a missing one.
    const patch = toDraftPatch(extracted({ overnight: false, perNight: false }));
    expect(patch.overnight).toBe(false);
    expect(patch.perNight).toBe(false);
  });

  it('records where a link-sourced option came from', () => {
    const patch = toDraftPatch(extracted({ title: 'KLM 602' }), 'https://example.com/f/602');
    expect(patch.sourceUrl).toBe('https://example.com/f/602');
  });

  it('omits the source when there was no link', () => {
    // A screenshot or pasted text has no URL to remember.
    expect('sourceUrl' in toDraftPatch(extracted({ title: 'KLM 602' }))).toBe(false);
    expect('sourceUrl' in toDraftPatch(extracted({ title: 'KLM 602' }), '')).toBe(false);
  });
});

describe('needsReviewNote', () => {
  it('stays quiet when the source was plain and nothing was assumed', () => {
    expect(needsReviewNote(extracted({ confidence: 'high', warnings: [] }))).toBe(false);
  });

  it('speaks up when the model was unsure', () => {
    expect(needsReviewNote(extracted({ confidence: 'medium', warnings: [] }))).toBe(true);
    expect(needsReviewNote(extracted({ confidence: 'low', warnings: [] }))).toBe(true);
  });

  it('speaks up when something had to be assumed, however confident', () => {
    expect(
      needsReviewNote(extracted({ confidence: 'high', warnings: ['no year shown; assumed 2026'] })),
    ).toBe(true);
  });

  it('stays quiet when the model said nothing either way', () => {
    expect(needsReviewNote(extracted())).toBe(false);
  });
});
