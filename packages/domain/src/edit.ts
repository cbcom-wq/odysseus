import { fareGroupPartners } from './fare-group.js';
import type { Card, CardKind, Connection, Option, Segment, Trip } from './types.js';

/**
 * Pure edits to a trip.
 *
 * Every function returns a new trip and never mutates its input, so the UI can hold trips in state
 * and the evaluator can keep diffing them safely.
 *
 * Ids are derived from what already exists rather than generated randomly. The domain has no clock
 * and no randomness — that is what makes scheduling reproducible — so identity has to be a function
 * of the trip too.
 */

function nextId(existing: Iterable<string>, prefix: string): string {
  let highest = 0;
  const pattern = new RegExp(`^${prefix}-(\\d+)$`);
  for (const id of existing) {
    const match = pattern.exec(id);
    if (match) highest = Math.max(highest, Number(match[1]));
  }
  return `${prefix}-${highest + 1}`;
}

export function nextCardId(trip: Trip): string {
  return nextId(trip.cards.map((c) => c.id), 'card');
}

export function nextOptionId(card: Card): string {
  return nextId(card.options.map((o) => o.id), `${card.id}-opt`);
}

export interface EditResult {
  readonly trip: Trip;
  /** Cards that could no longer exist after the edit. Surfaced, never silently dropped. */
  readonly removedCardIds: readonly string[];
  /**
   * Cards left holding half a fare whose other leg was removed.
   *
   * The link is stripped rather than kept pointing at nothing, but the price on the survivor is
   * still half of a purchase that no longer exists, and only the traveller can say what it should
   * be now. Saying so beats leaving a wrong number where a right one used to be.
   */
  readonly unpairedCardIds: readonly string[];
}

/**
 * A fare needs at least two legs to be a fare.
 *
 * Removing a connection takes its cards with it, which can leave one half of a return flight behind.
 * The survivor keeps its cost — the domain will not invent a new price — but loses the link, and its
 * id comes back for the interface to report.
 */
function unpairLoneFares(trip: Trip): { trip: Trip; unpairedCardIds: readonly string[] } {
  const counts = new Map<string, number>();
  for (const card of trip.cards) {
    for (const option of card.options) {
      if (option.fareGroupId === undefined) continue;
      counts.set(option.fareGroupId, (counts.get(option.fareGroupId) ?? 0) + 1);
    }
  }

  const lone = new Set([...counts].filter(([, n]) => n < 2).map(([id]) => id));
  if (lone.size === 0) return { trip, unpairedCardIds: [] };

  const unpairedCardIds: string[] = [];
  const cards = trip.cards.map((card) => {
    if (!card.options.some((o) => o.fareGroupId !== undefined && lone.has(o.fareGroupId))) {
      return card;
    }
    unpairedCardIds.push(card.id);
    return {
      ...card,
      options: card.options.map((o) => {
        if (o.fareGroupId === undefined || !lone.has(o.fareGroupId)) return o;
        const { fareGroupId: _gone, ...rest } = o;
        return rest;
      }),
    };
  });

  return { trip: { ...trip, cards }, unpairedCardIds };
}

/**
 * Make the connections match the segments.
 *
 * A trip's legs are implied by its stops: one in, one between each pair, one home. Rather than ask
 * the user to maintain that, it is derived — but a connection that no longer joins anything takes
 * its cards with it, so those ids come back for the interface to report. Inserting Brussels between
 * Amsterdam and Paris genuinely invalidates the Amsterdam→Paris flight, and saying so is better
 * than leaving a card pointing at a leg that no longer exists.
 */
export function syncConnections(trip: Trip): EditResult {
  if (trip.segments.length === 0) {
    const removedCardIds = trip.cards
      .filter((c) => c.anchor.kind === 'connection')
      .map((c) => c.id);
    const unpaired = unpairLoneFares({
      ...trip,
      connections: [],
      cards: trip.cards.filter((c) => c.anchor.kind !== 'connection'),
    });
    return { ...unpaired, removedCardIds };
  }

  const wanted: { from: string | null; to: string | null }[] = [
    { from: null, to: trip.segments[0]!.id },
    ...trip.segments.slice(0, -1).map((s, i) => ({ from: s.id, to: trip.segments[i + 1]!.id })),
    { from: trip.segments[trip.segments.length - 1]!.id, to: null },
  ];

  const spare = [...trip.connections];
  const connections: Connection[] = [];
  const usedIds = new Set(trip.connections.map((c) => c.id));

  for (const want of wanted) {
    const index = spare.findIndex((c) => c.fromSegmentId === want.from && c.toSegmentId === want.to);
    if (index >= 0) {
      connections.push(spare.splice(index, 1)[0]!);
    } else {
      const id = nextId(usedIds, 'leg');
      usedIds.add(id);
      connections.push({ id, fromSegmentId: want.from, toSegmentId: want.to });
    }
  }

  const dropped = new Set(spare.map((c) => c.id));
  const removedCardIds = trip.cards
    .filter((c) => c.anchor.kind === 'connection' && dropped.has(c.anchor.connectionId))
    .map((c) => c.id);

  const unpaired = unpairLoneFares({
    ...trip,
    connections,
    cards: trip.cards.filter(
      (c) => c.anchor.kind !== 'connection' || !dropped.has(c.anchor.connectionId),
    ),
  });

  return { ...unpaired, removedCardIds };
}

