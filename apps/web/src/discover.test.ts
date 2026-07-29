import { SCHEMA_VERSION } from '@odysseus/domain';
import type { Card, Option, Trip } from '@odysseus/domain';
import { describe, expect, it } from 'vitest';
import { applyDiscovery } from './discover.js';

/** Boston → Lisbon → home, one flight card on the way out, nothing home yet. */
function build(cards: Card[]): Trip {
  return {
    id: 'trip-1',
    name: 'Lisbon',
    travelers: 2,
    anchorDate: '2027-03-10',
    length: { min: 5, max: 5 },
    currency: 'USD',
    segments: [
      { id: 'lis', location: { name: 'Lisbon' }, duration: { min: 5, ideal: 5, max: 5 } },
    ],
    connections: [
      { id: 'leg-1', fromSegmentId: null, toSegmentId: 'lis' },
      { id: 'leg-2', fromSegmentId: 'lis', toSegmentId: null },
    ],
    cards,
    preferences: { ranking: 'balanced', dayStart: '08:00', dayEnd: '22:00' },
    schemaVersion: SCHEMA_VERSION,
  };
}

const flightCard = (options: Option[], selected?: string): Card => ({
  id: 'card-out',
  kind: 'flight',
  state: 'exploring',
  anchor: { kind: 'connection', connectionId: 'leg-1' },
  options,
  ...(selected === undefined ? {} : { selectedOptionId: selected }),
});

const userOption: Option = {
  id: 'card-out-opt-1',
  source: 'user',
  title: 'TAP 218',
  cost: { kind: 'fixed', amount: 900 },
  timing: {
    kind: 'journey',
    departDate: '2027-03-10',
    departTime: '20:00',
    arriveTime: '08:00',
    nightsInTransit: 1,
    durationMinutes: 720,
  },
};

function foundFare(id: string, opts: { roundTrip?: boolean } = {}): Option {
  return {
    id,
    source: 'discovered',
    title: `Found ${id}`,
    cost: { kind: 'fixed', amount: 1304 },
    timing: {
      kind: 'journey',
      departDate: '2027-03-10',
      departTime: '09:00',
      arriveTime: '12:00',
      nightsInTransit: 0,
      durationMinutes: 480,
    },
    sourceUrl: 'https://example.com/fare',
    ...(opts.roundTrip
      ? {
          attributes: {
            roundTrip: true,
            returnDate: '2027-03-15',
            returnDepartTime: '21:30',
            returnArriveTime: '09:35',
            returnOvernight: true,
            returnDurationMinutes: 845,
          },
        }
      : {}),
  };
}

