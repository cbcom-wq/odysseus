import { describe, expect, it } from 'vitest';
import { computeBudget } from './budget.js';
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

describe("the mockup's first day adds up", () => {
  // trip_workspace_view.png shows Sep 23 at $832: flight $642 + taxi $38 + hotel $110 + cruise $42.
  // A good check that costs land on the right days — a flight's full fare on its travel day, a
  // hotel's rate on each night it covers.
  const t = trip({
    anchorDate: '2026-09-23',
    segments: [segment('ams', 'Amsterdam', { min: 2, ideal: 2, max: 2 })],
    connections: [connection('in', null, 'ams')],
    cards: [
      card('c-flight', 'flight', { kind: 'connection', connectionId: 'in' }, [
        journeyOption('ord-ams', { departDate: '2026-09-23', cost: 642 }),
      ]),
      card('c-taxi', 'transport', { kind: 'segment-day', segmentId: 'ams', dayOffset: 0 }, [
        slotOption('taxi', { startTime: '20:00', endTime: '20:25', cost: 38 }),
      ]),
      card('c-hotel', 'lodging', { kind: 'segment', segmentId: 'ams' }, [
        floatingStayOption('alpha', { perNight: 110 }),
      ]),
      card('c-cruise', 'activity', { kind: 'segment-day', segmentId: 'ams', dayOffset: 0 }, [
        slotOption('cruise', { startTime: '19:30', endTime: '21:00', cost: 42 }),
      ]),
    ],
  });

  const budget = computeBudget(t, schedule(t));

  it('totals the first day to $832', () => {
    expect(budget.byDay[0]!.amount).toBe(832);
  });

  it('dates the days', () => {
    expect(budget.byDay[0]!.date).toBe('2026-09-23');
    expect(budget.byDay[1]!.date).toBe('2026-09-24');
  });

  it('charges the hotel again on the second night but not the flight', () => {
    expect(budget.byDay[1]!.amount).toBe(110);
    expect(budget.byDay[1]!.lines.map((l) => l.cardId)).toEqual(['c-hotel']);
  });

  it('totals the trip', () => {
    expect(budget.total).toBe(642 + 38 + 42 + 110 * 2);
  });

  it('breaks down by category', () => {
    expect(budget.byCategory).toEqual({
      flight: 642,
      transport: 38,
      activity: 42,
      lodging: 220,
    });
  });

  it('covers every day of the trip, including the departure day', () => {
    expect(budget.byDay).toHaveLength(3); // 2 nights = 3 days
    expect(budget.byDay[2]!.amount).toBe(0);
  });
});

describe('per-night costs follow the schedule', () => {
  const build = (nights: number) => {
    const t = trip({
      anchorDate: '2026-09-23',
      length: { min: 1, max: 30 },
      segments: [segment('par', 'Paris', { min: nights, ideal: nights, max: nights })],
      cards: [
        card('c-hotel', 'lodging', { kind: 'segment', segmentId: 'par' }, [
          floatingStayOption('lumiere', { perNight: 168 }),
        ]),
      ],
    });
    return computeBudget(t, schedule(t));
  };

  it('recomputes when the stay gets longer', () => {
    // The point of deriving rather than storing: nobody has to remember to update a total.
    expect(build(3).total).toBe(504);
    expect(build(5).total).toBe(840);
  });
});

describe('a stay split between two hotels', () => {
  // Two hotels in one place used to charge both nightly rates on every night of the stay. Each one
  // is billed for the nights it actually holds and no others.
  const t = trip({
    anchorDate: '2026-09-27',
    segments: [segment('par', 'Paris', { min: 5, ideal: 5, max: 5 })],
    cards: [
      card('c-a', 'lodging', { kind: 'segment', segmentId: 'par' }, [
        floatingStayOption('alpha', { perNight: 110 }),
      ]),
      card('c-b', 'lodging', { kind: 'segment', segmentId: 'par', fromNight: 2 }, [
        floatingStayOption('bravo', { perNight: 150 }),
      ]),
    ],
  });
  const budget = computeBudget(t, schedule(t));

  it('charges each hotel only for its own nights', () => {
    expect(budget.total).toBe(110 * 2 + 150 * 3);
  });

  it('bills one hotel per night, never both', () => {
    for (const day of budget.byDay.slice(0, 5)) {
      expect(day.lines.filter((l) => l.kind === 'lodging')).toHaveLength(1);
    }
  });

  it('switches rate on the night the second hotel starts', () => {
    expect(budget.byDay[1]!.amount).toBe(110);
    expect(budget.byDay[2]!.amount).toBe(150);
  });
});

describe('orphaned cards', () => {
  it('keeps an activity past the end of a shortened segment out of the day totals', () => {
    const t = trip({
      anchorDate: '2026-09-23',
      segments: [segment('ams', 'Amsterdam', { min: 2, ideal: 2, max: 2 })],
      cards: [
        card('c-late', 'activity', { kind: 'segment-day', segmentId: 'ams', dayOffset: 4 }, [
          slotOption('museum', { startTime: '10:00', endTime: '12:00', cost: 26 }),
        ]),
      ],
    });
    const budget = computeBudget(t, schedule(t));

    // The card still exists and is surfaced to the user as unscheduled — it just is not silently
    // charged to a day that does not exist.
    expect(budget.total).toBe(0);
    expect(budget.byDay.every((d) => d.amount === 0)).toBe(true);
  });
});

describe('unselected cards', () => {
  it('cost nothing until an option is chosen', () => {
    const t = trip({
      anchorDate: '2026-09-23',
      segments: [segment('ams', 'Amsterdam', { min: 1, ideal: 1, max: 1 })],
      cards: [
        card(
          'c-hotel',
          'lodging',
          { kind: 'segment', segmentId: 'ams' },
          [floatingStayOption('alpha', { perNight: 110 })],
          { selected: null },
        ),
      ],
    });
    expect(computeBudget(t, schedule(t)).total).toBe(0);
  });
});
