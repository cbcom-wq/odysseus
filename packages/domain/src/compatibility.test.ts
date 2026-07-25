import { describe, expect, it } from 'vitest';
import { detectCompatibilityConflicts } from './compatibility.js';
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

const codes = (t: Parameters<typeof schedule>[0]) =>
  detectCompatibilityConflicts(t, schedule(t)).map((c) => c.code);

describe('TIMING_OVERLAP', () => {
  it('catches the mockup case: a tour running past the train that leaves that morning', () => {
    // The example from the spec. This is the kind of cost an alternative can carry that never shows
    // up in its price.
    const t = trip({
      anchorDate: '2026-09-23',
      segments: [
        segment('ams', 'Amsterdam', { min: 2, ideal: 2, max: 2 }),
        segment('bru', 'Brussels', { min: 1, ideal: 1, max: 1 }),
      ],
      connections: [connection('ams-bru', 'ams', 'bru')],
      cards: [
        card('c-tour', 'activity', { kind: 'segment-day', segmentId: 'bru', dayOffset: 0 }, [
          slotOption('Grand Place Walking Tour', { startTime: '08:00', endTime: '10:00' }),
        ]),
        card('c-train', 'transport', { kind: 'connection', connectionId: 'ams-bru' }, [
          journeyOption('Train to Brussels', {
            departDate: '2026-09-25',
            departTime: '08:41',
            arriveTime: '10:34',
          }),
        ]),
      ],
    });

    const conflicts = detectCompatibilityConflicts(t, schedule(t));
    const overlap = conflicts.find((c) => c.code === 'TIMING_OVERLAP');

    expect(overlap).toBeDefined();
    expect(overlap!.cardIds).toEqual(expect.arrayContaining(['c-tour', 'c-train']));
    expect(overlap!.message).toContain('08:41');
  });

  it('stays quiet when the same two things do not overlap', () => {
    const t = trip({
      anchorDate: '2026-09-23',
      segments: [segment('ams', 'Amsterdam', { min: 1, ideal: 1, max: 1 })],
      cards: [
        card('c-a', 'activity', { kind: 'segment-day', segmentId: 'ams', dayOffset: 0 }, [
          slotOption('Museum', { startTime: '10:00', endTime: '12:00' }),
        ]),
        card('c-b', 'activity', { kind: 'segment-day', segmentId: 'ams', dayOffset: 0 }, [
          slotOption('Dinner', { startTime: '19:00', endTime: '21:00' }),
        ]),
      ],
    });
    expect(codes(t)).not.toContain('TIMING_OVERLAP');
  });

  it('does not flag things on different days', () => {
    const t = trip({
      anchorDate: '2026-09-23',
      segments: [segment('ams', 'Amsterdam', { min: 2, ideal: 2, max: 2 })],
      cards: [
        card('c-a', 'activity', { kind: 'segment-day', segmentId: 'ams', dayOffset: 0 }, [
          slotOption('Museum', { startTime: '10:00', endTime: '12:00' }),
        ]),
        card('c-b', 'activity', { kind: 'segment-day', segmentId: 'ams', dayOffset: 1 }, [
          slotOption('Gallery', { startTime: '11:00', endTime: '13:00' }),
        ]),
      ],
    });
    expect(codes(t)).not.toContain('TIMING_OVERLAP');
  });
});

