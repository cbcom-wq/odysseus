import { describe, expect, it } from 'vitest';
import {
  addCard,
  addOption,
  addSegment,
  moveSegment,
  removeOption,
  removeSegment,
  syncConnections,
} from './edit.js';
import { card, connection, floatingStayOption, journeyOption, segment, trip } from './test-support.js';

describe('connections follow the stops', () => {
  it('gives a bare list of destinations a way in, between, and home', () => {
    const { trip: synced } = syncConnections(
      trip({
        segments: [
          segment('tokyo', 'Tokyo', { min: 1, ideal: 3, max: 7 }),
          segment('kyoto', 'Kyoto', { min: 1, ideal: 3, max: 7 }),
        ],
      }),
    );

    expect(synced.connections.map((c) => [c.fromSegmentId, c.toSegmentId])).toEqual([
      [null, 'tokyo'],
      ['tokyo', 'kyoto'],
      ['kyoto', null],
    ]);
  });

  it('keeps existing legs and their cards when nothing about them changed', () => {
    const before = trip({
      segments: [segment('a', 'A', { min: 1, ideal: 2, max: 3 })],
      connections: [connection('in', null, 'a'), connection('out', 'a', null)],
      cards: [
        card('c-in', 'flight', { kind: 'connection', connectionId: 'in' }, [
          journeyOption('f', { departDate: '2026-09-01' }),
        ]),
      ],
    });

    const { trip: after, removedCardIds } = syncConnections(before);
    expect(after.connections.map((c) => c.id)).toEqual(['in', 'out']);
    expect(removedCardIds).toEqual([]);
    expect(after.cards).toHaveLength(1);
  });

  it('is idempotent', () => {
    const once = syncConnections(
      trip({ segments: [segment('a', 'A', { min: 1, ideal: 2, max: 3 })] }),
    ).trip;
    const twice = syncConnections(once).trip;
    expect(twice.connections).toEqual(once.connections);
  });
});

describe('adding a stop in the middle', () => {
  const before = (() => {
    const base = syncConnections(
      trip({
        segments: [
          segment('ams', 'Amsterdam', { min: 1, ideal: 2, max: 4 }),
          segment('par', 'Paris', { min: 1, ideal: 3, max: 5 }),
        ],
      }),
    ).trip;

    const leg = base.connections.find((c) => c.fromSegmentId === 'ams' && c.toSegmentId === 'par')!;
    return addCard(
      base,
      card('c-direct', 'flight', { kind: 'connection', connectionId: leg.id }, [
        journeyOption('direct', { departDate: '2026-09-03' }),
      ]),
    );
  })();

  it('reports the leg card it invalidates instead of dropping it quietly', () => {
    // Putting Brussels in between genuinely invalidates the Amsterdam→Paris flight. Removing it is
    // right; doing so without a word is not.
    const { trip: after, removedCardIds } = addSegment(before, 'Brussels', 1);

    expect(after.segments.map((s) => s.id)).toEqual(['ams', 'brussels', 'par']);
    expect(removedCardIds).toEqual(['c-direct']);
    expect(after.cards.find((c) => c.id === 'c-direct')).toBeUndefined();
  });

  it('rebuilds the legs around the new stop', () => {
    const { trip: after } = addSegment(before, 'Brussels', 1);
    expect(after.connections.map((c) => [c.fromSegmentId, c.toSegmentId])).toEqual([
      [null, 'ams'],
      ['ams', 'brussels'],
      ['brussels', 'par'],
      ['par', null],
    ]);
  });

  it('does not collide when the same place is added twice', () => {
    const { trip: after } = addSegment(addSegment(before, 'Bruges').trip, 'Bruges');
    expect(after.segments.map((s) => s.id)).toEqual(['ams', 'par', 'bruges', 'bruges-2']);
  });
});

describe('removing a stop', () => {
  it('takes its cards with it and says which', () => {
    const base = syncConnections(
      trip({
        segments: [
          segment('ams', 'Amsterdam', { min: 1, ideal: 2, max: 4 }),
          segment('par', 'Paris', { min: 1, ideal: 3, max: 5 }),
        ],
      }),
    ).trip;

    const withHotel = addCard(
      base,
      card('c-hotel', 'lodging', { kind: 'segment', segmentId: 'par' }, [
        floatingStayOption('h', { perNight: 150 }),
      ]),
    );

    const { trip: after, removedCardIds } = removeSegment(withHotel, 'par');
    expect(after.segments.map((s) => s.id)).toEqual(['ams']);
    expect(removedCardIds).toContain('c-hotel');
  });
});

describe('reordering', () => {
  it('moves a stop and rebuilds the legs', () => {
    const base = syncConnections(
      trip({
        segments: [
          segment('a', 'A', { min: 1, ideal: 2, max: 3 }),
          segment('b', 'B', { min: 1, ideal: 2, max: 3 }),
          segment('c', 'C', { min: 1, ideal: 2, max: 3 }),
        ],
      }),
    ).trip;

    const { trip: after } = moveSegment(base, 'c', -1);
    expect(after.segments.map((s) => s.id)).toEqual(['a', 'c', 'b']);
  });

  it('refuses to move past the ends', () => {
    const base = trip({ segments: [segment('a', 'A', { min: 1, ideal: 2, max: 3 })] });
    expect(moveSegment(base, 'a', -1).trip.segments.map((s) => s.id)).toEqual(['a']);
  });
});

describe('options you add yourself', () => {
  const base = trip({
    segments: [segment('par', 'Paris', { min: 1, ideal: 3, max: 5 })],
    cards: [
      card(
        'c-hotel',
        'lodging',
        { kind: 'segment', segmentId: 'par' },
        [floatingStayOption('listed', { perNight: 150 })],
        { selected: 'listed' },
      ),
    ],
  });

  it('sit alongside fetched ones', () => {
    const mine = { ...floatingStayOption('mine', { perNight: 120 }), source: 'user' as const };
    const after = addOption(base, 'c-hotel', mine);

    expect(after.cards[0]!.options.map((o) => o.id)).toEqual(['listed', 'mine']);
    expect(after.cards[0]!.selectedOptionId).toBe('listed'); // adding is not choosing
  });

  it('become the choice when the card had nothing chosen', () => {
    const empty = trip({
      segments: base.segments,
      cards: [
        card('c-empty', 'lodging', { kind: 'segment', segmentId: 'par' }, [], { selected: null }),
      ],
    });
    const mine = { ...floatingStayOption('mine', { perNight: 120 }), source: 'user' as const };
    const after = addOption(empty, 'c-empty', mine);

    expect(after.cards[0]!.selectedOptionId).toBe('mine');
    expect(after.cards[0]!.state).toBe('exploring');
  });

  it('fall back to what is left when the chosen one is removed', () => {
    const mine = { ...floatingStayOption('mine', { perNight: 120 }), source: 'user' as const };
    const after = removeOption(addOption(base, 'c-hotel', mine), 'c-hotel', 'listed');

    expect(after.cards[0]!.selectedOptionId).toBe('mine');
  });

  it('leave the card unplanned when the last option goes', () => {
    const after = removeOption(base, 'c-hotel', 'listed');
    expect(after.cards[0]!.selectedOptionId).toBeUndefined();
    expect(after.cards[0]!.state).toBe('unplanned');
  });
});