export function addSegment(trip: Trip, name: string, atIndex?: number): EditResult {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'stop';
  const taken = new Set(trip.segments.map((s) => s.id));
  let id = slug;
  let n = 1;
  while (taken.has(id)) id = `${slug}-${++n + 0}`;

  const segment: Segment = { id, location: { name }, duration: { min: 1, ideal: 3, max: 7 } };
  const segments = [...trip.segments];
  segments.splice(atIndex ?? segments.length, 0, segment);

  return syncConnections({ ...trip, segments });
}

export function removeSegment(trip: Trip, segmentId: string): EditResult {
  const cardsHere = trip.cards.filter(
    (c) =>
      (c.anchor.kind === 'segment' || c.anchor.kind === 'segment-day') &&
      c.anchor.segmentId === segmentId,
  );

  const stripped: Trip = {
    ...trip,
    segments: trip.segments.filter((s) => s.id !== segmentId),
    cards: trip.cards.filter((c) => !cardsHere.includes(c)),
  };

  const synced = syncConnections(stripped);
  return {
    ...synced,
    removedCardIds: [...cardsHere.map((c) => c.id), ...synced.removedCardIds],
  };
}

export function moveSegment(trip: Trip, segmentId: string, delta: number): EditResult {
  const from = trip.segments.findIndex((s) => s.id === segmentId);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= trip.segments.length) {
    return { trip, removedCardIds: [], unpairedCardIds: [] };
  }

  const segments = [...trip.segments];
  const [moved] = segments.splice(from, 1);
  segments.splice(to, 0, moved!);
  return syncConnections({ ...trip, segments });
}

export function renameSegment(trip: Trip, segmentId: string, name: string): Trip {
  return {
    ...trip,
    segments: trip.segments.map((s) =>
      s.id === segmentId ? { ...s, location: { ...s.location, name } } : s,
    ),
  };
}

export function setSegmentRange(
  trip: Trip,
  segmentId: string,
  range: { min?: number; ideal?: number; max?: number },
): Trip {
  return {
    ...trip,
    segments: trip.segments.map((s) => {
      if (s.id !== segmentId) return s;
      const min = Math.max(0, range.min ?? s.duration.min);
      const max = Math.max(min, range.max ?? s.duration.max);
      const ideal = Math.min(max, Math.max(min, range.ideal ?? s.duration.ideal));
      return { ...s, duration: { min, ideal, max } };
    }),
  };
}

export function addCard(trip: Trip, card: Card): Trip {
  return { ...trip, cards: [...trip.cards, card] };
}

/**
 * Move a day-anchored card to a different day of its stay.
 *
 * The offset stays relative, so the card keeps travelling with the segment when the trip reflows.
 * This is also the remedy for an orphan: a card stranded past the end of a shortened stay has
 * somewhere to go that is not the bin.
 */
export function moveCardToDay(trip: Trip, cardId: string, dayOffset: number): Trip {
  return {
    ...trip,
    cards: trip.cards.map((c) =>
      c.id === cardId && c.anchor.kind === 'segment-day'
        ? { ...c, anchor: { ...c.anchor, dayOffset: Math.max(0, Math.trunc(dayOffset)) } }
        : c,
    ),
  };
}

export function removeCard(trip: Trip, cardId: string): Trip {
  return { ...trip, cards: trip.cards.filter((c) => c.id !== cardId) };
}

/** Add an option to a card. It becomes the selection when the card had nothing chosen. */
export function addOption(trip: Trip, cardId: string, option: Option): Trip {
  return {
    ...trip,
    cards: trip.cards.map((c) => {
      if (c.id !== cardId) return c;
      const options = [...c.options, option];
      if (c.selectedOptionId !== undefined) return { ...c, options };
      return { ...c, options, selectedOptionId: option.id, state: 'exploring' };
    }),
  };
}

export function updateOption(trip: Trip, cardId: string, option: Option): Trip {
  return {
    ...trip,
    cards: trip.cards.map((c) =>
      c.id === cardId
        ? { ...c, options: c.options.map((o) => (o.id === option.id ? option : o)) }
        : c,
    ),
  };
}

/**
 * Remove an option, and the rest of its fare with it.
 *
 * Half a return fare is not a thing anyone bought. Leaving the far leg behind would leave a
 * half-price option pointing at a purchase that no longer exists, which is a quietly wrong number —
 * worse than a removal the user was warned about. `fareGroupPartners` is what the interface uses to
 * do that warning before calling this.
 */
export function removeOption(trip: Trip, cardId: string, optionId: string): Trip {
  const doomed = new Map<string, string>([[cardId, optionId]]);
  for (const partner of fareGroupPartners(trip, cardId, optionId)) {
    doomed.set(partner.cardId, partner.optionId);
  }

  return {
    ...trip,
    cards: trip.cards.map((c) => {
      const gone = doomed.get(c.id);
      if (gone === undefined) return c;
      const options = c.options.filter((o) => o.id !== gone);
      if (c.selectedOptionId !== gone) return { ...c, options };

      // The selection just went away. Fall back to whatever is left rather than leaving the card
      // pointing at nothing.
      const fallback = options[0];
      if (fallback) return { ...c, options, selectedOptionId: fallback.id };
      const { selectedOptionId: _gone, ...rest } = c;
      return { ...rest, options, state: 'unplanned' as const };
    }),
  };
}

export function renameTrip(trip: Trip, name: string): Trip {
  return { ...trip, name };
}

/** Kinds that make sense to attach to a given anchor, used to shape the card editor. */
export function kindsForAnchor(anchor: Card['anchor']['kind']): readonly CardKind[] {
  switch (anchor) {
    case 'connection':
      return ['flight', 'transport'];
    case 'segment':
      return ['lodging', 'note'];
    case 'segment-day':
      return ['activity', 'dining', 'transport', 'note'];
  }
}
