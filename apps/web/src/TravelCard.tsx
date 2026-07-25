import type { Card, Trip } from '@odysseus/domain';
import { optionCost, optionTiming } from './format.js';

/**
 * The reusable card.
 *
 * One component for every kind of thing in a trip, in both views. The left edge carries the
 * planning state as colour, which is the only place state is expressed visually — it is a property
 * of the decision, not of the thing.
 */
export function TravelCard({
  card,
  trip,
  selected,
  conflicted,
  onSelect,
}: {
  card: Card;
  trip: Trip;
  selected: boolean;
  conflicted: boolean;
  onSelect: (id: string) => void;
}) {
  const option = card.options.find((o) => o.id === card.selectedOptionId);
  const timing = option ? optionTiming(option) : undefined;
  const alternatives = card.options.length - 1;

  return (
    <button
      type="button"
      className="tcard"
      data-state={card.state}
      data-conflicted={conflicted}
      aria-pressed={selected}
      onClick={() => onSelect(card.id)}
    >
      <span className="tcard__top">
        <span className="tcard__title">{option?.title ?? 'Nothing chosen yet'}</span>
        {option ? <span className="tcard__cost">{optionCost(option, trip.currency)}</span> : null}
      </span>
      {timing ? <span className="tcard__meta">{timing}</span> : null}
      {option?.detail ? <span className="tcard__meta">{option.detail}</span> : null}
      {conflicted ? <span className="tcard__flag">Needs attention</span> : null}
      {!option && alternatives >= 0 ? (
        <span className="tcard__meta">
          {card.options.length} option{card.options.length === 1 ? '' : 's'} to compare
        </span>
      ) : null}
    </button>
  );
}
