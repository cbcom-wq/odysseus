import type { Budget, Card, CardAnchor, PlacedCard, Schedule, Trip } from '@odysseus/domain';
import { money, shortDate, weekday } from './format.js';
import { TravelCard } from './TravelCard.js';

/**
 * The dated grid: one row per day, columns for what moves, where you sleep, and what you do.
 *
 * A projection of the schedule and never a second source of truth — every date here comes out of
 * the scheduler. Adding from a cell works out the right anchor from the day itself, so you never
 * have to think about which stop a Tuesday belongs to.
 */

const COLUMNS = [
  { key: 'travel', label: 'Travel', kinds: ['flight', 'transport'], add: 'Travel' },
  { key: 'lodging', label: 'Lodging', kinds: ['lodging'], add: 'Somewhere to stay' },
  { key: 'doing', label: 'Activities', kinds: ['activity', 'dining', 'note'], add: 'Something to do' },
] as const;

export function DayView({
  trip,
  schedule,
  budget,
  placed,
  selectedCardId,
  conflictedCardIds,
  onSelectCard,
  onAdd,
}: {
  trip: Trip;
  schedule: Schedule;
  budget: Budget;
  placed: readonly PlacedCard[];
  selectedCardId: string | undefined;
  conflictedCardIds: ReadonlySet<string>;
  onSelectCard: (id: string) => void;
  onAdd: (anchor: CardAnchor) => void;
}) {
  const cardsOnDay = (day: number, kinds: readonly string[]): Card[] =>
    placed.filter((p) => p.days.includes(day) && kinds.includes(p.card.kind)).map((p) => p.card);

  /** The stop a given day belongs to, and how far into it that day is. */
  const stopOn = (day: number) => {
    const segment = schedule.segments.find(
      (s) => day >= s.startDay && day < s.startDay + s.nights,
    );
    return segment ? { segmentId: segment.segmentId, dayOffset: day - segment.startDay } : undefined;
  };

  /** The leg travelling on a given day, if any. */
  const legOn = (day: number): string | undefined => {
    for (const connection of trip.connections) {
      if (connection.fromSegmentId === null) {
        if (day === 0) return connection.id;
        continue;
      }
      const from = schedule.segments.find((s) => s.segmentId === connection.fromSegmentId);
      if (from && from.startDay + from.nights === day) return connection.id;
    }
    return undefined;
  };

  const anchorFor = (day: number, columnKey: string): CardAnchor | undefined => {
    if (columnKey === 'travel') {
      const leg = legOn(day);
      if (leg) return { kind: 'connection', connectionId: leg };
    }
    const stop = stopOn(day);
    if (!stop) return undefined;
    if (columnKey === 'lodging') return { kind: 'segment', segmentId: stop.segmentId };
    return { kind: 'segment-day', segmentId: stop.segmentId, dayOffset: stop.dayOffset };
  };

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
            const anchor = anchorFor(day.dayIndex, column.key);
            return (
              <div key={column.key} className="grid__cell">
                {cards.map((card) => (
                  <TravelCard
                    key={card.id}
                    card={card}
                    trip={trip}
                    selected={card.id === selectedCardId}
                    conflicted={conflictedCardIds.has(card.id)}
                    onSelect={onSelectCard}
                  />
                ))}
                {anchor ? (
                  <button
                    type="button"
                    className="add add--cell"
                    onClick={() => onAdd(anchor)}
                    title={`Add ${column.add.toLowerCase()}`}
                  >
                    + {column.add}
                  </button>
                ) : cards.length === 0 ? (
                  <span className="grid__empty">—</span>
                ) : null}
              </div>
            );
          })}

          <div className="grid__cost">
            {day.amount === 0 ? (
              <span style={{ color: '#a9b7b3' }}>—</span>
            ) : (
              money(day.amount, trip.currency)
            )}
            <small>{schedule.totalDays === day.dayIndex + 1 ? 'departing' : 'per day'}</small>
          </div>
        </div>
      ))}
    </div>
  );
}
