import { fareGroupPartners, fareSelection } from './fare-group.js';
import type { Card, PlanningState, Trip } from './types.js';

/**
 * Planning state governs *policy* — what the system is allowed to do to a card. It has no say in
 * scheduling, which reads option timing regardless of state (see scheduler.ts).
 *
 * The rule that shapes this file: locking a card never hides its alternatives. Locking stops the
 * system from *volunteering* changes. "It's locked, but show me what I'd be giving up" has to stay
 * answerable, or the user is punished for making a decision.
 */

const TRANSITIONS: Readonly<Record<PlanningState, readonly PlanningState[]>> = {
  unplanned: ['exploring', 'selected'],
  exploring: ['unplanned', 'selected', 'locked'],
  selected: ['unplanned', 'exploring', 'locked', 'booked'],
  locked: ['exploring', 'selected', 'booked'],
  // Leaving booked is deliberately a single door. Money has changed hands; stepping back to locked
  // is the explicit unlock, and everything else has to go through it.
  booked: ['locked'],
};

export function canTransition(from: PlanningState, to: PlanningState): boolean {
  return from === to || (TRANSITIONS[from]?.includes(to) ?? false);
}

/** Whether the card's contents may be edited or its option swapped. */
export function mayMutate(state: PlanningState): boolean {
  return state !== 'booked';
}

/** Whether the system may push suggestions for this card unprompted. */
export function maySuggestProactively(state: PlanningState): boolean {
  return state === 'unplanned' || state === 'exploring' || state === 'selected';
}

/**
 * Whether alternatives may be ranked and shown at all.
 *
 * Always true, on purpose. See the note at the top of this file.
 */
export function mayRankAlternatives(_state: PlanningState): boolean {
  return true;
}

export type StateChange =
  | { readonly ok: true; readonly card: Card }
  | { readonly ok: false; readonly reason: string };

export function transitionCard(card: Card, to: PlanningState): StateChange {
  if (!canTransition(card.state, to)) {
    return {
      ok: false,
      reason:
        card.state === 'booked'
          ? `${card.id} is booked. Unlock it first if you want to change it.`
          : `${card.id} cannot go from ${card.state} to ${to}.`,
    };
  }
  return { ok: true, card: { ...card, state: to } };
}

/** Choose which option fills a card. Rejected on booked cards, which must be unlocked first. */
export function selectOption(card: Card, optionId: string): StateChange {
  if (!mayMutate(card.state)) {
    return { ok: false, reason: `${card.id} is booked. Unlock it before changing the option.` };
  }
  if (!card.options.some((o) => o.id === optionId)) {
    return { ok: false, reason: `${card.id} has no option ${optionId}.` };
  }

  // Picking something while nothing was chosen is what moves a card off unplanned. Any further
  // state change is the user's to make.
  const state: PlanningState = card.state === 'unplanned' ? 'exploring' : card.state;
  return { ok: true, card: { ...card, state, selectedOptionId: optionId } };
}

export type TripChange =
  | { readonly ok: true; readonly trip: Trip }
  | { readonly ok: false; readonly reason: string };

/**
 * The trip-level forms, which are what the interface should call.
 *
 * A return fare is one purchase filling two slots, so a decision about one leg is a decision about
 * both. Card-level `selectOption` and `transitionCard` cannot see that — they are handed a single
 * card — which is why the group-aware versions live here and take the whole trip.
 *
 * Either the whole group moves or none of it does. A half-applied fare is the state this exists to
 * prevent, so a partner that refuses fails the entire change rather than leaving the legs disagreeing.
 */
export function selectOptionInTrip(trip: Trip, cardId: string, optionId: string): TripChange {
  const card = trip.cards.find((c) => c.id === cardId);
  if (!card) return { ok: false, reason: `No card ${cardId}.` };

  const chosen = selectOption(card, optionId);
  if (!chosen.ok) return { ok: false, reason: chosen.reason };

  const { select, release } = fareSelection(trip, cardId, optionId);
  const updated = new Map<string, Card>([[cardId, chosen.card]]);

  for (const [partnerId, partnerOptionId] of select) {
    if (partnerId === cardId) continue;
    const other = trip.cards.find((c) => c.id === partnerId);
    if (!other) continue;
    const result = selectOption(other, partnerOptionId);
    if (!result.ok) return { ok: false, reason: `${result.reason} It is the other leg of this fare.` };
    updated.set(partnerId, result.card);
  }

  // Letting go of a fare frees its other leg too. Left selected, it would go on charging half a
  // price for a purchase that has just been abandoned.
  for (const partnerId of release) {
    const other = trip.cards.find((c) => c.id === partnerId);
    if (!other) continue;
    if (!mayMutate(other.state)) {
      return { ok: false, reason: `${other.id} is booked. It is the other leg of this fare.` };
    }
    const { selectedOptionId: _dropped, ...rest } = other;
    updated.set(partnerId, { ...rest, state: 'exploring' });
  }

  return { ok: true, trip: { ...trip, cards: trip.cards.map((c) => updated.get(c.id) ?? c) } };
}

/**
 * Move a card's planning state, taking the rest of its fare with it.
 *
 * Only propagates to partners that have the paired option actually selected. A card merely holding
 * the other half of a fare it did not choose is not part of this decision.
 */
export function transitionCardInTrip(trip: Trip, cardId: string, to: PlanningState): TripChange {
  const card = trip.cards.find((c) => c.id === cardId);
  if (!card) return { ok: false, reason: `No card ${cardId}.` };

  const moved = transitionCard(card, to);
  if (!moved.ok) return { ok: false, reason: moved.reason };

  const updated = new Map<string, Card>([[cardId, moved.card]]);
  if (card.selectedOptionId !== undefined) {
    for (const partner of fareGroupPartners(trip, cardId, card.selectedOptionId)) {
      const other = trip.cards.find((c) => c.id === partner.cardId);
      if (!other || other.selectedOptionId !== partner.optionId) continue;
      const result = transitionCard(other, to);
      if (!result.ok) {
        return { ok: false, reason: `${result.reason} It is the other leg of this fare.` };
      }
      updated.set(partner.cardId, result.card);
    }
  }

  return { ok: true, trip: { ...trip, cards: trip.cards.map((c) => updated.get(c.id) ?? c) } };
}
