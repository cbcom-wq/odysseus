import { describe, expect, it } from 'vitest';
import { computeBudget } from './budget.js';
import { applyOption, diffTrips, rankOptions } from './evaluate.js';
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

/** Two flights into Amsterdam: one cheap and late, one dearer and early. */
function arrivalChoice(): Trip {
  return trip({
    anchorDate: '2026-09-23',
    segments: [segment('ams', 'Amsterdam', { min: 2, ideal: 2, max: 2 })],
    connections: [connection('in', null, 'ams')],
    cards: [
      card(
        'c-flight',
        'flight',
        { kind: 'connection', connectionId: 'in' },
        [
          journeyOption('late', {
            title: 'Delta 117',
            departDate: '2026-09-23',
            departTime: '14:00',
            arriveTime: '21:00',
            durationMinutes: 420,
            cost: 546,
          }),
          journeyOption('early', {
            title: 'KLM 602',
            departDate: '2026-09-23',
            departTime: '06:00',
            arriveTime: '11:35',
            durationMinutes: 335,
            cost: 642,
          }),
        ],
        { selected: 'late' },
      ),
      card('c-hotel', 'lodging', { kind: 'segment', segmentId: 'ams' }, [
        floatingStayOption('alpha', { perNight: 110 }),
      ]),
    ],
  });
}

describe('preview and reality cannot diverge', () => {
  // The whole justification for the pure-domain constraint. If a preview were computed by any path
  // other than running the real scheduler, this is where the drift would show up.
  it('matches what the user actually gets after swapping', () => {
    const before = arrivalChoice();
    const predicted = diffTrips(before, applyOption(before, 'c-flight', 'early')!);

    const after = applyOption(before, 'c-flight', 'early')!;
    const actualCost =
      computeBudget(after, schedule(after)).total - computeBudget(before, schedule(before)).total;

    expect(predicted.costDelta).toBe(actualCost);
  });

  it('leaves the original trip untouched', () => {
    const before = arrivalChoice();
    const snapshot = JSON.stringify(before);
    applyOption(before, 'c-flight', 'early');
    rankOptions(before, 'c-flight');
    expect(JSON.stringify(before)).toBe(snapshot);
  });
});

describe('usable hours', () => {
  it('counts an earlier arrival as time handed back, not just a smaller number', () => {
    const before = arrivalChoice();
    const impact = diffTrips(before, applyOption(before, 'c-flight', 'early')!);

    // Within an 08:00-22:00 day, measured door to door: the 14:00 flight means leaving for the
    // airport at 12:00 and clearing the far one at 22:00, so the whole day is gone. The 06:00 one
    // hands back Amsterdam from 12:35, but it is not the free win the timetable implies — it costs
    // a 04:00 start, and those four hours are charged rather than waved through as time before the
    // day begins. What is left is the afternoon the traveller actually gets, and it is the number
    // the panel turns into a reason rather than a timestamp.
    expect(impact.usableHoursDelta).toBeCloseTo(5 + 25 / 60, 6);
    expect(impact.costDelta).toBe(96); // and it costs $96 more
    expect(impact.transitTimeDelta).toBe(-85);
  });

  /** Paris to Amsterdam, mid-trip: the same journey in the morning or in the evening. */
  function departureChoice(selected: 'morning' | 'evening'): Trip {
    return trip({
      anchorDate: '2026-04-11',
      segments: [
        segment('par', 'Paris', { min: 5, ideal: 5, max: 5 }),
        segment('ams', 'Amsterdam', { min: 4, ideal: 4, max: 4 }),
      ],
      connections: [connection('in', null, 'par'), connection('par-ams', 'par', 'ams')],
      cards: [
        card(
          'c-train',
          'transport',
          { kind: 'connection', connectionId: 'par-ams' },
          [
            journeyOption('morning', {
              departDate: '2026-04-16',
              departTime: '10:25',
              arriveTime: '13:52',
              durationMinutes: 207,
              cost: 178,
            }),
            journeyOption('evening', {
              departDate: '2026-04-16',
              departTime: '19:25',
              arriveTime: '22:49',
              durationMinutes: 204,
              cost: 118,
            }),
          ],
          { selected },
        ),
      ],
    });
  }

  it('charges a late arrival for the evening it costs, rather than crediting it', () => {
    // The founding example: the cheaper one lands at 22:49 and costs you an evening in Amsterdam.
    // A plain waking-window model scored that as a *gain*, because it pushed the journey into
    // hours it treated as free and counted the day spent checked out of a Paris hotel as a day in
    // Paris. Both are now paid for, and the $60 saving reads as the tradeoff it is.
    const morning = departureChoice('morning');
    const impact = diffTrips(morning, applyOption(morning, 'c-train', 'evening')!);

    expect(impact.costDelta).toBe(-60);
    expect(impact.usableHoursDelta).toBeLessThan(-2);
  });

  /** Two versions of the same leg, differing only in how much of the night they consume. */
  function nightLength(long: boolean): Trip {
    const base = departureChoice('morning');
    return {
      ...base,
      cards: base.cards.map((c) =>
        c.id !== 'c-train'
          ? c
          : {
              ...c,
              options: [
                journeyOption('night', {
                  departDate: '2026-04-16',
                  departTime: '22:00',
                  arriveTime: long ? '23:59' : '22:30',
                  durationMinutes: long ? 119 : 30,
                  cost: 100,
                }),
              ],
              selectedOptionId: 'night',
            },
      ),
    };
  }

  it('does not treat travelling through the night as free', () => {
    // Both legs run entirely past the end of the waking day, so under a plain waking-window model
    // both cost exactly nothing and a night coach was the best-scoring option on any leg. The long
    // one takes two hours of someone's night and has to be charged for them.
    const shortNight = diffTrips(nightLength(false), nightLength(false));
    const longNight = diffTrips(nightLength(false), nightLength(true));

    expect(shortNight.usableHoursDelta).toBe(0);
    expect(longNight.usableHoursDelta).toBeLessThan(-1);
  });

  it('does not make a dawn start free just because the day has not begun', () => {
    // A 07:40 flight means a 05:40 door-to-door start, which used to fall almost entirely outside
    // the waking window and so cost almost nothing — the reason it out-scored every train on the
    // leg. Against a mid-morning flight of identical door-to-door length it should now come out
    // even, not ahead.
    const withFlights = (dawn: boolean): Trip => {
      const base = departureChoice('morning');
      return {
        ...base,
        cards: base.cards.map((c) =>
          c.id !== 'c-train'
            ? c
            : {
                ...c,
                kind: 'flight' as const,
                options: [
                  journeyOption('fly', {
                    departDate: '2026-04-16',
                    departTime: dawn ? '07:40' : '11:00',
                    arriveTime: dawn ? '09:10' : '12:30',
                    durationMinutes: 90,
                    cost: 142,
                  }),
                ],
                selectedOptionId: 'fly',
              },
        ),
      };
    };

    expect(diffTrips(withFlights(false), withFlights(true)).usableHoursDelta).toBeCloseTo(0, 6);
  });

  it('is symmetric — swapping back reverses the deltas', () => {
    const before = arrivalChoice();
    const after = applyOption(before, 'c-flight', 'early')!;

    const forward = diffTrips(before, after);
    const backward = diffTrips(after, before);

    expect(backward.costDelta).toBe(-forward.costDelta);
    expect(backward.usableHoursDelta).toBeCloseTo(-forward.usableHoursDelta, 6);
  });
});

