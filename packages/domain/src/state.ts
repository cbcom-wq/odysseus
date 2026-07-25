import type { Card, PlanningState } from './types.js';

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