describe('applyDiscovery', () => {
  it('adds found options without choosing any of them', () => {
    const start = build([flightCard([userOption], 'card-out-opt-1')]);
    const result = applyDiscovery(start, 'card-out', [foundFare('card-out-opt-2')]);

    const card = result.trip.cards.find((c) => c.id === 'card-out')!;
    expect(card.options.map((o) => o.id)).toEqual(['card-out-opt-1', 'card-out-opt-2']);
    // The user's choice stands; discovery only ever offers.
    expect(card.selectedOptionId).toBe('card-out-opt-1');
  });

  it('builds a discovered return leg for a round-trip fare, and selects neither half', () => {
    const start = build([flightCard([userOption], 'card-out-opt-1')]);
    const result = applyDiscovery(start, 'card-out', [
      foundFare('card-out-opt-2', { roundTrip: true }),
    ]);

    const back = result.trip.cards.find((c) => c.id !== 'card-out')!;
    expect(back.kind).toBe('flight');
    expect(back.options).toHaveLength(1);
    expect(back.options[0]!.source).toBe('discovered');
    // The checkout page's own times, not a blank placeholder.
    expect(back.options[0]!.timing).toMatchObject({ departDate: '2027-03-15', departTime: '21:30' });
    expect(back.selectedOptionId).toBeUndefined();

    // The fare was split across the legs, half each.
    const outbound = result.trip.cards.find((c) => c.id === 'card-out')!;
    expect(outbound.options.find((o) => o.id === 'card-out-opt-2')!.cost.amount).toBe(652);
  });

  it('replaces earlier discovered options and takes their far legs with them', () => {
    const start = build([flightCard([userOption], 'card-out-opt-1')]);
    const first = applyDiscovery(start, 'card-out', [
      foundFare('card-out-opt-2', { roundTrip: true }),
    ]);

    const second = applyDiscovery(first.trip, 'card-out', [foundFare('card-out-opt-3')]);

    const outbound = second.trip.cards.find((c) => c.id === 'card-out')!;
    // The traveller's own option survives; exactly one found option is there, and it is the new
    // one. Asserting on the titles rather than the id numbers, which are a consequence of what
    // the cleanup freed up and carry no meaning of their own.
    expect(outbound.options.filter((o) => o.source === 'user')).toHaveLength(1);
    const discovered = outbound.options.filter((o) => o.source === 'discovered');
    expect(discovered).toHaveLength(1);
    expect(discovered[0]!.title).toBe('Found card-out-opt-3');

    // The old fare's leg home went with it — nothing left half-priced on the homeward card.
    const back = second.trip.cards.find((c) => c.id !== 'card-out')!;
    expect(back.options).toEqual([]);
  });

  it('re-numbers arrivals against the card as it is now, not as it was at click time', () => {
    // A search runs for minutes and the app stays live. Ids were minted when the button was
    // clicked, so an option the traveller adds while waiting takes the number the search already
    // claimed — and two options sharing an id means choosing one silently chooses the other.
    const start = build([flightCard([userOption], 'card-out-opt-1')]);
    const addedWhileWaiting: Option = {
      id: 'card-out-opt-2',
      source: 'user',
      title: 'Found it myself',
      cost: { kind: 'fixed', amount: 700 },
    };
    const meanwhile = build([
      flightCard([userOption, addedWhileWaiting], 'card-out-opt-1'),
    ]);

    // What the search came back with, numbered against `start`, where opt-2 was still free.
    const result = applyDiscovery(meanwhile, 'card-out', [foundFare('card-out-opt-2')]);

    const card = result.trip.cards.find((c) => c.id === 'card-out')!;
    const ids = card.options.map((o) => o.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(card.options.filter((o) => o.source === 'user')).toHaveLength(2);
    expect(card.options.filter((o) => o.source === 'discovered')).toHaveLength(1);
  });

  it('moves an untouched card to exploring, because that is what it is now doing', () => {
    // A card holding five candidates and reading "unplanned" is telling the traveller something
    // untrue. Exploring is exactly the state of having options and no decision.
    const fresh: Card = {
      id: 'card-out',
      kind: 'flight',
      state: 'unplanned',
      anchor: { kind: 'connection', connectionId: 'leg-1' },
      options: [],
    };
    const result = applyDiscovery(build([fresh]), 'card-out', [foundFare('card-out-opt-1')]);

    const card = result.trip.cards.find((c) => c.id === 'card-out')!;
    expect(card.state).toBe('exploring');
    // Still nothing chosen — exploring is not deciding.
    expect(card.selectedOptionId).toBeUndefined();
  });

  it('leaves a decided card in the state the traveller put it in', () => {
    const start = build([flightCard([userOption], 'card-out-opt-1')]);
    const decided = {
      ...start,
      cards: start.cards.map((c) => ({ ...c, state: 'selected' as const })),
    };
    const result = applyDiscovery(decided, 'card-out', [foundFare('card-out-opt-2')]);
    expect(result.trip.cards.find((c) => c.id === 'card-out')!.state).toBe('selected');
  });

  it('reports how many arrived, for the notice', () => {
    const start = build([flightCard([userOption])]);
    const result = applyDiscovery(start, 'card-out', [
      foundFare('card-out-opt-2'),
      foundFare('card-out-opt-3'),
    ]);
    expect(result.added).toBe(2);
  });
});
