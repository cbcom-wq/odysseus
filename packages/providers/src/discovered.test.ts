import type { Card } from '@odysseus/domain';
import { describe, expect, it } from 'vitest';
import type { DiscoveredOptionFields } from './discovered.js';
import { discoveredOptions } from './discovered.js';

function fields(overrides: Partial<DiscoveredOptionFields> = {}): DiscoveredOptionFields {
  return {
    kind: 'lodging',
    title: 'Hotel Fasano',
    detail: 'Ipanema, 9.1',
    amount: 320,
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
    warnings: null,
    sourceUrl: 'https://example.com/fasano',
    sourceName: 'Booking.com',
    ...overrides,
  };
}

function emptyCard(kind: Card['kind'] = 'lodging'): Card {
  return { id: 'c-1', kind, state: 'unplanned', anchor: { kind: 'segment', segmentId: 'rio' }, options: [] };
}

describe('discoveredOptions', () => {
  it('marks provenance and carries the source page', () => {
    const [option] = discoveredOptions(emptyCard(), [fields()], 2);
    expect(option!.source).toBe('discovered');
    expect(option!.sourceUrl).toBe('https://example.com/fasano');
    expect(option!.detail).toContain('Booking.com');
  });

  it('multiplies a per-traveller price out to the party, in cents', () => {
    const [option] = discoveredOptions(
      emptyCard('flight'),
      [fields({ kind: 'flight', amount: 1304.05, perTraveler: true, perNight: null })],
      3,
    );
    // 1304.05 × 3 is 3912.1499999999996 in floating point; stored prices stay exact.
    expect(option!.cost).toEqual({ kind: 'fixed', amount: 3912.15 });
  });

  it('keeps lodging as a rate with no timing — a listing is not a reservation', () => {
    const [option] = discoveredOptions(emptyCard(), [fields()], 2);
    expect(option!.cost.kind).toBe('per-night');
    expect(option!.timing).toBeUndefined();
  });

  it('builds journey timing with the form defaults where the source was silent', () => {
    const [option] = discoveredOptions(
      emptyCard('flight'),
      [fields({ kind: 'flight', perNight: null, departDate: '2027-03-10' })],
      2,
    );
    expect(option!.timing).toEqual({
      kind: 'journey',
      departDate: '2027-03-10',
      departTime: '09:00',
      arriveTime: '12:00',
      nightsInTransit: 0,
      durationMinutes: 120,
    });
  });

  it('leaves a dateless journey floating rather than inventing a date', () => {
    const [option] = discoveredOptions(
      emptyCard('flight'),
      [fields({ kind: 'flight', perNight: null, departDate: null })],
      2,
    );
    expect(option!.timing).toBeUndefined();
  });

  it('books a slot for an activity with times', () => {
    const [option] = discoveredOptions(
      emptyCard('activity'),
      [fields({ kind: 'activity', perNight: null, startTime: '09:30', endTime: '15:00' })],
      2,
    );
    expect(option!.timing).toEqual({ kind: 'slot', startTime: '09:30', endTime: '15:00' });
  });

  it('parks round-trip facts in attributes for the app layer to build the second leg from', () => {
    const [option] = discoveredOptions(
      emptyCard('flight'),
      [
        fields({
          kind: 'flight',
          perNight: null,
          departDate: '2027-03-10',
          roundTrip: true,
          returnDate: '2027-03-24',
          returnDepartTime: '21:30',
          returnOvernight: true,
        }),
      ],
      2,
    );
    expect(option!.attributes).toMatchObject({
      roundTrip: true,
      returnDate: '2027-03-24',
      returnDepartTime: '21:30',
      returnOvernight: true,
    });
  });

  it('keeps the caveats the source came with', () => {
    // The finding that made this necessary: a live lodging search returned five real hotels whose
    // every price was a "starting from" figure for different dates, and said so in warnings. Drop
    // those and the traveller reads $146/night as a quote for their stay.
    const [option] = discoveredOptions(
      emptyCard(),
      [
        fields({
          confidence: 'low',
          warnings: ['Rate was a sample stay, not the requested dates', 'Peak season; likely higher'],
        }),
      ],
      2,
    );

    expect(option!.attributes?.['confidence']).toBe('low');
    expect(option!.attributes?.['warnings']).toBe(
      'Rate was a sample stay, not the requested dates · Peak season; likely higher',
    );
  });

  it('says nothing about caveats when the source had none', () => {
    const [option] = discoveredOptions(emptyCard(), [fields({ warnings: [], confidence: 'high' })], 2);
    expect(option!.attributes?.['warnings']).toBeUndefined();
    expect(option!.attributes?.['confidence']).toBe('high');
  });

  it('mints ids that cannot collide with what is already on the card', () => {
    const card: Card = {
      ...emptyCard(),
      options: [
        {
          id: 'c-1-opt-3',
          source: 'user',
          title: 'My hotel',
          cost: { kind: 'per-night', amount: 100 },
        },
      ],
    };
    const options = discoveredOptions(card, [fields(), fields({ title: 'Second' })], 2);
    expect(options.map((o) => o.id)).toEqual(['c-1-opt-4', 'c-1-opt-5']);
  });
});
