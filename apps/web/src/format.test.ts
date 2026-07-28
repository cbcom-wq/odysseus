import { describe, expect, it } from 'vitest';
import { money, moneyDelta } from './format.js';

/**
 * Prices have cents, and a split fare produces them whether or not anyone typed one.
 *
 * Rounding those away on screen is not a tidier display, it is arithmetic that stops working: the
 * two halves of a $1,304.05 fare are $652.03 and $652.02, and shown as $652 and $652 they add up to
 * the wrong number in front of someone who is checking.
 */

describe('money', () => {
  it('leaves whole prices whole', () => {
    expect(money(1304)).toBe('$1,304');
    expect(money(0)).toBe('$0');
  });

  it('shows cents when there are any', () => {
    expect(money(1304.05)).toBe('$1,304.05');
    expect(money(652.03)).toBe('$652.03');
    expect(money(0.5)).toBe('$0.50');
  });

  it('keeps a split fare adding up on screen', () => {
    expect(`${money(652.03)} + ${money(652.02)}`).toBe('$652.03 + $652.02');
    expect(money(652.03 + 652.02)).toBe(money(1304.05));
  });

  it('still names the currency it cannot symbolise', () => {
    expect(money(99.9, 'SEK')).toBe('99.90 SEK');
    expect(money(120, 'EUR')).toBe('€120');
  });

  it('rounds away binary floating point noise rather than printing it', () => {
    // 1304.05 × 3 lands on 3912.1499999999996.
    expect(money(1304.05 * 3)).toBe('$3,912.15');
  });
});

describe('moneyDelta', () => {
  it('signs the change', () => {
    expect(moneyDelta(-604)).toBe('−$604');
    expect(moneyDelta(48.5)).toBe('+$48.50');
  });

  it('calls a difference too small to pay for no difference at all', () => {
    expect(moneyDelta(0)).toBe('same cost');
    expect(moneyDelta(0.001)).toBe('same cost');
  });
});
