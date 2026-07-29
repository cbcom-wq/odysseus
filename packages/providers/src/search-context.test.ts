import { SCHEMA_VERSION } from '@odysseus/domain';
import type { Card, Option, Trip } from '@odysseus/domain';
import { describe, expect, it } from 'vitest';
import { buildSearchQuery } from './search-context.js';

/** Boston → Rio → home: enough structure to give every anchor kind something to point at. */
function build(overrides: Partial<Trip> = {}): Trip {
  return {
    id: 'trip-1',
    name: 'Brazil',
    travelers: 2,
    anchorDate: '2027-03-10',
    length: { min: 10, max: 16 },
    currency: 'USD',
    segments: [
      { id: 'rio', location: { name: 'Rio de Janeiro', code: 'GIG' }, duration: { min: 4, ideal: 4, max: 4 } },
      { id: 'sp', location: { name: 'São Paulo' }, duration: { min: 3, ideal: 3, max: 3 } },
    ],
    connections: [
      { id: 'leg-in', fromSegmentId: null, toSegmentId: 'rio' },
      { id: 'leg-mid', fromSegmentId: 'rio', toSegmentId: 'sp' },
      { id: 'leg-home', fromSegmentId: 'sp', toSegmentId: null },
    ],
    cards: [],
    preferences: { ranking: 'balanced', dayStart: '08:00', dayEnd: '22:00' },
    schemaVersion: SCHEMA_VERSION,
    ...overrides,
  };
}

function cardOn(anchor: Card['anchor'], kind: Card['kind'], options: Option[] = []): Card {
  return { id: 'c-1', kind, state: 'unplanned', anchor, options };
}

/** The same trip before anything dates it. */
function undated(overrides: Partial<Trip> = {}): Trip {
  const { anchorDate: _dropped, ...rest } = build();
  return { ...rest, ...overrides };
}

describe('buildSearchQuery', () => {
  it('describes a dated stay: place, check-in, check-out, nights', () => {
    const q = buildSearchQuery(build(), cardOn({ kind: 'segment', segmentId: 'rio' }, 'lodging'))!;
    expect(q.destination).toBe('Rio de Janeiro');
    expect(q.destinationCode).toBe('GIG');
    expect(q.startDate).toBe('2027-03-10');
    expect(q.endDate).toBe('2027-03-14');
    expect(q.nights).toBe(4);
    expect(q.travelers).toBe(2);
    expect(q.currency).toBe('USD');
  });

  it('pins a day-anchored card to its actual day', () => {
    const q = buildSearchQuery(
      build(),
      cardOn({ kind: 'segment-day', segmentId: 'rio', dayOffset: 2 }, 'activity'),
    )!;
    expect(q.startDate).toBe('2027-03-12');
    expect(q.nights).toBeNull();
  });

  it('gives a middle connection both ends and its travel day', () => {
    const q = buildSearchQuery(
      build(),
      cardOn({ kind: 'connection', connectionId: 'leg-mid' }, 'transport'),
    )!;
    expect(q.origin).toBe('Rio de Janeiro');
    expect(q.destination).toBe('São Paulo');
    expect(q.startDate).toBe('2027-03-14');
  });

  it('leaves origin unknown on the inbound leg and carries the card hints instead', () => {
    const existing: Option = {
      id: 'o-1',
      source: 'user',
      title: 'LATAM 8181',
      detail: 'BOS to GIG, one stop',
      cost: { kind: 'fixed', amount: 900 },
    };
    const q = buildSearchQuery(
      build(),
      cardOn({ kind: 'connection', connectionId: 'leg-in' }, 'flight', [existing]),
    )!;
    expect(q.origin).toBeNull();
    expect(q.destination).toBe('Rio de Janeiro');
    expect(q.hints).toContain('LATAM 8181');
    expect(q.hints).toContain('BOS to GIG, one stop');
  });

  it('leaves destination unknown on the homeward leg', () => {
    const q = buildSearchQuery(
      build(),
      cardOn({ kind: 'connection', connectionId: 'leg-home' }, 'flight'),
    )!;
    expect(q.origin).toBe('São Paulo');
    expect(q.destination).toBeNull();
  });

  it('turns an undated trip with a window into a best-value hunt', () => {
    const flexible = undated({ dateWindow: { earliest: '2027-03-01', latest: '2027-04-30' } });
    const q = buildSearchQuery(
      flexible,
      cardOn({ kind: 'connection', connectionId: 'leg-in' }, 'flight'),
    )!;
    expect(q.startDate).toBeNull();
    expect(q.windowEarliest).toBe('2027-03-01');
    expect(q.windowLatest).toBe('2027-04-30');
    expect(q.lengthMin).toBe(10);
    expect(q.lengthMax).toBe(16);
  });

  it('drops the window once something dates the trip', () => {
    // A stale window would send the search hunting across dates the trip can no longer take.
    const dated = build({ dateWindow: { earliest: '2027-03-01', latest: '2027-04-30' } });
    const q = buildSearchQuery(dated, cardOn({ kind: 'segment', segmentId: 'rio' }, 'lodging'))!;
    expect(q.windowEarliest).toBeNull();
    expect(q.startDate).toBe('2027-03-10');
  });

  it('stays quiet on dates for an undated trip with no window', () => {
    const q = buildSearchQuery(undated(), cardOn({ kind: 'segment', segmentId: 'rio' }, 'lodging'))!;
    expect(q.startDate).toBeNull();
    expect(q.windowEarliest).toBeNull();
  });

  it('has nothing to say about a note', () => {
    expect(
      buildSearchQuery(build(), cardOn({ kind: 'segment', segmentId: 'rio' }, 'note')),
    ).toBeUndefined();
  });
});
