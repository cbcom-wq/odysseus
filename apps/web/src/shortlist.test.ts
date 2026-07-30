import { SCHEMA_VERSION } from '@odysseus/domain';
import type { Option, Trip } from '@odysseus/domain';
import { describe, expect, it } from 'vitest';
import { addCandidate, stampCandidates } from './shortlist.js';

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

describe('stampCandidates', () => {
  // Every "things to do" search runs against the same throwaway card (id 'pending', no options),
  // so `discoveredOptions` mints the same ids for every search — this is what a real search result
  // looks like before stamping, not a contrived collision.
  const found: readonly Option[] = [
    {
      id: 'pending-opt-1',
      source: 'discovered',
      title: 'Jerónimos Monastery',
      detail: 'Free on Sundays — Lonely Planet',
      cost: { kind: 'fixed', amount: 24 },
      sourceUrl: 'https://example.test/jeronimos',
    },
    {
      id: 'pending-opt-2',
      source: 'discovered',
      title: 'LX Factory food tour',
      cost: { kind: 'fixed', amount: 65 },
    },
  ];

  it('gives every candidate in a batch a unique id', () => {
    const stamped = stampCandidates(found, 'lis', 1);
    const ids = stamped.map((o) => o.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('never collides across two batches for the same segment, even with identical input', () => {
    const first = stampCandidates(found, 'lis', 1);
    const second = stampCandidates(found, 'lis', 2);
    const overlap = first.filter((a) => second.some((b) => b.id === a.id));
    expect(overlap).toHaveLength(0);
  });

  it('never collides across two segments searched at the same batch number', () => {
    const lisbon = stampCandidates(found, 'lis', 1);
    const porto = stampCandidates(found, 'porto', 1);
    const overlap = lisbon.filter((a) => porto.some((b) => b.id === a.id));
    expect(overlap).toHaveLength(0);
  });

  it('leaves everything but the id untouched', () => {
    const stamped = stampCandidates(found, 'lis', 1);
    expect(stamped[0]).toMatchObject({
      source: 'discovered',
      title: 'Jerónimos Monastery',
      detail: 'Free on Sundays — Lonely Planet',
      cost: { kind: 'fixed', amount: 24 },
      sourceUrl: 'https://example.test/jeronimos',
    });
    expect(stamped[1]).toMatchObject({
      source: 'discovered',
      title: 'LX Factory food tour',
      cost: { kind: 'fixed', amount: 65 },
    });
    // The id itself changed, and changed away from the collision-prone original.
    expect(stamped[0]!.id).not.toBe('pending-opt-1');
    expect(stamped[1]!.id).not.toBe('pending-opt-2');
  });
});
