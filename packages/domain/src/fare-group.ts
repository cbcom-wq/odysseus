import type { Trip } from './types.js';

/**
 * Fares bought as one purchase.
 *
 * A return flight is a single charge that fills two slots. Nothing else in the model says so, and
 * without it the budget counts the fare twice and half a trip can be booked while the other half is
 * still being shopped.
 *
 * Everything here is a lookup over `Option.fareGroupId`. The group is not an entity — there is no
 * list of fares to keep in step with the cards — which is what stops it going stale when a card is
 * removed.
 */

export interface FareGroupMember {
  readonly cardId: string;
  readonly optionId: string;
}

/**
 * Ids derive from the trip rather than from a generator.
 *
 * The domain has no clock and no randomness; that is what makes scheduling reproducible, and
 * identity has to be a function of the trip for the same reason.
 */
export function nextFareGroupId(trip: Trip): string {
  let highest = 0;
  for (const card of trip.cards) {
    for (const option of card.options) {
      const match = /^fare-(\d+)$/.exec(option.fareGroupId ?? '');
      if (match) highest = Math.max(highest, Number(match[1]));
    }
  }
  return `fare-${highest + 1}`;
}

export function fareGroupMembers(trip: Trip, fareGroupId: string): FareGroupMember[] {
  const members: FareGroupMember[] = [];
  for (const card of trip.cards) {
    // One member per card. Two options on the same card sharing a group is malformed; take the
    // first rather than reporting a card twice and having callers select it twice.
    const option = card.options.find((o) => o.fareGroupId === fareGroupId);
    if (option) members.push({ cardId: card.id, optionId: option.id });
  }
  return members;
}

/** The other legs of the fare this option belongs to. Empty for an ordinary option. */
export function fareGroupPartners(
  trip: Trip,
  cardId: string,
  optionId: string,
): FareGroupMember[] {
  const option = trip.cards.find((c) => c.id === cardId)?.options.find((o) => o.id === optionId);
  if (option?.fareGroupId === undefined) return [];
  return fareGroupMembers(trip, option.fareGroupId).filter((m) => m.cardId !== cardId);
}

/**
 * What choosing an option does to the rest of the trip's selections.
 *
 * "Moves as one" has to be symmetric. Picking a return fare selects both legs, so picking something
 * else has to *release* both — otherwise abandoning a $1,304 return for a $700 one-way leaves the far
 * leg still holding its $652 half, and the trip reports the swap as $48 more expensive rather than
 * $604 cheaper. That number is worse than useless: it argues against the cheaper option.
 *
 * A released leg is left with nothing selected rather than quietly moved to another candidate. The
 * user is then told the leg has no flight, which is true, instead of having a decision made for them.
 */
export interface FareSelection {
  /** Cards that take a new selection, keyed by card id. */
  readonly select: ReadonlyMap<string, string>;
  /** Cards that held the other half of the outgoing fare and must let go of it. */
  readonly release: readonly string[];
}

export function fareSelection(trip: Trip, cardId: string, optionId: string): FareSelection {
  const card = trip.cards.find((c) => c.id === cardId);
  const incoming = card?.options.find((o) => o.id === optionId);

  const select = new Map<string, string>([[cardId, optionId]]);
  for (const partner of fareGroupPartners(trip, cardId, optionId)) {
    select.set(partner.cardId, partner.optionId);
  }

  const release: string[] = [];
  const outgoing =
    card?.selectedOptionId === undefined
      ? undefined
      : card.options.find((o) => o.id === card.selectedOptionId);

  // Staying inside the same fare is not a release — it is the same purchase.
  if (
    outgoing?.fareGroupId !== undefined &&
    outgoing.id !== optionId &&
    outgoing.fareGroupId !== incoming?.fareGroupId
  ) {
    for (const member of fareGroupMembers(trip, outgoing.fareGroupId)) {
      if (member.cardId === cardId || select.has(member.cardId)) continue;
      const other = trip.cards.find((c) => c.id === member.cardId);
      if (other?.selectedOptionId === member.optionId) release.push(member.cardId);
    }
  }

  return { select, release };
}

/**
 * Divide one fare across its legs.
 *
 * Split in cents so the parts add back up to the fare exactly — halving $1,304.05 in floating point
 * and doubling it again does not, and a budget that is a cent out is a budget the user stops
 * trusting. The remainder goes to the first leg.
 */
export function splitFare(total: number, ways: number): number[] {
  if (ways <= 0) return [];
  const cents = Math.round(total * 100);
  const each = Math.trunc(cents / ways);
  const remainder = cents - each * ways;
  return Array.from({ length: ways }, (_, i) => (each + (i < remainder ? 1 : 0)) / 100);
}
