import { describe, expect, it } from 'vitest';
import { toDraftPatch } from './draft.js';
import type { ExtractedFields } from './schema.js';
import { buildExtractionSchema } from './schema.js';

/**
 * Flight results quote per-traveller and print the party total in small type beside it. Taken at
 * face value the trip understates its largest line item by the size of the party.
 */

function extracted(over: Partial<ExtractedFields> = {}): ExtractedFields {
  return {
    kind: null,
    title: null,
    detail: null,
    amount: null,
    perNight: null,
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
    confidence: null,
    warnings: null,
    ...over,
  };
}

describe('per-traveller pricing', () => {
  it('reaches the form so the conversion can be seen and corrected', () => {
    const patch = toDraftPatch(extracted({ amount: 1304, perTraveler: true }));
    expect(patch.perTraveler).toBe(true);
    expect(patch.amount).toBe('1304');
  });

  // Absent means the source did not say, and the form keeps whatever it had. A silent `false` here
  // would be the app asserting a whole-party price it was never told.
  it('stays absent when the source did not say', () => {
    expect('perTraveler' in toDraftPatch(extracted({ amount: 1304 }))).toBe(false);
  });

  it('is part of the shape the model must answer', () => {
    const parsed = buildExtractionSchema(['flight']).parse({
      options: [extracted({ kind: 'flight', amount: 1304, perTraveler: true })],
    });
    expect(parsed.options[0]?.perTraveler).toBe(true);
  });
});
