import { addDays } from './dates.js';
import { placeCards } from './layout.js';
import type { Schedule } from './scheduler.js';
import type { CardKind, IsoDate, Trip } from './types.js';

/**
 * Budget is always derived, never stored.
 *
 * Totals kept alongside the model are totals that go stale. Every figure here is recomputed from the
 * currently selected options, which is what makes "swap an option and watch the trip recalculate"
 * true rather than approximately true.
 *
 * Costs are recorded as the amount for the whole party, not per person. Slice 1 has no per-traveller
 * pricing; `trip.travelers` exists for display and for providers to reason about.
 */

export interface BudgetLine {
  readonly cardId: string;
  readonly kind: CardKind;
  readonly title: string;
  readonly amount: number;
}

export interface DayBudget {
  readonly dayIndex: number;
  readonly date?: IsoDate;
  readonly amount: number;
  readonly lines: readonly BudgetLine[];
}

export interface Budget {
  readonly currency: string;
  readonly total: number;
  readonly byCategory: Readonly<Partial<Record<CardKind, number>>>;
  readonly byDay: readonly DayBudget[];
}

export function computeBudget(trip: Trip, schedule: Schedule): Budget {
  const dayLines = new Map<number, BudgetLine[]>();
  const byCategory: Partial<Record<CardKind, number>> = {};
  let total = 0;

  for (const { card, option, days } of placeCards(trip, schedule)) {
    if (days.length === 0) continue;

    // A per-night cost repeats across every night of the stay; a fixed cost belongs to the single
    // day the card happens on. This is what makes the mockup's daily figures add up.
    const perNight = option.cost.kind === 'per-night';
    const targetDays = perNight ? days : [days[0]!];
    const amount = option.cost.amount;

    for (const day of targetDays) {
      const line: BudgetLine = { cardId: card.id, kind: card.kind, title: option.title, amount };
      const existing = dayLines.get(day);
      if (existing) existing.push(line);
      else dayLines.set(day, [line]);

      total += amount;
      byCategory[card.kind] = (byCategory[card.kind] ?? 0) + amount;
    }
  }

  const byDay: DayBudget[] = [];
  for (let day = 0; day < schedule.totalDays; day++) {
    const lines = dayLines.get(day) ?? [];
    byDay.push({
      dayIndex: day,
      ...(schedule.startDate === undefined ? {} : { date: addDays(schedule.startDate, day) }),
      amount: lines.reduce((sum, l) => sum + l.amount, 0),
      lines,
    });
  }

  return { currency: trip.currency, total, byCategory, byDay };
}
