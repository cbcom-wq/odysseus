import { describe, expect, it } from 'vitest';
import { placeCards } from './layout.js';
import { schedule } from './scheduler.js';
import { card, floatingStayOption, segment, trip } from './test-support.js';

/**
 * Where lodging lands across a stay.
 *
 * The default is the point: one hotel is one decision covering every night in the place. A split is
 * the deliberate exception, and it has to divide the nights rather than double them up.
 */

const paris = segment('par', 'Paris', { min: 5, ideal: 5, max: 5 });

const daysOf = (t: ReturnType<typeof trip>, cardId: string): readonly number[] =>
  placeCards(t, schedule(t)).find((p) => p.card.id === cardId)?.days ?? [];

describe('a stay split between two hotels', () => {
  const t = trip({
    anchorDate: '2026-09-27',
    segments: [paris],
    cards: [
      card('c-a', 'lodging', { kind: 'segment', segmentId: 'par' }, [
        floatingStayOption('alpha', { perNight: 110 }),
      ]),
      card('c-b', 'lodging', { kind: 'segment', segmentId: 'par', fromNight: 2 }, [
        floatingStayOption('bravo', { perNight: 150 }),
      ]),
    ],
  });

  it('gives the first hotel the nights before the split', () => {
    expect(daysOf(t, 'c-a')).toEqual([0, 1]);
  });

  it('gives the second hotel the rest of the stay', () => {
    expect(daysOf(t, 'c-b')).toEqual([2, 3, 4]);
  });

  it('leaves no night claimed twice and none uncovered', () => {
    const all = [...daysOf(t, 'c-a'), ...daysOf(t, 'c-b')];
    expect([...all].sort((x, y) => x - y)).toEqual([0, 1, 2, 3, 4]);
  });
});

describe('a stay nobody has split', () => {
  const t = trip({
    anchorDate: '2026-09-27',
    segments: [paris],
    cards: [
      card('c-a', 'lodging', { kind: 'segment', segmentId: 'par' }, [
        floatingStayOption('alpha', { perNight: 110 }),
      ]),
    ],
  });

  it('covers every night of the place, with no start night written anywhere', () => {
    expect(daysOf(t, 'c-a')).toEqual([0, 1, 2, 3, 4]);
  });
});

describe('a split stay when the trip reflows', () => {
  const split = (nights: number) =>
    trip({
      anchorDate: '2026-09-27',
      segments: [segment('par', 'Paris', { min: 2, ideal: nights, max: 8 })],
      cards: [
        card('c-a', 'lodging', { kind: 'segment', segmentId: 'par' }, [
          floatingStayOption('alpha', { perNight: 110 }),
        ]),
        card('c-b', 'lodging', { kind: 'segment', segmentId: 'par', fromNight: 2 }, [
          floatingStayOption('bravo', { perNight: 150 }),
        ]),
      ],
    });

  it('grows only the last stay when the place gets longer', () => {
    const longer = split(6);
    expect(daysOf(longer, 'c-a')).toEqual([0, 1]);
    expect(daysOf(longer, 'c-b')).toEqual([2, 3, 4, 5]);
  });

  it('shrinks only the last stay when the place gets shorter', () => {
    const shorter = split(3);
    expect(daysOf(shorter, 'c-a')).toEqual([0, 1]);
    expect(daysOf(shorter, 'c-b')).toEqual([2]);
  });

  it('orphans the last stay rather than dropping it when the place no longer reaches it', () => {
    const tooShort = split(2);
    const placed = placeCards(tooShort, schedule(tooShort));
    const tail = placed.find((p) => p.card.id === 'c-b');
    expect(tail).toBeDefined();
    expect(tail!.days).toEqual([]);
    expect(tail!.orphaned).toBe(true);
  });
});

describe('two stays claiming the same night', () => {
  const t = trip({
    anchorDate: '2026-09-27',
    segments: [paris],
    cards: [
      card('c-a', 'lodging', { kind: 'segment', segmentId: 'par' }, [
        floatingStayOption('alpha', { perNight: 110 }),
      ]),
      card('c-b', 'lodging', { kind: 'segment', segmentId: 'par', fromNight: 2 }, [
        floatingStayOption('bravo', { perNight: 150 }),
      ]),
      card('c-c', 'lodging', { kind: 'segment', segmentId: 'par', fromNight: 2 }, [
        floatingStayOption('charlie', { perNight: 90 }),
      ]),
    ],
  });

  it('lets the stay that was already there keep the nights', () => {
    expect(daysOf(t, 'c-b')).toEqual([2, 3, 4]);
  });

  it('orphans the newcomer instead of displacing a decision already made', () => {
    const placed = placeCards(t, schedule(t));
    expect(placed.find((p) => p.card.id === 'c-c')!.orphaned).toBe(true);
  });

  it('lays out the same way every run', () => {
    const runs = Array.from({ length: 5 }, () => daysOf(t, 'c-b'));
    for (const run of runs) expect(run).toEqual(runs[0]);
  });
});

describe('a note on a place rather than a night', () => {
  const t = trip({
    anchorDate: '2026-09-27',
    segments: [paris],
    cards: [
      card('c-a', 'lodging', { kind: 'segment', segmentId: 'par', fromNight: 2 }, [
        floatingStayOption('alpha', { perNight: 110 }),
      ]),
      card('c-note', 'note', { kind: 'segment', segmentId: 'par' }, [
        floatingStayOption('remember', { perNight: 0 }),
      ]),
    ],
  });

  it('still spans the whole stay, since only lodging is split', () => {
    expect(daysOf(t, 'c-note')).toEqual([0, 1, 2, 3, 4]);
  });
});
