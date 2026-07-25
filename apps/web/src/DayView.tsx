import type { Budget, Card, PlacedCard, Schedule, Trip } from '@odysseus/domain';
import { money, shortDate, weekday } from './format.js';
import { TravelCard } from './TravelCard.js';

/**
 * The dated grid from the mockup: one row per day, columns for what moves, where you sleep, and
 * what you do. A projection of the schedule, never a second source of truth — every date here comes
 * out of the scheduler.
 */

const COLUMNS = [
  { key: 'travel', label: 'Travel', kinds: ['flight', 'transport'] },
  { key: 'lodging', label: 'Lodging', kinds: ['lodging'] },
  { key: 'doing', label: 'Activities', kinds: ['activity', 'dining', 'note'] },
] as const;

export function DayView({
  trip,
  schedule,
  budget,
  placed,
  selectedCardId,
  conflictedCardIds,
  onSelectCard,
}: {
  trip: Trip;
  schedule: Schedule;
  budget: Budget;
  placed: readonly PlacedCard[];
  selectedCardId: string | undefined;
  conflictedCardIds: ReadonlySet<string>;
  onSelectCard: (id: string) => void;
}) {
  const cardsOnDay = (day: number, kinds: readonly string[]): Card[] =>
    placed
      .filter((p) => p.days.includes(day) && kinds.includes(p.card.kind))
      .map((p) => p.card);

  return (
    <div className="grid">
      <div className="grid__head">
        <div className="label">Day</div>
        {COLUMNS.map((c) => (
          <div key={c.key} className="label">
            {c.label}
          </div>
        ))}
        <div className="label" style={{ textAlign: 'right' }}>
          Cost
        </div>
      </div>

      {budget.byDay.map((day) => (
        <div key={day.dayIndex} className="grid__row">
          <div className="grid__day">
            {day.date ? (
              <>
                <span className="grid__dow">{weekday(day.date)}</span>
                <span className="grid__date">{shortDate(day.date)}</span>
              </>
            ) : (
              <span className="grid__date">Day {day.dayIndex + 1}</span>
            )}
            <span className="grid__index">Day {day.dayIndex + 1}</span>
          </div>

          {COLUMNS.map((column) => {
            const cards = cardsOnDay(day.dayIndex, column.kinds);
            return (
              <div key={column.key} className="grid__cell">
                {cards.length === 0 ? (
                  <span className="grid__empty">—</span>
                ) : (
                  cards.map((card) => (
                    <TravelCard
                      key={card.id}
                      card={card}
                      trip={trip}
                      selected={card.id === selectedCardId}
                      conflicted={conflictedCardIds.has(card.id)}
                      onSelect={onSelectCard}
                    />
                  ))
                )}
              </div>
            );
          })}

          <div className="grid__cost">
            {day.amount === 0 ? <span style={{ color: '#a9b7b3' }}>—</span> : money(day.amount, trip.currency)}
            <small>{schedule.totalDays === day.dayIndex + 1 ? 'departing' : 'per day'}</small>
          </div>
        </div>
      ))}
    </div>
  );
}
