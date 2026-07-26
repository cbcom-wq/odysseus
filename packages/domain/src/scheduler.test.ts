import { describe, expect, it } from 'vitest';
import { schedule } from './scheduler.js';
import {
  card,
  connection,
  floatingStayOption,
  journeyOption,
  segment,
  stayOption,
  trip,
} from './test-support.js';
import type { PlanningState, Trip } from './types.js';

/** Nights keyed by segment id, which is what most assertions here actually care about. */
function nightsBySegment(t: Trip): Record<string, number> {
  return Object.fromEntries(schedule(t).segments.map((s) => [s.segmentId, s.nights]));
}

function datesBySegment(t: Trip): Record<string, string | undefined> {
  return Object.fromEntries(schedule(t).segments.map((s) => [s.segmentId, s.startDate]));
}

describe('the mockup trip round-trips', () => {
  // The canary from the spec: the fixture's structure must produce exactly the dates drawn in
  // docs/design_concept_images/trip_workspace_view.png. This ties the algorithm to the design we
  // are actually trying to build.
  const mockupTrip = trip({
    segments: [
      segment('ams', 'Amsterdam', { min: 2, ideal: 3, max: 4 }),
      segment('bru', 'Brussels', { min: 1, ideal: 2, max: 3 }),
      segment('par', 'Paris', { min: 3, ideal: 5, max: 6 }),
    ],
    connections: [
      connection('in', null, 'ams'),
      connection('ams-bru', 'ams', 'bru'),
      connection('bru-par', 'bru', 'par'),
    ],
    cards: [
      card('c-in', 'flight', { kind: 'connection', connectionId: 'in' }, [
        journeyOption('ord-ams', { departDate: '2026-09-23', departTime: '19:45' }),
      ]),
      card('c-train', 'transport', { kind: 'connection', connectionId: 'ams-bru' }, [
        journeyOption('train-bru', { departDate: '2026-09-25', departTime: '08:41' }),
      ]),
      card('c-par', 'flight', { kind: 'connection', connectionId: 'bru-par' }, [
        journeyOption('af-par', { departDate: '2026-09-27', departTime: '10:20' }),
      ]),
      card('c-lum', 'lodging', { kind: 'segment', segmentId: 'par' }, [
        stayOption('lumiere', { checkIn: '2026-09-27', checkOut: '2026-10-02', perNight: 168 }),
      ]),
    ],
  });

  it('produces the dates in the mockup', () => {
    expect(datesBySegment(mockupTrip)).toEqual({
      ams: '2026-09-23',
      bru: '2026-09-25',
      par: '2026-09-27',
    });
  });

  it('produces the night counts implied by the mockup', () => {
    expect(nightsBySegment(mockupTrip)).toEqual({ ams: 2, bru: 2, par: 5 });
  });

  it('has no conflicts', () => {
    expect(schedule(mockupTrip).conflicts).toEqual([]);
  });
});

describe('planning state governs policy, not scheduling', () => {
  // The correction that reframed the spec. An Exploring flight still lands at a specific hour and
  // therefore still determines what day you reach Brussels. If this test ever fails, the model has
  // regressed to treating commitment as the driver of the calendar.
  function tripWithTrainIn(state: PlanningState): Trip {
    return trip({
      anchorDate: '2026-09-23',
      segments: [
        segment('ams', 'Amsterdam', { min: 1, ideal: 3, max: 5 }),
        segment('bru', 'Brussels', { min: 1, ideal: 2, max: 3 }),
      ],
      connections: [connection('ams-bru', 'ams', 'bru')],
      cards: [
        card(
          'c-train',
          'transport',
          { kind: 'connection', connectionId: 'ams-bru' },
          [journeyOption('train', { departDate: '2026-09-25' })],
          { state },
        ),
      ],
    });
  }

  const states: PlanningState[] = ['exploring', 'selected', 'locked', 'booked'];

  it.each(states)('pins the same dates when the card is %s', (state) => {
    expect(datesBySegment(tripWithTrainIn(state))).toEqual({
      ams: '2026-09-23',
      bru: '2026-09-25',
    });
    expect(nightsBySegment(tripWithTrainIn(state)).ams).toBe(2);
  });

  it('ignores options that are not selected', () => {
    const t = trip({
      anchorDate: '2026-09-23',
      segments: [
        segment('ams', 'Amsterdam', { min: 1, ideal: 3, max: 5 }),
        segment('bru', 'Brussels', { min: 1, ideal: 2, max: 3 }),
      ],
      connections: [connection('ams-bru', 'ams', 'bru')],
      cards: [
        card(
          'c-train',
          'transport',
          { kind: 'connection', connectionId: 'ams-bru' },
          [journeyOption('train', { departDate: '2026-09-25' })],
          { selected: null },
        ),
      ],
    });
    // Nothing is chosen, so nothing is pinned and Amsterdam falls back to its ideal.
    expect(nightsBySegment(t).ams).toBe(3);
  });
});

