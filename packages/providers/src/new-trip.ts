import { SCHEMA_VERSION, syncConnections } from '@odysseus/domain';
import type { Trip } from '@odysseus/domain';

export interface NewTripInput {
  readonly name: string;
  readonly travelers: number;
  readonly nights: { min: number; max: number };
  readonly destinations: readonly string[];
  readonly startDate?: string;
}

/**
 * Build an empty trip from the create flow.
 *
 * Destinations arrive as nothing but names, with no dates and no options chosen. That is the point:
 * the trip should be usable the moment you can name where you want to go, and become concrete as
 * decisions get made. Durations start at a generous spread so the scheduler has room to work before
 * the traveller has an opinion.
 */
/**
 * A starting duration for each stop, derived from the trip the traveller described.
 *
 * A fixed default would fight what they just told us: ten nights across one city should not open at
 * three, and a week across five stops should not open at fifteen. Splitting the requested length
 * evenly is a guess, but it is a guess in the right neighbourhood, and every stop stays free to
 * stretch to the whole trip because early on any of them might.
 */
function startingRange(input: NewTripInput): { min: number; ideal: number; max: number } {
  const stops = Math.max(1, input.destinations.length);
  const midpoint = (input.nights.min + input.nights.max) / 2;
  const ideal = Math.max(1, Math.round(midpoint / stops));
  return { min: 1, ideal, max: Math.max(ideal, input.nights.max) };
}

export function buildNewTrip(input: NewTripInput): Trip {
  const seen = new Map<string, number>();

  // Legs are derived from the stops, so a brand new trip already has somewhere to put the flight
  // out, the trains between, and the flight home.
  return syncConnections({
    id: `trip-${input.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${input.destinations.length}`,
    name: input.name,
    travelers: input.travelers,
    ...(input.startDate ? { anchorDate: input.startDate } : {}),
    length: input.nights,
    currency: 'USD',
    preferences: { ranking: 'balanced', dayStart: '08:00', dayEnd: '22:00' },
    schemaVersion: SCHEMA_VERSION,
    segments: input.destinations.map((name) => {
      // Two stops with the same name would collide on id; disambiguate rather than silently merge.
      const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      const count = (seen.get(slug) ?? 0) + 1;
      seen.set(slug, count);
      return {
        id: count === 1 ? slug : `${slug}-${count}`,
        location: { name },
        duration: startingRange(input),
      };
    }),
    connections: [],
    cards: [],
  }).trip;
}
