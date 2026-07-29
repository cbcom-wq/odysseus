import { describe, expect, it } from 'vitest';
import {
  addCard,
  addOption,
  addSegment,
  moveCardToDay,
  moveSegment,
  removeCard,
  removeOption,
  removeSegment,
  splitStay,
  syncConnections,
  updateOption,
} from './edit.js';
import { placeCards } from './layout.js';
import { schedule } from './scheduler.js';
import {
  card,
  connection,
  floatingStayOption,
  journeyOption,
  segment,
  slotOption,
  trip,
} from './test-support.js';
import type { Trip } from './types.js';

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

  it('keep the link they were found at', () => {
    // Somewhere to go back to. It is carried, never followed — see the note on Option.sourceUrl.
    const found = {
      ...floatingStayOption('found', { perNight: 120 }),
      source: 'user' as const,
      sourceUrl: 'https://example.com/hotels/bravo',
    };

    const added = addOption(base, 'c-hotel', found);
    expect(added.cards[0]!.options[1]!.sourceUrl).toBe('https://example.com/hotels/bravo');

    const edited = updateOption(added, 'c-hotel', { ...found, title: 'Hotel Bravo, renamed' });
    expect(edited.cards[0]!.options[1]!.sourceUrl).toBe('https://example.com/hotels/bravo');
  });
});

describe('moveCardToDay', () => {
  const withActivity = (dayOffset: number) =>
    trip({
      anchorDate: '2026-04-11',
      segments: [segment('par', 'Paris', { min: 1, ideal: 5, max: 5 })],
      connections: [],
      cards: [
        card('c-tour', 'activity', { kind: 'segment-day', segmentId: 'par', dayOffset }, [
          slotOption('versailles', { startTime: '09:30', endTime: '15:00' }),
        ]),
      ],
    });

  it('moves a card to another day of its stay', () => {
    // There was no way to say this at all: an activity attached to a stop landed on day one whatever
    // the traveller meant, which put a 09:30 tour on the morning of an 08:45 landing.
    const moved = moveCardToDay(withActivity(0), 'c-tour', 2);
    expect(moved.cards[0]!.anchor).toEqual({
      kind: 'segment-day',
      segmentId: 'par',
      dayOffset: 2,
    });
  });

  it('keeps the anchor relative, so the card still travels with a reflow', () => {
    const moved = moveCardToDay(withActivity(0), 'c-tour', 2);
    expect(moved.cards[0]!.anchor.kind).toBe('segment-day');
  });

  it('rescues an orphan rather than leaving deletion as the only way out', () => {
    // A card stranded past the end of a shortened stay could previously only be edited — with no
    // day field — or removed.
    const stranded = withActivity(4);
    const shortened: Trip = {
      ...stranded,
      segments: stranded.segments.map((s) => ({ ...s, duration: { min: 1, ideal: 2, max: 2 } })),
    };
    expect(placeCards(shortened, schedule(shortened))[0]!.orphaned).toBe(true);

    const rescued = moveCardToDay(shortened, 'c-tour', 1);
    expect(placeCards(rescued, schedule(rescued))[0]!.orphaned).toBe(false);
  });

  it('leaves a card anchored to the whole stay alone', () => {
    const t = trip({
      segments: [segment('par', 'Paris', { min: 1, ideal: 5, max: 5 })],
      cards: [
        card('c-hotel', 'lodging', { kind: 'segment', segmentId: 'par' }, [
          floatingStayOption('hotel', { perNight: 165 }),
        ]),
      ],
    });
    expect(moveCardToDay(t, 'c-hotel', 3).cards[0]!.anchor).toEqual({
      kind: 'segment',
      segmentId: 'par',
    });
  });
});

describe('splitting a stay', () => {
  const paris = trip({
    anchorDate: '2026-09-27',
    segments: [segment('par', 'Paris', { min: 5, ideal: 5, max: 5 })],
    cards: [
      card('c-a', 'lodging', { kind: 'segment', segmentId: 'par' }, [
        floatingStayOption('alpha', { perNight: 110 }),
      ]),
    ],
  });

  it('adds a stay starting on the chosen night, with nothing decided for it yet', () => {
    const split = splitStay(paris, 'par', 2);
    const added = split.cards[split.cards.length - 1]!;

    expect(split.cards).toHaveLength(2);
    expect(added.kind).toBe('lodging');
    expect(added.state).toBe('unplanned');
    expect(added.options).toEqual([]);
    expect(added.anchor).toEqual({ kind: 'segment', segmentId: 'par', fromNight: 2 });
  });

  it('hands the nights after the split to the new stay', () => {
    const split = splitStay(paris, 'par', 2);
    const first = placeCards(split, schedule(split)).find((p) => p.card.id === 'c-a');
    expect(first!.days).toEqual([0, 1]);
  });

  it('refuses to split at the first night, which would be no split at all', () => {
    expect(splitStay(paris, 'par', 0)).toBe(paris);
  });

  it('refuses to split where a stay already starts', () => {
    const once = splitStay(paris, 'par', 2);
    expect(splitStay(once, 'par', 2)).toBe(once);
  });

  it('gives the nights back to the earlier stay when the split is removed', () => {
    const split = splitStay(paris, 'par', 2);
    const added = split.cards[split.cards.length - 1]!;
    const undone = removeCard(split, added.id);

    const first = placeCards(undone, schedule(undone)).find((p) => p.card.id === 'c-a');
    expect(first!.days).toEqual([0, 1, 2, 3, 4]);
  });
});