describe('duration ranges', () => {
  const twoSegments = (available: { from: string; to: string }) =>
    trip({
      segments: [
        segment('a', 'A', { min: 2, ideal: 4, max: 6 }),
        segment('b', 'B', { min: 2, ideal: 4, max: 6 }),
      ],
      connections: [connection('in', null, 'a'), connection('a-b', 'a', 'b'), connection('out', 'b', null)],
      cards: [
        card('c-in', 'flight', { kind: 'connection', connectionId: 'in' }, [
          journeyOption('in', { departDate: available.from }),
        ]),
        card('c-out', 'flight', { kind: 'connection', connectionId: 'out' }, [
          journeyOption('out', { departDate: available.to }),
        ]),
      ],
    });

  it('gives every segment its ideal when there is room', () => {
    const t = twoSegments({ from: '2026-09-01', to: '2026-09-09' }); // 8 nights, ideals sum to 8
    expect(nightsBySegment(t)).toEqual({ a: 4, b: 4 });
    expect(schedule(t).conflicts).toEqual([]);
  });

  it('compresses proportionally when time is short, never below min', () => {
    const t = twoSegments({ from: '2026-09-01', to: '2026-09-06' }); // 5 nights
    const nights = nightsBySegment(t);
    expect(nights.a! + nights.b!).toBe(5);
    expect(nights.a).toBeGreaterThanOrEqual(2);
    expect(nights.b).toBeGreaterThanOrEqual(2);
    expect(schedule(t).conflicts).toEqual([]);
  });

  it('raises INSUFFICIENT_TIME rather than silently going below min', () => {
    const t = twoSegments({ from: '2026-09-01', to: '2026-09-04' }); // 3 nights, mins need 4
    const result = schedule(t);
    const conflict = result.conflicts.find((c) => c.code === 'INSUFFICIENT_TIME');

    expect(conflict).toBeDefined();
    expect(conflict!.detail).toMatchObject({ availableNights: 3, requiredNights: 4 });
    // Best-effort schedule is still produced — a conflict is never a reason to render nothing.
    expect(nightsBySegment(t)).toEqual({ a: 2, b: 2 });
  });

  it('raises EXCESS_TIME when maxima cannot fill the span', () => {
    const t = twoSegments({ from: '2026-09-01', to: '2026-10-01' }); // 30 nights, maxima give 12
    const result = schedule(t);
    const conflict = result.conflicts.find((c) => c.code === 'EXCESS_TIME');

    expect(conflict).toBeDefined();
    expect(nightsBySegment(t)).toEqual({ a: 6, b: 6 });
  });

  it('names the segments that still have room to move', () => {
    const t = twoSegments({ from: '2026-09-01', to: '2026-09-04' });
    const conflict = schedule(t).conflicts.find((c) => c.code === 'INSUFFICIENT_TIME')!;
    // Both are already at min, so neither is flexible — the fix has to come from the pinned legs.
    expect(conflict.flexible.segmentIds).toEqual([]);
    expect(conflict.cardIds).toEqual(expect.arrayContaining(['c-in', 'c-out']));
  });
});

