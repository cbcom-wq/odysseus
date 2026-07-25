import type { Budget, CardAnchor, CardKind, PlacedCard, Schedule, Trip } from '@odysseus/domain';
import { addDays } from '@odysseus/domain';
import { money, shortDate } from './format.js';
import { TravelCard } from './TravelCard.js';

/**
 * The trip as it is authored: an ordered list of places, each with a duration you can pull on.
 *
 * This is the layer the traveller actually thinks in, and the only place the shape of the trip can
 * be changed — stops added, reordered, removed. Days are downstream of it, so pulling Paris from
 * four nights to five reflows the whole calendar, and anything fixed by a chosen option stays put.
 */

const REASON_TEXT: Record<string, string> = {
  ideal: 'about right',
  'at-minimum': 'as short as you said you would go',
  'at-maximum': 'as long as you said you would stay',
  'compressed-to-fit': 'squeezed to fit the dates around it',
  'expanded-to-fit': 'stretched to fill the dates around it',
  'pinned-by-option': 'fixed by a booking you have chosen',
};

const STAY_KINDS: readonly CardKind[] = ['lodging', 'note'];
const DAY_KINDS: readonly CardKind[] = ['activity', 'dining', 'transport'];
const LEG_KINDS: readonly CardKind[] = ['flight', 'transport'];

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
  onAdd,
  onAddStop,
  onRemoveStop,
  onMoveStop,
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
  onAdd: (anchor: CardAnchor, kinds: readonly CardKind[]) => void;
  onAddStop: (name: string, atIndex?: number) => void;
  onRemoveStop: (segmentId: string) => void;
  onMoveStop: (segmentId: string, delta: number) => void;
}) {
  const costOfSegment = (segmentId: string): number => {
    const days = new Set(
      schedule.segments
        .filter((s) => s.segmentId === segmentId)
        .flatMap((s) => Array.from({ length: s.nights }, (_, i) => s.startDay + i)),
    );
    return budget.byDay.filter((d) => days.has(d.dayIndex)).reduce((sum, d) => sum + d.amount, 0);
  };

  const promptStop = (atIndex?: number) => {
    const name = window.prompt('Where to?');
    if (name?.trim()) onAddStop(name.trim(), atIndex);
  };

  const renderLeg = (connectionId: string | undefined, label: string) => {
    if (!connectionId) return null;
    const entries = placed.filter(
      (p) => p.card.anchor.kind === 'connection' && p.card.anchor.connectionId === connectionId,
    );

    return (
      <div className="leg" key={connectionId}>
        <span className="leg__rule" />
        {entries.length > 0 ? (
          entries.map((entry) => (
            <TravelCard
              key={entry.card.id}
              card={entry.card}
              trip={trip}
              selected={entry.card.id === selectedCardId}
              conflicted={conflictedCardIds.has(entry.card.id)}
              onSelect={onSelectCard}
            />
          ))
        ) : (
          <span className="leg__gap">{label}</span>
        )}
        <button
          type="button"
          className="add"
          onClick={() => onAdd({ kind: 'connection', connectionId }, LEG_KINDS)}
        >
          + Travel
        </button>
      </div>
    );
  };

  const inbound = trip.connections.find((c) => c.fromSegmentId === null);
  const outbound = trip.connections.find((c) => c.toSegmentId === null);

  return (
    <div className="stack">
      {renderLeg(inbound?.id, 'No way there yet')}

      {schedule.segments.map((scheduled, index) => {
        const segment = trip.segments.find((s) => s.id === scheduled.segmentId);
        if (!segment) return null;

        const pinned = scheduled.reason === 'pinned-by-option';
        const wanted = segment.duration.ideal;
        const cards = placed.filter(
          (p) =>
            (p.card.anchor.kind === 'segment' || p.card.anchor.kind === 'segment-day') &&
            p.card.anchor.segmentId === segment.id,
        );
        const onward = trip.connections.find(
          (c) => c.fromSegmentId === segment.id && c.toSegmentId !== null,
        );

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
                    {shortDate(scheduled.startDate)} →{' '}
                    {shortDate(addDays(scheduled.startDate, scheduled.nights))}
                  </span>
                ) : null}
                <span className="seg__cost">{money(costOfSegment(segment.id), trip.currency)}</span>
                <span className="seg__tools">
                  <button
                    type="button"
                    className="icon"
                    title="Move earlier"
                    disabled={index === 0}
                    onClick={() => onMoveStop(segment.id, -1)}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className="icon"
                    title="Move later"
                    disabled={index === schedule.segments.length - 1}
                    onClick={() => onMoveStop(segment.id, 1)}
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    className="icon"
                    title={`Remove ${segment.location.name}`}
                    onClick={() => onRemoveStop(segment.id)}
                  >
                    ✕
                  </button>
                </span>
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
                  value={wanted}
                  disabled={pinned}
                  aria-label={`Nights you want in ${segment.location.name}`}
                  onChange={(e) => onChangeDuration(segment.id, Number(e.target.value))}
                />
                <span className="dur__why" data-pinned={pinned || scheduled.nights !== wanted}>
                  {scheduled.nights === wanted
                    ? (REASON_TEXT[scheduled.reason] ?? scheduled.reason)
                    : `You want ${wanted}; the dates around it allow ${scheduled.nights}`}
                </span>
              </div>

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
                <button
                  type="button"
                  className="add"
                  onClick={() => onAdd({ kind: 'segment', segmentId: segment.id }, STAY_KINDS)}
                >
                  + Somewhere to stay
                </button>
                <button
                  type="button"
                  className="add"
                  onClick={() =>
                    onAdd({ kind: 'segment-day', segmentId: segment.id, dayOffset: 0 }, DAY_KINDS)
                  }
                >
                  + Something to do
                </button>
              </div>
            </section>

            {renderLeg(onward?.id, 'No way onward yet')}

            <div className="insert">
              <button type="button" className="add add--quiet" onClick={() => promptStop(index + 1)}>
                + Add a stop here
              </button>
            </div>
          </div>
        );
      })}

      {renderLeg(outbound?.id, 'No way home yet')}
    </div>
  );
}
