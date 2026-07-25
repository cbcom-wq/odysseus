import type { Budget, PlacedCard, Schedule, Trip } from '@odysseus/domain';
import { addDays } from '@odysseus/domain';
import { money, shortDate } from './format.js';
import { TravelCard } from './TravelCard.js';

/**
 * The trip as it is authored: an ordered list of places, each with a duration you can pull on.
 *
 * This is the layer the traveller actually thinks in. Days are downstream of it, so dragging Paris
 * from four nights to five reflows the whole calendar — and anything pinned by a chosen option
 * stays exactly where it is, which the reason line under each stay explains.
 */

const REASON_TEXT: Record<string, string> = {
  ideal: 'about right',
  'at-minimum': 'as short as you said you would go',
  'at-maximum': 'as long as you said you would stay',
  'compressed-to-fit': 'squeezed to fit the dates around it',
  'expanded-to-fit': 'stretched to fill the dates around it',
  'pinned-by-option': 'fixed by a booking you have chosen',
};

export function StructureView({
  trip,
  schedule,
  budget,
  placed,
  selectedCardId,
  conflictedCardIds,
  conflictedSegmentIds,
  onSelectCard,
  onChangeDuration,
}: {
  trip: Trip;
  schedule: Schedule;
  budget: Budget;
  placed: readonly PlacedCard[];
  selectedCardId: string | undefined;
  conflictedCardIds: ReadonlySet<string>;
  conflictedSegmentIds: ReadonlySet<string>;
  onSelectCard: (id: string) => void;
  onChangeDuration: (segmentId: string, nights: number) => void;
}) {
  const costOfSegment = (segmentId: string): number => {
    const days = new Set(
      schedule.segments
        .filter((s) => s.segmentId === segmentId)
        .flatMap((s) => Array.from({ length: s.nights }, (_, i) => s.startDay + i)),
    );
    return budget.byDay
      .filter((d) => days.has(d.dayIndex))
      .reduce((sum, d) => sum + d.amount, 0);
  };

  const connectionCardFor = (connectionId: string) =>
    placed.find((p) => p.card.anchor.kind === 'connection' && p.card.anchor.connectionId === connectionId);

  const inbound = trip.connections.find((c) => c.fromSegmentId === null);
  const outbound = trip.connections.find((c) => c.toSegmentId === null);

  const renderLeg = (connectionId: string | undefined) => {
    if (!connectionId) return null;
    const entry = connectionCardFor(connectionId);
    if (!entry) return null;
    return (
      <div className="leg" key={connectionId}>
        <span className="leg__rule" />
        <TravelCard
          card={entry.card}
          trip={trip}
          selected={entry.card.id === selectedCardId}
          conflicted={conflictedCardIds.has(entry.card.id)}
          onSelect={onSelectCard}
        />
      </div>
    );
  };

  return (
    <div className="stack">
      {renderLeg(inbound?.id)}

      {schedule.segments.map((scheduled, index) => {
        const segment = trip.segments.find((s) => s.id === scheduled.segmentId);
        if (!segment) return null;

        const pinned = scheduled.reason === 'pinned-by-option';
        const cards = placed.filter(
          (p) =>
            (p.card.anchor.kind === 'segment' && p.card.anchor.segmentId === segment.id) ||
            (p.card.anchor.kind === 'segment-day' && p.card.anchor.segmentId === segment.id),
        );
        const onward = trip.connections.find((c) => c.fromSegmentId === segment.id && c.toSegmentId !== null);

        return (
          <div key={segment.id}>
            <section
              className="seg"
              style={conflictedSegmentIds.has(segment.id) ? { borderColor: 'var(--flag)' } : undefined}
            >
              <div className="seg__top">
                <span className="seg__order">{index + 1}</span>
                <span className="seg__name">{segment.location.name}</span>
                {scheduled.startDate ? (
                  <span className="seg__dates">
                    {shortDate(scheduled.startDate)} → {shortDate(addDays(scheduled.startDate, scheduled.nights))}
                  </span>
                ) : null}
                <span className="seg__cost">{money(costOfSegment(segment.id), trip.currency)}</span>
              </div>

              <div className="dur">
                <span className="dur__nights">
                  {scheduled.nights}
                  <small>{scheduled.nights === 1 ? 'night' : 'nights'}</small>
                </span>
                <input
                  className="dur__slider"
                  type="range"
                  min={segment.duration.min}
                  max={segment.duration.max}
                  value={segment.duration.ideal}
                  disabled={pinned}
                  aria-label={`Nights you want in ${segment.location.name}`}
                  onChange={(e) => onChangeDuration(segment.id, Number(e.target.value))}
                />
                <span className="dur__why" data-pinned={pinned || scheduled.nights !== segment.duration.ideal}>
                  {scheduled.nights === segment.duration.ideal
                    ? (REASON_TEXT[scheduled.reason] ?? scheduled.reason)
                    : `You want ${segment.duration.ideal}; the dates around it allow ${scheduled.nights}`}
                </span>
              </div>

              {cards.length > 0 ? (
                <div className="seg__cards">
                  {cards.map((p) => (
                    <TravelCard
                      key={p.card.id}
                      card={p.card}
                      trip={trip}
                      selected={p.card.id === selectedCardId}
                      conflicted={conflictedCardIds.has(p.card.id)}
                      onSelect={onSelectCard}
                    />
                  ))}
                </div>
              ) : (
                <p className="grid__empty" style={{ margin: '10px 0 0' }}>
                  Nothing planned here yet.
                </p>
              )}
            </section>
            {renderLeg(onward?.id)}
          </div>
        );
      })}

      {renderLeg(outbound?.id)}
    </div>
  );
}