describe('whole-trip cost', () => {
  it('sees a pricier option that shortens the trip as cheaper overall', () => {
    // The case per-slot ranking structurally cannot express, and the reason costDelta is trip-level.
    // The direct flight costs $200 more but removes a night of transit and its hotel.
    const base = trip({
      segments: [
        segment('a', 'A', { min: 1, ideal: 1, max: 1 }),
        segment('b', 'B', { min: 2, ideal: 2, max: 2 }),
      ],
      connections: [connection('in', null, 'a'), connection('a-b', 'a', 'b')],
      cards: [
        card('c-in', 'flight', { kind: 'connection', connectionId: 'in' }, [
          journeyOption('in', { departDate: '2026-09-01', cost: 400 }),
        ]),
        card(
          'c-leg',
          'transport',
          { kind: 'connection', connectionId: 'a-b' },
          [
            journeyOption('overnight', {
              title: 'Night train',
              departDate: '2026-09-02',
              nightsInTransit: 1,
              cost: 90,
            }),
            journeyOption('direct', {
              title: 'Morning flight',
              departDate: '2026-09-02',
              nightsInTransit: 0,
              cost: 290,
            }),
          ],
          { selected: 'overnight' },
        ),
        card('c-hotel-b', 'lodging', { kind: 'segment', segmentId: 'b' }, [
          floatingStayOption('hotel-b', { perNight: 150 }),
        ]),
      ],
    });

    const impact = diffTrips(base, applyOption(base, 'c-leg', 'direct')!);

    // +$200 on the ticket, but B now starts a day earlier within the same 2-night stay, so the
    // trip is one night shorter overall.
    expect(impact.costDelta).toBe(200);
    expect(impact.scheduleShift.some((s) => s.segmentId === 'b')).toBe(true);
  });
});

