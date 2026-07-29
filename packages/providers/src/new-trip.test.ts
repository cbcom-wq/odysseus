import { describe, expect, it } from 'vitest';
import { buildNewTrip } from './new-trip.js';

describe('a trip that knows roughly when, but not exactly', () => {
  it('carries the window when no start date was given', () => {
    const trip = buildNewTrip({
      name: 'Brazil',
      travelers: 2,
      nights: { min: 10, max: 16 },
      destinations: ['Rio de Janeiro'],
      window: { earliest: '2027-03-01', latest: '2027-04-30' },
    });
    expect(trip.anchorDate).toBeUndefined();
    expect(trip.dateWindow).toEqual({ earliest: '2027-03-01', latest: '2027-04-30' });
  });

  it('ignores the window when an exact date was given — the date is the answer', () => {
    const trip = buildNewTrip({
      name: 'Brazil',
      travelers: 2,
      nights: { min: 10, max: 16 },
      destinations: ['Rio de Janeiro'],
      startDate: '2027-03-10',
      window: { earliest: '2027-03-01', latest: '2027-04-30' },
    });
    expect(trip.anchorDate).toBe('2027-03-10');
    expect(trip.dateWindow).toBeUndefined();
  });
});
