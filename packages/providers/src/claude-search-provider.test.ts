import { SCHEMA_VERSION } from '@odysseus/domain';
import type { Card, Trip } from '@odysseus/domain';
import { describe, expect, it } from 'vitest';
import { ClaudeSearchProvider } from './claude-search-provider.js';
import type { DiscoveredOptionFields } from './discovered.js';
import type { SearchQuery } from './search-context.js';

const trip: Trip = {
  id: 'trip-1',
  name: 'Brazil',
  travelers: 3,
  anchorDate: '2027-03-10',
  length: { min: 10, max: 16 },
  currency: 'USD',
  segments: [
    { id: 'rio', location: { name: 'Rio de Janeiro' }, duration: { min: 4, ideal: 4, max: 4 } },
  ],
  connections: [],
  cards: [],
  preferences: { ranking: 'balanced', dayStart: '08:00', dayEnd: '22:00' },
  schemaVersion: SCHEMA_VERSION,
};

const lodging: Card = {
  id: 'c-1',
  kind: 'lodging',
  state: 'unplanned',
  anchor: { kind: 'segment', segmentId: 'rio' },
  options: [],
};

const oneResult: DiscoveredOptionFields = {
  kind: 'lodging',
  title: 'Hotel Fasano',
  detail: null,
  amount: 200,
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
  sourceName: null,
};

describe('ClaudeSearchProvider', () => {
  it('searches anything but notes', () => {
    const provider = new ClaudeSearchProvider(async () => []);
    expect(provider.supports(lodging)).toBe(true);
    expect(provider.supports({ ...lodging, kind: 'note' })).toBe(false);
  });

  it('hands the built query to its transport and converts what comes back', async () => {
    let seen: SearchQuery | undefined;
    const provider = new ClaudeSearchProvider(async (query) => {
      seen = query;
      return [oneResult];
    });

    const options = await provider.fetch(trip, lodging);
    expect(seen?.destination).toBe('Rio de Janeiro');
    expect(options).toHaveLength(1);
    expect(options[0]!.source).toBe('discovered');
  });

  it('returns nothing for a card whose slot cannot be described', async () => {
    const provider = new ClaudeSearchProvider(async () => [oneResult]);
    const orphan: Card = { ...lodging, anchor: { kind: 'segment', segmentId: 'gone' } };
    expect(await provider.fetch(trip, orphan)).toEqual([]);
  });
});
