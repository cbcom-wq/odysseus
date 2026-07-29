import { describe, expect, it } from 'vitest';
import { buildSearchResultSchema } from './search-schema.js';

/** A complete, plausible discovered option, for tests to vary one field at a time. */
function found(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    kind: 'lodging',
    title: 'Hotel Lumiere',
    detail: 'Le Marais, 8.7, free cancellation',
    amount: 180,
    perNight: true,
    perTraveler: null,
    departDate: null,
    departTime: null,
    arriveTime: null,
    overnight: null,
    durationMinutes: null,
    startTime: null,
    endTime: null,
    roundTrip: null,
    returnDate: null,
    returnDepartTime: null,
    returnArriveTime: null,
    returnOvernight: null,
    returnDurationMinutes: null,
    confidence: 'high',
    warnings: [],
    sourceUrl: 'https://example.com/hotels/lumiere',
    sourceName: 'Booking.com',
    ...overrides,
  };
}

describe('buildSearchResultSchema', () => {
  it('accepts a found option with its source attached', () => {
    const parsed = buildSearchResultSchema('lodging').parse({ options: [found()] });
    expect(parsed.options[0]!.sourceUrl).toBe('https://example.com/hotels/lumiere');
    expect(parsed.options[0]!.sourceName).toBe('Booking.com');
  });

  it('refuses an option with no source page', () => {
    // An option the model cannot attribute to a page it visited is not reportable.
    const schema = buildSearchResultSchema('lodging');
    expect(() => schema.parse({ options: [found({ sourceUrl: null })] })).toThrow();
    expect(() => schema.parse({ options: [found({ sourceUrl: 'about:blank' })] })).toThrow();
  });

  it('treats an empty list as an answer, not a failure', () => {
    // A paste that yields nothing is a failure to report; a search that finds nothing is a result.
    expect(buildSearchResultSchema('lodging').parse({ options: [] }).options).toEqual([]);
  });

  it('pins kind to the slot being searched', () => {
    const schema = buildSearchResultSchema('lodging');
    expect(() => schema.parse({ options: [found({ kind: 'flight' })] })).toThrow();
  });
});
