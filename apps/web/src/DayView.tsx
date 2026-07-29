import type { Budget, Card, CardAnchor, PlacedCard, Schedule, Trip } from '@odysseus/domain';
import { stayNights } from '@odysseus/domain';
import { money, shortDate, weekday } from './format.js';
import { TravelCard } from './TravelCard.js';

/**
 * The dated grid: one row per day, columns for what moves, where you sleep, and what you do.
 *
 * A projection of the schedule and never a second source of truth — every date here comes out of
 * the scheduler. Adding from a cell works out the right anchor from the day itself, so you never
 * have to think about which stop a Tuesday belongs to.
 *
 * Lodging is the one column that does not repeat itself. Where you sleep is decided per place, so a
 * hotel draws once as a ribbon down the nights it covers rather than as an identical card on each
 * one — five rows that look like five decisions are five decisions, as far as a reader is concerned.
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
  onSplitStay,
}: {
  trip: Trip;
  schedule: Schedule;
  budget: Budget;
  placed: readonly PlacedCard[];
  selectedCardId: string | undefined;
  conflictedCardIds: ReadonlySet<string>;
  onSelectCard: (id: string) => void;
  onAdd: (anchor: CardAnchor) => void;
  onSplitStay: (segmentId: string, fromNight: number) => void;
}) {
  const cardsOnDay = (day: number, kinds: readonly string[]): Card[] =>
    placed.filter((p) => p.days.includes(day) && kinds.includes(p.card.kind)).map((p) => p.card);

  // Read from the same derivation the budget and the conflict checks use, rather than from the
  // placed cards: a stay you have just split off has nothing chosen for it yet and would otherwise
  // be invisible on the nights it already owns.
  const nights = stayNights(trip, schedule);

  /** The stay covering a given night. At most one, since stays cannot claim the same night. */
  const stayOn = (day: number): { card: Card; days: readonly number[] } | undefined => {
    for (const card of trip.cards) {
      if (card.kind !== 'lodging') continue;
      const days = nights.get(card.id);
      if (days?.includes(day)) return { card, days };
    }
    return undefined;
  };

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

            if (column.key === 'lodging') {
              return (
                <StayCell
                  key={column.key}
                  trip={trip}
                  stay={stayOn(day.dayIndex)}
                  day={day.dayIndex}
                  stop={stopOn(day.dayIndex)}
                  selectedCardId={selectedCardId}
                  conflictedCardIds={conflictedCardIds}
                  onSelectCard={onSelectCard}
                  onAdd={onAdd}
                  onSplitStay={onSplitStay}
                />
              );
            }

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

/**
 * One night of the lodging column.
 *
 * The stay draws in full on the night you check in and thins to a rule after that, so a five-night
 * hotel reads as one decision running down the grid instead of five identical ones. Every night of
 * it selects the same card and lights up together, which is the part that has to be obvious: change
 * the hotel from any night and you have changed it for the whole stay.
 *
 * The exception is where the change is the point. Any night after the first offers to hand the rest
 * of the stay to somewhere else — the thought arrives on a particular night ("from Thursday we're
 * somewhere else"), so that is where the control lives. It is also the only way to get a second
 * hotel into one place, which is what stops two of them silently covering the same nights.
 */
function StayCell({
  trip,
  stay,
  day,
  stop,
  selectedCardId,
  conflictedCardIds,
  onSelectCard,
  onAdd,
  onSplitStay,
}: {
  trip: Trip;
  stay: { card: Card; days: readonly number[] } | undefined;
  day: number;
  stop: { segmentId: string; dayOffset: number } | undefined;
  selectedCardId: string | undefined;
  conflictedCardIds: ReadonlySet<string>;
  onSelectCard: (id: string) => void;
  onAdd: (anchor: CardAnchor) => void;
  onSplitStay: (segmentId: string, fromNight: number) => void;
}) {
  const first = stay?.days[0] === day;
  const last = stay !== undefined && stay.days[stay.days.length - 1] === day;
  const selected = stay?.card.id === selectedCardId;
  const chosen = stay?.card.options.find((o) => o.id === stay.card.selectedOptionId);

  return (
    <div className="grid__cell">
      {stay && first ? (
        <TravelCard
          card={stay.card}
          trip={trip}
          selected={selected}
          conflicted={conflictedCardIds.has(stay.card.id)}
          onSelect={onSelectCard}
        />
      ) : null}

      {stay && !first ? (
        <button
          type="button"
          className="stay"
          aria-pressed={selected}
          data-conflicted={conflictedCardIds.has(stay.card.id)}
          onClick={() => onSelectCard(stay.card.id)}
        >
          <span className="stay__rule" data-last={last} />
          <span className="stay__text">
            {chosen
              ? `${last ? 'Last night at' : 'Still at'} ${chosen.title}`
              : 'Still nowhere to stay'}
          </span>
        </button>
      ) : null}

      {stop && !stay ? (
        <button
          type="button"
          className="add add--cell"
          onClick={() =>
            onAdd({
              kind: 'segment',
              segmentId: stop.segmentId,
              ...(stop.dayOffset > 0 ? { fromNight: stop.dayOffset } : {}),
            })
          }
          title="Add somewhere to stay"
        >
          + Somewhere to stay
        </button>
      ) : null}

      {stop && stay && !first ? (
        <button
          type="button"
          className="add add--cell"
          onClick={() => onSplitStay(stop.segmentId, stop.dayOffset)}
          title="Stay somewhere else from this night on"
        >
          + Change where you stay
        </button>
      ) : null}

      {!stop && !stay ? <span className="grid__empty">—</span> : null}
    </div>
  );
}
