import { describe, expect, it } from 'vitest';
import { buildExtractionSchema } from './schema.js';

const FULL = {
  kind: 'flight',
  title: 'KLM 602',
  detail: 'ORD to AMS, nonstop',
  amount: 412,
  perNight: false,
  perTraveler: true,
  departDate: '2026-09-23',
  departTime: '19:45',
  arriveTime: '11:35',
  overnight: true,
  durationMinutes: 445,
  startTime: null,
  endTime: null,
  roundTrip: true,
  returnDate: '2026-09-28',
  returnDepartTime: '21:30',
  returnArriveTime: '09:35',
  returnOvernight: true,
  returnDurationMinutes: 845,
  confidence: 'high',
  warnings: [],
};

describe('buildExtractionSchema', () => {
  it('accepts a fully populated result', () => {
    const parsed = buildExtractionSchema(['flight', 'transport']).parse({ options: [FULL] });
    expect(parsed.options[0]?.title).toBe('KLM 602');
    expect(parsed.options[0]?.overnight).toBe(true);
    expect(parsed.options[0]?.durationMinutes).toBe(445);
  });

  // Real screenshots hold several candidates. Returning one meant discarding the rest.
  it('accepts several options from one source', () => {
    const parsed = buildExtractionSchema(['flight']).parse({
      options: [FULL, { ...FULL, title: 'American 900', amount: 1301 }],
    });
    expect(parsed.options).toHaveLength(2);
    expect(parsed.options[1]?.amount).toBe(1301);
  });

  // Nothing found is a failure to report, not an empty list to quietly merge into the form.
  it('rejects an empty list', () => {
    expect(() => buildExtractionSchema(['flight']).parse({ options: [] })).toThrow();
  });

  it('accepts a result where the source said almost nothing', () => {
    // A hotel name and a rate is a legitimate option. Most sources are partial.
    const sparse = Object.fromEntries(Object.keys(FULL).map((k) => [k, null]));
    const parsed = buildExtractionSchema(['lodging']).parse({
      options: [{ ...sparse, kind: 'lodging', title: 'Hotel Lumiere', amount: 180, perNight: true }],
    });
    expect(parsed.options[0]?.title).toBe('Hotel Lumiere');
    expect(parsed.options[0]?.departDate).toBeNull();
  });

  it('narrows kind to the kinds the slot accepts', () => {
    // Lodging cannot go on a connection, so the model must not be able to answer with it.
    expect(() =>
      buildExtractionSchema(['flight', 'transport']).parse({ options: [FULL] }),
    ).not.toThrow();
    expect(() => buildExtractionSchema(['lodging', 'note']).parse({ options: [FULL] })).toThrow();
  });

  it('rejects a kind that is not a card kind at all', () => {
    expect(() =>
      buildExtractionSchema(['flight']).parse({ ...FULL, kind: 'spaceship' }),
    ).toThrow();
  });

  it('rejects a price that came back as text', () => {
    // "$412" would sail through a string field and then quietly become NaN in the form.
    expect(() => buildExtractionSchema(['flight']).parse({ ...FULL, amount: '$412' })).toThrow();
  });

  it('rejects a confidence outside the three levels', () => {
    expect(() =>
      buildExtractionSchema(['flight']).parse({ ...FULL, confidence: 'quite sure' }),
    ).toThrow();
  });

  it('refuses to build a schema with no allowed kinds', () => {
    // An empty enum would make every answer invalid, which is a bug worth catching here.
    expect(() => buildExtractionSchema([])).toThrow(/at least one/i);
  });
});
