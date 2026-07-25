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

    // Within an 08:00-22:00 day: landing at 21:00 leaves one usable hour, and the morning before
    // the 14:00 departure is spent at home, not in Amsterdam. Landing at 11:35 leaves 10h25m.
    // That difference — 9h25m — is the evening the traveller gets back, and it is the number the
    // panel turns into a reason rather than a timestamp.
    expect(impact.usableHoursDelta).toBeCloseTo(9 + 25 / 60, 6);
    expect(impact.costDelta).toBe(96); // and it costs $96 more
    expect(impact.transitTimeDelta).toBe(-85);
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
});