describe('pins', () => {
  it('detects contradictory pins on the same boundary', () => {
    const t = trip({
      segments: [segment('a', 'A', { min: 1, ideal: 2, max: 3 })],
      connections: [connection('in', null, 'a')],
      cards: [
        card('c-in', 'flight', { kind: 'connection', connectionId: 'in' }, [
          journeyOption('in', { departDate: '2026-09-01' }),
        ]),
        // A booked hotel insisting the first night is a different date.
        card('c-hotel', 'lodging', { kind: 'segment', segmentId: 'a' }, [
          stayOption('hotel', { checkIn: '2026-09-03', checkOut: '2026-09-05' }),
        ]),
      ],
    });
    const conflict = schedule(t).conflicts.find((c) => c.code === 'CONTRADICTORY_PINS');
    expect(conflict).toBeDefined();
    expect(conflict!.cardIds).toEqual(expect.arrayContaining(['c-in', 'c-hotel']));
  });

  it('lets a fixed stay force a segment length', () => {
    const t = trip({
      segments: [segment('par', 'Paris', { min: 1, ideal: 2, max: 9 })],
      connections: [connection('in', null, 'par')],
      cards: [
        card('c-in', 'flight', { kind: 'connection', connectionId: 'in' }, [
          journeyOption('in', { departDate: '2026-09-27' }),
        ]),
        card('c-hotel', 'lodging', { kind: 'segment', segmentId: 'par' }, [
          stayOption('lumiere', { checkIn: '2026-09-27', checkOut: '2026-10-02' }),
        ]),
      ],
    });
    expect(nightsBySegment(t).par).toBe(5);
    expect(schedule(t).segments[0]!.reason).toBe('pinned-by-option');
  });

  it('does not pin from lodging that has no fixed dates', () => {
    // A hotel option from a search is a property and a rate, not a reservation. It floats.
    const t = trip({
      anchorDate: '2026-09-27',
      segments: [segment('par', 'Paris', { min: 1, ideal: 4, max: 9 })],
      connections: [],
      cards: [
        card('c-hotel', 'lodging', { kind: 'segment', segmentId: 'par' }, [
          floatingStayOption('alpha', { perNight: 110 }),
        ]),
      ],
    });
    expect(nightsBySegment(t).par).toBe(4);
    expect(schedule(t).conflicts).toEqual([]);
  });
});

describe('overnight transit', () => {
  it('pushes the downstream segment a day later', () => {
    const build = (nightsInTransit: 0 | 1) =>
      trip({
        anchorDate: '2026-09-01',
        segments: [
          segment('a', 'A', { min: 2, ideal: 2, max: 2 }),
          segment('b', 'B', { min: 2, ideal: 2, max: 2 }),
        ],
        connections: [connection('a-b', 'a', 'b')],
        cards: [
          card('c', 'transport', { kind: 'connection', connectionId: 'a-b' }, [
            journeyOption('night-train', { departDate: '2026-09-03', nightsInTransit }),
          ]),
        ],
      });

    expect(datesBySegment(build(0)).b).toBe('2026-09-03');
    expect(datesBySegment(build(1)).b).toBe('2026-09-04');
  });
});

