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
    return {
      trip: { ...trip, connections: [], cards: trip.cards.filter((c) => c.anchor.kind !== 'connection') },
      removedCardIds,
    };
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

  return {
    trip: {
      ...trip,
      connections,
      cards: trip.cards.filter(
        (c) => c.anchor.kind !== 'connection' || !dropped.has(c.anchor.connectionId),
      ),
    },
    removedCardIds,
  };
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
    trip: synced.trip,
    removedCardIds: [...cardsHere.map((c) => c.id), ...synced.removedCardIds],
  };
}

export function moveSegment(trip: Trip, segmentId: string, delta: number): EditResult {
  const from = trip.segments.findIndex((s) => s.id === segmentId);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= trip.segments.length) {
    return { trip, removedCardIds: [] };
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

export function removeOption(trip: Trip, cardId: string, optionId: string): Trip {
  return {
    ...trip,
    cards: trip.cards.map((c) => {
      if (c.id !== cardId) return c;
      const options = c.options.filter((o) => o.id !== optionId);
      if (c.selectedOptionId !== optionId) return { ...c, options };

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
