import { SCHEMA_VERSION } from '@odysseus/domain';
import type { Option, Trip } from '@odysseus/domain';
import { describe, expect, it } from 'vitest';
import { addCandidate } from './shortlist.js';

const trip: Trip = {
  id: 'trip-1',
  name: 'Lisbon',
  travelers: 2,
  anchorDate: '2027-03-10',
  length: { min: 5, max: 5 },
  currency: 'USD',
  segments: [{ id: 'lis', location: { name: 'Lisbon' }, duration: { min: 5, ideal: 5, max: 5 } }],
  connections: [{ id: 'leg-1', fromSegmentId: null, toSegmentId: 'lis' }],
  cards: [],
  preferences: { ranking: 'balanced', dayStart: '08:00', dayEnd: '22:00' },
  schemaVersion: SCHEMA_VERSION,
};

const candidate: Option = {
  id: 'found-3',
  source: 'discovered',
  title: 'Jerónimos Monastery',
  cost: { kind: 'fixed', amount: 24 },
  sourceUrl: 'https://example.test/jeronimos',
};

describe('addCandidate', () => {
  it('puts one candidate on the day the traveller chose, as its own card', () => {
    const next = addCandidate(trip, candidate, 'lis', 2)!;
    expect(next.cards).toHaveLength(1);

    const card = next.cards[0]!;
    expect(card.kind).toBe('activity');
    expect(card.anchor).toEqual({ kind: 'segment-day', segmentId: 'lis', dayOffset: 2 });
    expect(card.state).toBe('exploring');
    expect(card.options).toHaveLength(1);
    expect(card.options[0]!.title).toBe('Jerónimos Monastery');
    // Provenance survives: it was found by a search, not typed in.
    expect(card.options[0]!.source).toBe('discovered');
    expect(card.options[0]!.sourceUrl).toBe('https://example.test/jeronimos');
    // Chosen, because accepting a candidate onto a named day *is* the choice.
    expect(card.selectedOptionId).toBe(card.options[0]!.id);
  });

  it('renumbers the option against the card it lands on', () => {
    const next = addCandidate(trip, candidate, 'lis', 0)!;
    const card = next.cards[0]!;
    expect(card.options[0]!.id).toBe(`${card.id}-opt-1`);
  });

  it('adds nothing when the stop was deleted while the shortlist sat there', () => {
    expect(addCandidate(trip, candidate, 'gone', 0)).toBeNull();
  });
});
