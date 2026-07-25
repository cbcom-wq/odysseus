import type { PlanningState, RankedOption, Schedule, Trip } from '@odysseus/domain';
import { canTransition, rankOptions } from '@odysseus/domain';
import { hoursDelta, moneyDelta, optionCost, optionTiming } from './format.js';

/**
 * The primary surface of the workspace.
 *
 * Everything here answers one question: what would this alternative do to the trip? Never what it
 * costs on its own. An option that is $96 cheaper and loses you an evening should be visibly a
 * tradeoff, not a saving.
 */

const STATES: readonly PlanningState[] = ['exploring', 'selected', 'locked', 'booked'];

export function OptionsPanel({
  trip,
  schedule,
  selectedCardId,
  onChooseOption,
  onChangeState,
  onAddOption,
  onEditOption,
  onRemoveOption,
  onRemoveCard,
}: {
  trip: Trip;
  schedule: Schedule;
  selectedCardId: string | undefined;
  onChooseOption: (cardId: string, optionId: string) => void;
  onChangeState: (cardId: string, state: PlanningState) => void;
  onAddOption: (cardId: string) => void;
  onEditOption: (cardId: string, optionId: string) => void;
  onRemoveOption: (cardId: string, optionId: string) => void;
  onRemoveCard: (cardId: string) => void;
}) {
  const card = trip.cards.find((c) => c.id === selectedCardId);

  if (!card) {
    return (
      <aside className="panel">
        <div className="panel__empty">
          Pick anything in the trip to see what else it could be, and what each choice would do to
          the days around it.
        </div>
      </aside>
    );
  }

  const ranked = rankOptions(trip, card.id);
  const current = card.options.find((o) => o.id === card.selectedOptionId);

  return (
    <aside className="panel">
      <div className="panel__head">
        <span className="label">{card.kind}</span>
        <h2 className="panel__title">{current?.title ?? 'Nothing chosen yet'}</h2>
        {current ? (
          <div className="panel__meta">
            {optionCost(current, trip.currency)}
            {optionTiming(current) ? ` · ${optionTiming(current)}` : ''}
          </div>
        ) : null}

        <div className="panel__states">
          {STATES.map((state) => (
            <button
              key={state}
              type="button"
              className="pill"
              aria-pressed={card.state === state}
              disabled={!canTransition(card.state, state)}
              title={
                canTransition(card.state, state)
                  ? undefined
                  : card.state === 'booked'
                    ? 'Unlock this booking first'
                    : `Cannot go from ${card.state} to ${state}`
              }
              onClick={() => onChangeState(card.id, state)}
            >
              {state}
            </button>
          ))}
        </div>
      </div>

      <div className="panel__scroll">
        {card.state === 'booked' ? (
          <p className="panel__note">
            This is booked, so nothing here will change it. The alternatives stay visible — unlock it
            if you want to weigh them properly.
          </p>
        ) : (
          <p className="panel__note">
            Sorted by what each would do to the whole trip, not by price.
            {' '}Currently weighing for <strong>{trip.preferences.ranking.replace('-', ' ')}</strong>.
          </p>
        )}

        {ranked.length === 0 ? (
          <p className="panel__note">
            Nothing to compare yet. Add what you have found and it will be weighed against the rest
            of the trip.
          </p>
        ) : null}

        {ranked.map((entry) => (
          <OptionRow
            key={entry.option.id}
            entry={entry}
            trip={trip}
            schedule={schedule}
            canEdit={entry.option.source === 'user'}
            canRemove={card.options.length > 1 || entry.option.source === 'user'}
            onChoose={() => onChooseOption(card.id, entry.option.id)}
            onEdit={() => onEditOption(card.id, entry.option.id)}
            onRemove={() => onRemoveOption(card.id, entry.option.id)}
          />
        ))}

        <div className="panel__tools">
          <button type="button" className="btn" onClick={() => onAddOption(card.id)}>
            + Add an option you found
          </button>
          <button
            type="button"
            className="btn btn--quiet"
            onClick={() => {
              if (window.confirm(`Remove ${current?.title ?? 'this'} from the trip?`)) {
                onRemoveCard(card.id);
              }
            }}
          >
            Remove from trip
          </button>
        </div>
      </div>
    </aside>
  );
}

