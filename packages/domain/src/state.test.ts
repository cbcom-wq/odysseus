import { describe, expect, it } from 'vitest';
import {
  canTransition,
  mayMutate,
  mayRankAlternatives,
  maySuggestProactively,
  selectOption,
  transitionCard,
} from './state.js';
import { card, floatingStayOption } from './test-support.js';
import type { PlanningState } from './types.js';

const ALL: PlanningState[] = ['unplanned', 'exploring', 'selected', 'locked', 'booked'];

const hotel = (state: PlanningState) =>
  card(
    'c-hotel',
    'lodging',
    { kind: 'segment', segmentId: 'par' },
    [floatingStayOption('alpha', { perNight: 110 }), floatingStayOption('bravo', { perNight: 135 })],
    { state, selected: 'alpha' },
  );

describe('locking never hides alternatives', () => {
  // The rule that shapes the whole policy layer. If this fails, the user is being punished for
  // making a decision.
  it.each(ALL)('still ranks alternatives when %s', (state) => {
    expect(mayRankAlternatives(state)).toBe(true);
  });

  it('stops volunteering suggestions once locked, without hiding them', () => {
    expect(maySuggestProactively('selected')).toBe(true);
    expect(maySuggestProactively('locked')).toBe(false);
    expect(mayRankAlternatives('locked')).toBe(true);
  });
});

describe('booked cards', () => {
  it('reject mutation', () => {
    expect(mayMutate('booked')).toBe(false);
    for (const state of ALL.filter((s) => s !== 'booked')) {
      expect(mayMutate(state)).toBe(true);
    }
  });

  it('reject an option swap with an explanation', () => {
    const result = selectOption(hotel('booked'), 'bravo');
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toMatch(/booked/i);
  });

  it('can only be left by unlocking to locked', () => {
    expect(canTransition('booked', 'locked')).toBe(true);
    for (const state of ['unplanned', 'exploring', 'selected'] as const) {
      expect(canTransition('booked', state)).toBe(false);
    }
  });

  it('become mutable again after unlocking', () => {
    const unlocked = transitionCard(hotel('booked'), 'locked');
    expect(unlocked.ok).toBe(true);
    expect(unlocked.ok === true && selectOption(unlocked.card, 'bravo').ok).toBe(true);
  });
});

describe('selecting an option', () => {
  it('moves an unplanned card to exploring', () => {
    const result = selectOption(
      card('c', 'lodging', { kind: 'segment', segmentId: 'par' }, [
        floatingStayOption('alpha', { perNight: 110 }),
      ], { state: 'unplanned', selected: null }),
      'alpha',
    );
    expect(result.ok && result.card.state).toBe('exploring');
    expect(result.ok && result.card.selectedOptionId).toBe('alpha');
  });

  it('leaves the state alone once the user has moved past exploring', () => {
    // Swapping the contents of a decision is not the same as reopening it.
    const result = selectOption(hotel('locked'), 'bravo');
    expect(result.ok && result.card.state).toBe('locked');
    expect(result.ok && result.card.selectedOptionId).toBe('bravo');
  });

  it('rejects an option the card does not have', () => {
    const result = selectOption(hotel('exploring'), 'nonexistent');
    expect(result.ok).toBe(false);
  });

  it('does not mutate the card it is given', () => {
    const original = hotel('selected');
    const snapshot = JSON.stringify(original);
    selectOption(original, 'bravo');
    expect(JSON.stringify(original)).toBe(snapshot);
  });
});

describe('transitions', () => {
  it('treats a no-op transition as valid', () => {
    for (const state of ALL) expect(canTransition(state, state)).toBe(true);
  });

  it('allows the normal path forward', () => {
    expect(canTransition('unplanned', 'exploring')).toBe(true);
    expect(canTransition('exploring', 'selected')).toBe(true);
    expect(canTransition('selected', 'locked')).toBe(true);
    expect(canTransition('locked', 'booked')).toBe(true);
  });

  it('allows stepping back to keep comparing', () => {
    expect(canTransition('locked', 'exploring')).toBe(true);
    expect(canTransition('selected', 'exploring')).toBe(true);
  });

  it('does not allow jumping straight from unplanned to booked', () => {
    expect(canTransition('unplanned', 'booked')).toBe(false);
  });
});
