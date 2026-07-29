import { SCHEMA_VERSION } from '@odysseus/domain';
import type { Card, Option, Trip } from '@odysseus/domain';
import { describe, expect, it } from 'vitest';
import { landSearchResults, slotSearchTarget } from './slot-search.js';

/** Home → Lisbon → home, nothing on either leg. */
function build(cards: Card[] = []): Trip {
  return {
    id: 'trip-1',
    name: 'Lisbon',
    travelers: 2,
    anchorDate: '2027-03-10',
    length: { min: 5, max: 5 },
    currency: 'USD',
    segments: [{ id: 'lis', location: { name: 'Lisbon' }, duration: { min: 5, ideal: 5, max: 5 } }],
    connections: [
      { id: 'leg-1', fromSegmentId: null, toSegmentId: 'lis' },
      { id: 'leg-2', fromSegmentId: 'lis', toSegmentId: null },
    ],
    cards,
    preferences: { ranking: 'balanced', dayStart: '08:00', dayEnd: '22:00' },
    schemaVersion: SCHEMA_VERSION,
  };
}

const found: Option[] = [
  { id: 'x1', source: 'discovered', title: 'TAP 218', cost: { kind: 'fixed', amount: 640 } },
  { id: 'x2', source: 'discovered', title: 'TAP 224', cost: { kind: 'fixed', amount: 710 } },
];

const outbound = { kind: 'connection', connectionId: 'leg-1' } as const;

describe('slotSearchTarget', () => {
  it('builds a card that never enters the trip when the slot is empty', () => {
    const target = slotSearchTarget({
      existing: undefined,
      anchor: outbound,
      kind: 'flight',
      slotKey: 'connection:leg-1:flight',
    });
    expect(target.ephemeral).toBe(true);
    expect(target.key).toBe('connection:leg-1:flight');
    expect(target.card.kind).toBe('flight');
    expect(target.card.anchor).toEqual(outbound);
    expect(target.card.options).toEqual([]);
  });

  it('searches the card already there, so a re-search cleans up after itself', () => {
    const card: Card = {
      id: 'card-1',
      kind: 'flight',
      state: 'exploring',
      anchor: outbound,
      options: [],
    };
    const target = slotSearchTarget({
      existing: card,
      anchor: outbound,
      kind: 'flight',
      slotKey: 'connection:leg-1:flight',
    });
    expect(target.ephemeral).toBe(false);
    expect(target.key).toBe('card-1');
    expect(target.card).toBe(card);
  });
});

describe('landSearchResults', () => {
  it('creates the card only now, with the options on it and nothing chosen', () => {
    const target = slotSearchTarget({
      existing: undefined,
      anchor: outbound,
      kind: 'flight',
      slotKey: 'connection:leg-1:flight',
    });
    const outcome = landSearchResults(build(), target, found);
    expect(outcome).not.toBeNull();

    const created = outcome!.trip.cards;
    expect(created).toHaveLength(1);
    expect(created[0]!.kind).toBe('flight');
    expect(created[0]!.anchor).toEqual(outbound);
    expect(created[0]!.state).toBe('exploring');
    expect(created[0]!.selectedOptionId).toBeUndefined();
    expect(created[0]!.options.map((o) => o.title)).toEqual(['TAP 218', 'TAP 224']);
    expect(outcome!.added).toBe(2);
  });

  it('adds nothing when the leg was deleted while the search ran', () => {
    const target = slotSearchTarget({
      existing: undefined,
      anchor: { kind: 'connection', connectionId: 'leg-gone' },
      kind: 'flight',
      slotKey: 'connection:leg-gone:flight',
    });
    expect(landSearchResults(build(), target, found)).toBeNull();
  });

  it('adds nothing when the card it was searching for was removed', () => {
    const card: Card = {
      id: 'card-1',
      kind: 'flight',
      state: 'exploring',
      anchor: outbound,
      options: [],
    };
    const target = slotSearchTarget({
      existing: card,
      anchor: outbound,
      kind: 'flight',
      slotKey: 'connection:leg-1:flight',
    });
    expect(landSearchResults(build(), target, found)).toBeNull();
  });
});
