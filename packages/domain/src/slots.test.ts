import { describe, expect, it } from 'vitest';
import { schedule } from './scheduler.js';
import { tripSlots } from './slots.js';
import {
  card,
  connection,
  floatingStayOption,
  journeyOption,
  segment,
  slotOption,
  trip,
} from './test-support.js';
import type { Card, Trip } from './types.js';

/** Home → Sao Paulo → home, 15 nights, exactly the trip in the bug report. */
function brazil(cards: Card[] = []): Trip {
  return trip({
    segments: [segment('sao', 'Sao Paulo', { min: 15, ideal: 15, max: 15 })],
    connections: [connection('leg-1', null, 'sao'), connection('leg-2', 'sao', null)],
    cards,
  });
}

const slots = (t: Trip) => tripSlots(t, schedule(t));

describe('tripSlots', () => {
  it('has nothing to say about a trip with no stops', () => {
    const s = slots(trip());
    expect(s.connections).toEqual([]);
    expect(s.stays).toEqual([]);
    expect(s.localTransport).toEqual([]);
    expect(s.activities).toEqual([]);
  });

  it('gives every leg a slot, named end to end, with home for the unmodelled ends', () => {
    const s = slots(brazil());
    expect(s.connections.map((c) => [c.id, c.fromName, c.toName])).toEqual([
      ['connection:leg-1', null, 'Sao Paulo'],
      ['connection:leg-2', 'Sao Paulo', null],
    ]);
    expect(s.connections.every((c) => c.cards.length === 0)).toBe(true);
  });

  it('counts a train as filling a leg, because a leg is one slot either way', () => {
    const train = card('card-1', 'transport', { kind: 'connection', connectionId: 'leg-1' }, [
      journeyOption('o1', { departDate: '2027-03-01' }),
    ]);
    const s = slots(brazil([train]));
    expect(s.connections[0]!.cards.map((c) => c.id)).toEqual(['card-1']);
    expect(s.connections[1]!.cards).toEqual([]);
  });

  it('offers one empty stay per stop with nowhere to sleep', () => {
    const s = slots(brazil());
    expect(s.stays).toHaveLength(1);
    expect(s.stays[0]!.id).toBe('stay:sao');
    expect(s.stays[0]!.placeName).toBe('Sao Paulo');
    expect(s.stays[0]!.nights).toBe(15);
    expect(s.stays[0]!.card).toBeUndefined();
  });

  it('gives a split stay one slot each, holding the nights it actually covers', () => {
    const first = card('card-a', 'lodging', { kind: 'segment', segmentId: 'sao' }, [
      floatingStayOption('a1', { perNight: 100 }),
    ]);
    const second = card(
      'card-b',
      'lodging',
      { kind: 'segment', segmentId: 'sao', fromNight: 10 },
      [floatingStayOption('b1', { perNight: 120 })],
    );
    const s = slots(brazil([first, second]));
    expect(s.stays.map((x) => [x.id, x.nights])).toEqual([
      ['stay:card-a', 10],
      ['stay:card-b', 5],
    ]);
  });

  it('separates getting around a stop from what you do there', () => {
    const tour = card(
      'card-act',
      'activity',
      { kind: 'segment-day', segmentId: 'sao', dayOffset: 2 },
      [slotOption('x', { startTime: '09:00', endTime: '11:00' })],
    );
    const reminder = card('card-note', 'note', { kind: 'segment', segmentId: 'sao' }, []);
    const taxi = card(
      'card-taxi',
      'transport',
      { kind: 'segment-day', segmentId: 'sao', dayOffset: 0 },
      [slotOption('y', { startTime: '08:00', endTime: '09:00' })],
    );
    const s = slots(brazil([tour, reminder, taxi]));
    expect(s.activities[0]!.cards.map((c) => c.id)).toEqual(['card-act', 'card-note']);
    expect(s.localTransport[0]!.cards.map((c) => c.id)).toEqual(['card-taxi']);
  });
});
