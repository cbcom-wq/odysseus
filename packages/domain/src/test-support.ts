import { SCHEMA_VERSION } from './types.js';
import type {
  Card,
  CardKind,
  Connection,
  Option,
  PlanningState,
  Segment,
  Trip,
  TripPreferences,
} from './types.js';

/** Builders for tests and fixtures. Keeps the intent of a test visible instead of buried in setup. */

export const DEFAULT_PREFERENCES: TripPreferences = {
  ranking: 'balanced',
  dayStart: '08:00',
  dayEnd: '22:00',
};

export function segment(
  id: string,
  name: string,
  duration: { min: number; ideal: number; max: number },
): Segment {
  return { id, location: { name }, duration };
}

export function connection(
  id: string,
  fromSegmentId: string | null,
  toSegmentId: string | null,
): Connection {
  return { id, fromSegmentId, toSegmentId };
}

export function journeyOption(
  id: string,
  opts: {
    title?: string;
    departDate: string;
    departTime?: string;
    arriveTime?: string;
    nightsInTransit?: 0 | 1;
    durationMinutes?: number;
    cost?: number;
  },
): Option {
  return {
    id,
    source: 'fixture',
    title: opts.title ?? id,
    cost: { kind: 'fixed', amount: opts.cost ?? 0 },
    timing: {
      kind: 'journey',
      departDate: opts.departDate,
      departTime: opts.departTime ?? '09:00',
      arriveTime: opts.arriveTime ?? '12:00',
      nightsInTransit: opts.nightsInTransit ?? 0,
      durationMinutes: opts.durationMinutes ?? 180,
    },
  };
}

export function stayOption(
  id: string,
  opts: { title?: string; checkIn: string; checkOut: string; perNight?: number },
): Option {
  return {
    id,
    source: 'fixture',
    title: opts.title ?? id,
    cost: { kind: 'per-night', amount: opts.perNight ?? 0 },
    timing: { kind: 'stay', checkIn: opts.checkIn, checkOut: opts.checkOut },
  };
}

/** Lodging with no fixed dates — a property and a rate, which is what a search actually returns. */
export function floatingStayOption(
  id: string,
  opts: { title?: string; perNight: number },
): Option {
  return {
    id,
    source: 'fixture',
    title: opts.title ?? id,
    cost: { kind: 'per-night', amount: opts.perNight },
  };
}

export function slotOption(
  id: string,
  opts: { title?: string; startTime: string; endTime: string; cost?: number },
): Option {
  return {
    id,
    source: 'fixture',
    title: opts.title ?? id,
    cost: { kind: 'fixed', amount: opts.cost ?? 0 },
    timing: { kind: 'slot', startTime: opts.startTime, endTime: opts.endTime },
  };
}

export function card(
  id: string,
  kind: CardKind,
  anchor: Card['anchor'],
  options: Option[],
  opts: { state?: PlanningState; selected?: string | null } = {},
): Card {
  const state = opts.state ?? 'selected';
  const selectedOptionId =
    opts.selected === null ? undefined : (opts.selected ?? options[0]?.id);
  return {
    id,
    kind,
    state,
    anchor,
    options,
    ...(selectedOptionId === undefined ? {} : { selectedOptionId }),
  };
}

export function trip(overrides: Partial<Trip> = {}): Trip {
  return {
    id: 'trip-1',
    name: 'Test Trip',
    travelers: 2,
    length: { min: 1, max: 60 },
    currency: 'USD',
    segments: [],
    connections: [],
    cards: [],
    preferences: DEFAULT_PREFERENCES,
    schemaVersion: SCHEMA_VERSION,
    ...overrides,
  };
}