describe('conflicting options are demoted, never hidden', () => {
  const withTour = (): Trip =>
    trip({
      anchorDate: '2026-09-23',
      segments: [
        segment('ams', 'Amsterdam', { min: 2, ideal: 2, max: 2 }),
        segment('bru', 'Brussels', { min: 1, ideal: 1, max: 1 }),
      ],
      connections: [connection('ams-bru', 'ams', 'bru')],
      cards: [
        card('c-tour', 'activity', { kind: 'segment-day', segmentId: 'bru', dayOffset: 0 }, [
          slotOption('Walking tour', { startTime: '08:00', endTime: '10:00' }),
        ]),
        card(
          'c-train',
          'transport',
          { kind: 'connection', connectionId: 'ams-bru' },
          [
            journeyOption('midday', {
              title: 'Midday train',
              departDate: '2026-09-25',
              departTime: '12:00',
              arriveTime: '13:53',
              cost: 42,
            }),
            journeyOption('early', {
              title: 'Early train',
              departDate: '2026-09-25',
              departTime: '08:41',
              arriveTime: '10:34',
              cost: 28,
            }),
          ],
          { selected: 'midday' },
        ),
      ],
    });

  it('still lists the conflicting option', () => {
    const ranked = rankOptions(withTour(), 'c-train');
    expect(ranked.map((r) => r.option.id).sort()).toEqual(['early', 'midday']);
  });

  it('ranks the cheaper conflicting option below the current one', () => {
    // $14 cheaper, but it collides with the walking tour. Price alone would put it first.
    const ranked = rankOptions(withTour(), 'c-train');
    expect(ranked[0]!.option.id).toBe('midday');
    expect(ranked[1]!.option.id).toBe('early');
  });

  it('explains what breaks', () => {
    const early = rankOptions(withTour(), 'c-train').find((r) => r.option.id === 'early')!;
    expect(early.warning).toBeDefined();
    expect(early.impact.conflictsIntroduced.length).toBeGreaterThan(0);
    expect(early.warning).toContain('08:41');
  });
});

describe('ranking', () => {
  it('includes the current option as the zero baseline', () => {
    const ranked = rankOptions(arrivalChoice(), 'c-flight');
    const current = ranked.find((r) => r.isCurrent)!;

    expect(current.option.id).toBe('late');
    expect(current.score).toBe(0);
    expect(current.impact.costDelta).toBe(0);
  });

  it('changes order with the preset, without changing the deltas', () => {
    const base = arrivalChoice();
    const withPreset = (ranking: Trip['preferences']['ranking']): Trip => ({
      ...base,
      preferences: { ...base.preferences, ranking },
    });

    // The early flight buys about 9.4 usable hours in Amsterdam for $96 — roughly $10 an hour.
    // Same two flights and the same facts either way; only what the traveller is optimising for
    // differs, and that is exactly the judgement the preset is there to express.
    expect(rankOptions(withPreset('best-value'), 'c-flight')[0]!.option.id).toBe('late');
    expect(rankOptions(withPreset('comfort'), 'c-flight')[0]!.option.id).toBe('early');

    const asValue = rankOptions(withPreset('best-value'), 'c-flight').find(
      (r) => r.option.id === 'early',
    )!;
    const asComfort = rankOptions(withPreset('comfort'), 'c-flight').find(
      (r) => r.option.id === 'early',
    )!;
    expect(asValue.impact.costDelta).toBe(asComfort.impact.costDelta);
    expect(asValue.impact.usableHoursDelta).toBe(asComfort.impact.usableHoursDelta);
  });

  it('is deterministic', () => {
    const t = arrivalChoice();
    const runs = Array.from({ length: 10 }, () =>
      rankOptions(t, 'c-flight').map((r) => r.option.id).join(','),
    );
    expect(new Set(runs).size).toBe(1);
  });
});

describe('booked cards', () => {
  it('refuse the swap', () => {
    const t = arrivalChoice();
    const booked: Trip = {
      ...t,
      cards: t.cards.map((c) => (c.id === 'c-flight' ? { ...c, state: 'booked' as const } : c)),
    };
    expect(applyOption(booked, 'c-flight', 'early')).toBeUndefined();
  });

  it('still list alternatives, with an explanation of why they are inert', () => {
    // Locking never hides alternatives. The user gets to see what they committed away from.
    const t = arrivalChoice();
    const booked: Trip = {
      ...t,
      cards: t.cards.map((c) => (c.id === 'c-flight' ? { ...c, state: 'booked' as const } : c)),
    };
    const ranked = rankOptions(booked, 'c-flight');

    expect(ranked).toHaveLength(2);
    expect(ranked.find((r) => r.option.id === 'early')!.warning).toMatch(/unlock/i);
  });

  it('still say what the alternatives would have cost', () => {
    // Returning zeroes claimed a $546 and a $642 flight cost the same, which is the one thing a
    // traveller who has just spent money must not be told. Committing is exactly when "what did I
    // give up?" becomes worth asking, and the warning is what stops anyone acting on the answer.
    const t = arrivalChoice();
    const booked: Trip = {
      ...t,
      cards: t.cards.map((c) => (c.id === 'c-flight' ? { ...c, state: 'booked' as const } : c)),
    };

    const inert = rankOptions(booked, 'c-flight').find((r) => r.option.id === 'early')!;
    const live = rankOptions(t, 'c-flight').find((r) => r.option.id === 'early')!;

    expect(inert.impact.costDelta).toBe(96);
    expect(inert.impact.costDelta).toBe(live.impact.costDelta);
    expect(inert.impact.usableHoursDelta).toBeCloseTo(live.impact.usableHoursDelta, 6);
  });
});