function OptionRow({
  entry,
  trip,
  schedule,
  canEdit,
  canRemove,
  onChoose,
  onEdit,
  onRemove,
}: {
  entry: RankedOption;
  trip: Trip;
  schedule: Schedule;
  canEdit: boolean;
  canRemove: boolean;
  onChoose: () => void;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const { option, impact, isCurrent, warning } = entry;
  const timing = optionTiming(option);
  const moved = new Set(impact.scheduleShift.map((s) => s.segmentId));

  return (
    <div className="opt-wrap">
    <button
      type="button"
      className="opt"
      data-current={isCurrent}
      data-conflicted={impact.conflictsIntroduced.length > 0}
      onClick={onChoose}
      disabled={isCurrent}
    >
      <span className="opt__top">
        <span className="opt__title">{option.title}</span>
        {isCurrent ? <span className="opt__badge">chosen</span> : null}
        {option.source === 'user' ? <span className="opt__badge">yours</span> : null}
        <span className="opt__fare">{optionCost(option, trip.currency)}</span>
      </span>

      {option.detail ? <span className="opt__detail">{option.detail}</span> : null}
      {timing ? <span className="opt__times">{timing}</span> : null}

      {isCurrent ? null : (
        <>
          <span className="deltas">
            <span className="delta" data-axis={impact.costDelta === 0 ? 'none' : 'money'}>
              {moneyDelta(impact.costDelta, trip.currency)}
            </span>
            <span className="delta" data-axis={impact.usableHoursDelta === 0 ? 'none' : 'time'}>
              {hoursDelta(impact.usableHoursDelta)}
            </span>
            {impact.conflictsResolved.length > 0 ? (
              <span className="delta" data-axis="time">
                fixes {impact.conflictsResolved.length}
              </span>
            ) : null}
          </span>

          <TripSpine schedule={schedule} moved={moved} />
          <span className="spine__caption">{ripple(entry, trip)}</span>
        </>
      )}

      {warning ? (
        <span className="opt__warn">
          <span aria-hidden="true">▲</span>
          <span>{warning}</span>
        </span>
      ) : null}
    </button>

      {/* Sibling buttons rather than nested ones: a button inside a button is invalid markup and
          breaks keyboard navigation. */}
      {canEdit || canRemove ? (
        <div className="opt__tools">
          {canEdit ? (
            <button type="button" className="link" onClick={onEdit}>
              Edit
            </button>
          ) : null}
          {canRemove ? (
            <button type="button" className="link" onClick={onRemove}>
              Remove
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/**
 * What this choice does beyond its own slot.
 *
 * "Nothing else moves" has to be earned. A flight that turns a red-eye into a morning departure
 * changes how long you are away even when every city keeps its dates, and saying nothing moved
 * would be quietly wrong.
 */
function ripple(entry: RankedOption, trip: Trip): string {
  const { scheduleShift, tripNightsDelta } = entry.impact;
  const parts: string[] = [];

  if (tripNightsDelta !== 0) {
    const nights = Math.abs(tripNightsDelta);
    parts.push(
      `Trip gets ${nights} night${nights === 1 ? '' : 's'} ${tripNightsDelta > 0 ? 'longer' : 'shorter'}`,
    );
  }

  if (scheduleShift.length > 0) {
    const names = scheduleShift.map(
      (s) => trip.segments.find((seg) => seg.id === s.segmentId)?.location.name ?? s.segmentId,
    );
    parts.push(`Shifts ${names.join(', ')}`);
  }

  return parts.length === 0 ? 'Nothing else in the trip moves' : parts.join(' · ');
}

/**
 * The signature element: a miniature of the whole trip, segments sized by nights.
 *
 * Choosing a different flight is not a local edit — it ripples downstream. The spine makes that
 * visible before committing: quiet grey when a swap is contained, lit when it moves things.
 */
function TripSpine({ schedule, moved }: { schedule: Schedule; moved: ReadonlySet<string> }) {
  const total = schedule.segments.reduce((sum, s) => sum + s.nights, 0) || 1;
  return (
    <span className="spine" aria-hidden="true">
      {schedule.segments.map((s) => (
        <span
          key={s.segmentId}
          className="spine__seg"
          data-changed={moved.has(s.segmentId)}
          style={{ flexGrow: Math.max(s.nights, 0.5) / total }}
        />
      ))}
    </span>
  );
}
