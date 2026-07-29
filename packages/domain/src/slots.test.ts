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

  it('gives an orphaned split its own zero-night slot instead of dropping it', () => {
    // Sao Paulo is now pinned to 5 nights, not 15 — a duration the trip settled on after the split
    // was made. Night 10 no longer exists, so `stayNights` clamps card-b's start to the segment's
    // own end and it covers nothing. The slot must still say so rather than vanish, because a stay
    // with nowhere left to put it is exactly the kind of orphaned card the panel exists to surface.
    const shortened = trip({
      segments: [segment('sao', 'Sao Paulo', { min: 5, ideal: 5, max: 5 })],
      connections: [connection('leg-1', null, 'sao'), connection('leg-2', 'sao', null)],
      cards: [
        card('card-a', 'lodging', { kind: 'segment', segmentId: 'sao' }, [
          floatingStayOption('a1', { perNight: 100 }),
        ]),
        card('card-b', 'lodging', { kind: 'segment', segmentId: 'sao', fromNight: 10 }, [
          floatingStayOption('b1', { perNight: 120 }),
        ]),
      ],
    });
    const s = slots(shortened);
    expect(s.stays.map((x) => [x.id, x.nights])).toEqual([
      ['stay:card-a', 5],
      ['stay:card-b', 0],
    ]);
  });

  it('gives a zero-night stop no stay slot, but still somewhere to put its Add controls', () => {
    // A pass-through stop the schedule gave no nights at all is not an open question about where
    // to sleep, so it gets no synthetic stay slot — unlike the "nowhere to sleep" case above, where
    // the stop genuinely has nights to cover. But it is still a real stop on the trip, and the
    // panel needs somewhere to hang an Add control for local transport or activities there, so
    // those two groups must still appear, just empty.
    const layover = trip({
      segments: [segment('lay', 'Nowhere', { min: 0, ideal: 0, max: 0 })],
      connections: [connection('leg-1', null, 'lay'), connection('leg-2', 'lay', null)],
    });
    const s = slots(layover);
    expect(s.stays).toEqual([]);
    expect(s.localTransport.map((g) => [g.id, g.placeName, g.cards])).toEqual([
      ['stop:lay', 'Nowhere', []],
    ]);
    expect(s.activities.map((g) => [g.id, g.placeName, g.cards])).toEqual([
      ['stop:lay', 'Nowhere', []],
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