describe('IMPOSSIBLE_TRANSFER', () => {
  const build = (secondDeparts: string) =>
    trip({
      anchorDate: '2026-09-23',
      segments: [
        segment('a', 'A', { min: 0, ideal: 0, max: 0 }),
        segment('b', 'B', { min: 1, ideal: 1, max: 1 }),
      ],
      connections: [connection('in', null, 'a'), connection('a-b', 'a', 'b')],
      cards: [
        card('c-in', 'flight', { kind: 'connection', connectionId: 'in' }, [
          journeyOption('Flight in', {
            departDate: '2026-09-23',
            departTime: '15:00',
            arriveTime: '18:40',
          }),
        ]),
        card('c-on', 'transport', { kind: 'connection', connectionId: 'a-b' }, [
          journeyOption('Onward train', {
            departDate: '2026-09-23',
            departTime: secondDeparts,
            arriveTime: '23:00',
          }),
        ]),
      ],
    });

  it('flags a connection with no realistic time to make it', () => {
    expect(codes(build('19:05'))).toContain('IMPOSSIBLE_TRANSFER');
  });

  it('accepts a comfortable connection', () => {
    expect(codes(build('21:00'))).not.toContain('IMPOSSIBLE_TRANSFER');
  });
});

describe('UNCOVERED_NIGHT', () => {
  it('flags nights with nowhere to stay and says how many', () => {
    const t = trip({
      anchorDate: '2026-09-23',
      segments: [segment('ams', 'Amsterdam', { min: 3, ideal: 3, max: 3 })],
      cards: [],
    });
    const conflict = detectCompatibilityConflicts(t, schedule(t)).find(
      (c) => c.code === 'UNCOVERED_NIGHT',
    );

    expect(conflict).toBeDefined();
    expect(conflict!.message).toContain('3 nights in Amsterdam');
    expect(conflict!.flexible.segmentIds).toEqual(['ams']);
  });

  it('is satisfied by lodging covering the stay', () => {
    const t = trip({
      anchorDate: '2026-09-23',
      segments: [segment('ams', 'Amsterdam', { min: 3, ideal: 3, max: 3 })],
      cards: [
        card('c-hotel', 'lodging', { kind: 'segment', segmentId: 'ams' }, [
          floatingStayOption('Hotel Alpha', { perNight: 110 }),
        ]),
      ],
    });
    expect(codes(t)).not.toContain('UNCOVERED_NIGHT');
  });
});

describe('ORPHANED_CARD', () => {
  it('flags an activity whose day vanished when the stay shortened', () => {
    const t = trip({
      anchorDate: '2026-09-23',
      segments: [segment('ams', 'Amsterdam', { min: 2, ideal: 2, max: 2 })],
      cards: [
        card('c-late', 'activity', { kind: 'segment-day', segmentId: 'ams', dayOffset: 4 }, [
          slotOption('Van Gogh Museum', { startTime: '10:00', endTime: '12:00' }),
        ]),
      ],
    });
    const conflict = detectCompatibilityConflicts(t, schedule(t)).find(
      (c) => c.code === 'ORPHANED_CARD',
    );

    // Surfaced, never deleted. Silently dropping a user's plan is not an option.
    expect(conflict).toBeDefined();
    expect(conflict!.cardIds).toEqual(['c-late']);
    expect(t.cards).toHaveLength(1);
  });
});

describe('conflict ordering', () => {
  it('puts blocking conflicts before warnings', () => {
    const t = trip({
      anchorDate: '2026-09-23',
      segments: [
        segment('a', 'A', { min: 0, ideal: 0, max: 0 }),
        segment('b', 'B', { min: 2, ideal: 2, max: 2 }),
      ],
      connections: [connection('in', null, 'a'), connection('a-b', 'a', 'b')],
      cards: [
        card('c-in', 'flight', { kind: 'connection', connectionId: 'in' }, [
          journeyOption('Flight in', {
            departDate: '2026-09-23',
            departTime: '15:00',
            arriveTime: '18:40',
          }),
        ]),
        card('c-on', 'transport', { kind: 'connection', connectionId: 'a-b' }, [
          journeyOption('Onward train', {
            departDate: '2026-09-23',
            departTime: '19:05',
            arriveTime: '23:00',
          }),
        ]),
      ],
    });
    const severities = detectCompatibilityConflicts(t, schedule(t)).map((c) => c.severity);
    expect(severities[0]).toBe('blocking');
    expect(severities).toContain('warning'); // uncovered nights in B
  });
});