describe('undated trips', () => {
  it('schedules to relative days when nothing pins a date', () => {
    const t = trip({
      segments: [
        segment('a', 'A', { min: 1, ideal: 3, max: 5 }),
        segment('b', 'B', { min: 1, ideal: 2, max: 4 }),
      ],
      connections: [],
      cards: [],
    });
    const result = schedule(t);

    expect(result.startDate).toBeUndefined();
    expect(result.segments.map((s) => s.startDay)).toEqual([0, 3]);
    expect(result.segments.every((s) => s.startDate === undefined)).toBe(true);
    expect(result.totalNights).toBe(5);
    // Still fully usable — this is what "start flexible" means in practice.
    expect(result.conflicts).toEqual([]);
  });

  it('stretches an undated trip to reach the length you asked for', () => {
    // Two stops that would idle at 3 nights each, but the traveller said at least 9.
    const t = trip({
      length: { min: 9, max: 12 },
      segments: [
        segment('a', 'A', { min: 1, ideal: 3, max: 7 }),
        segment('b', 'B', { min: 1, ideal: 3, max: 7 }),
      ],
    });
    const result = schedule(t);

    expect(result.totalNights).toBe(9);
    expect(result.conflicts).toEqual([]);
  });

  it('compresses an undated trip to fit the length you asked for', () => {
    const t = trip({
      length: { min: 4, max: 6 },
      segments: [
        segment('a', 'A', { min: 1, ideal: 4, max: 7 }),
        segment('b', 'B', { min: 1, ideal: 4, max: 7 }),
        segment('c', 'C', { min: 1, ideal: 4, max: 7 }),
      ],
    });
    const result = schedule(t);

    expect(result.totalNights).toBe(6);
    expect(result.segments.every((s) => s.nights >= 1)).toBe(true);
    expect(result.conflicts).toEqual([]);
  });

  it('leaves a trip alone when its ideal already lands in range', () => {
    const t = trip({
      length: { min: 7, max: 14 },
      segments: [
        segment('a', 'A', { min: 1, ideal: 3, max: 7 }),
        segment('b', 'B', { min: 1, ideal: 3, max: 7 }),
        segment('c', 'C', { min: 1, ideal: 3, max: 7 }),
      ],
    });
    expect(nightsBySegment(t)).toEqual({ a: 3, b: 3, c: 3 });
  });

  it('fills the unpinned remainder around a leg that is already chosen', () => {
    // Amsterdam is fixed by the flights either side; Brussels absorbs the rest of the budget.
    const t = trip({
      length: { min: 8, max: 8 },
      segments: [
        segment('ams', 'Amsterdam', { min: 1, ideal: 2, max: 5 }),
        segment('bru', 'Brussels', { min: 1, ideal: 2, max: 9 }),
      ],
      connections: [connection('in', null, 'ams'), connection('ams-bru', 'ams', 'bru')],
      cards: [
        card('c-in', 'flight', { kind: 'connection', connectionId: 'in' }, [
          journeyOption('in', { departDate: '2026-09-01' }),
        ]),
        card('c-train', 'transport', { kind: 'connection', connectionId: 'ams-bru' }, [
          journeyOption('train', { departDate: '2026-09-04' }),
        ]),
      ],
    });
    const result = schedule(t);

    expect(nightsBySegment(t).ams).toBe(3); // pinned by the two legs
    expect(result.totalNights).toBe(8); // Brussels takes the remaining 5
    expect(result.conflicts).toEqual([]);
  });

  it('flags a trip whose resolved length falls outside its target range', () => {
    const t = trip({
      length: { min: 1, max: 3 },
      segments: [segment('a', 'A', { min: 5, ideal: 5, max: 5 })],
    });
    expect(schedule(t).conflicts.map((c) => c.code)).toContain('TRIP_LENGTH_MISMATCH');
  });
});

describe('determinism and isolation', () => {
  const t = trip({
    anchorDate: '2026-09-01',
    segments: [
      segment('a', 'A', { min: 1, ideal: 3, max: 5 }),
      segment('b', 'B', { min: 1, ideal: 3, max: 5 }),
      segment('c', 'C', { min: 1, ideal: 3, max: 5 }),
    ],
    connections: [connection('in', null, 'a'), connection('out', 'c', null)],
    cards: [
      card('c-in', 'flight', { kind: 'connection', connectionId: 'in' }, [
        journeyOption('in', { departDate: '2026-09-01' }),
      ]),
      card('c-out', 'flight', { kind: 'connection', connectionId: 'out' }, [
        journeyOption('out', { departDate: '2026-09-09' }),
      ]),
    ],
  });

  it('produces identical output across repeated runs', () => {
    // Ranking in §6 diffs two schedules. If scheduling were unstable, every diff would be noise.
    const runs = Array.from({ length: 20 }, () => JSON.stringify(schedule(t)));
    expect(new Set(runs).size).toBe(1);
  });

  it('distributes an odd remainder by a stable rule, not arbitrarily', () => {
    // 8 nights across three identical segments cannot divide evenly. Whatever the split, it must be
    // the same split every time.
    const nights = schedule(t).segments.map((s) => s.nights);
    expect(nights.reduce((a, b) => a + b, 0)).toBe(8);
    expect(nights).toEqual(schedule(t).segments.map((s) => s.nights));
  });

  it('does not mutate the trip it is given', () => {
    const before = JSON.stringify(t);
    schedule(t);
    expect(JSON.stringify(t)).toBe(before);
  });
});
