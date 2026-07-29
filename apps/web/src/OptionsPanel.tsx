import type {
  Card,
  Option,
  PlacedCard,
  PlanningState,
  RankedOption,
  RankingPreset,
  Schedule,
  Trip,
} from '@odysseus/domain';
import { addDays, canTransition, rankOptions } from '@odysseus/domain';
import {
  groundTimeBasis,
  hoursDelta,
  moneyDelta,
  optionCost,
  optionTiming,
  shortDate,
} from './format.js';

/**
 * The primary surface of the workspace.
 *
 * Everything here answers one question: what would this alternative do to the trip? Never what it
 * costs on its own. An option that is $96 cheaper and loses you an evening should be visibly a
 * tradeoff, not a saving.
 */

const STATES: readonly PlanningState[] = ['exploring', 'selected', 'locked', 'booked'];

const PRESETS: readonly { id: RankingPreset; label: string; hint: string }[] = [
  { id: 'best-value', label: 'best value', hint: 'Money matters most; time on the ground is a bonus.' },
  { id: 'balanced', label: 'balanced', hint: 'Money and time on the ground weighed against each other.' },
  { id: 'comfort', label: 'comfort', hint: 'Time on the ground and short journeys beat the price.' },
];

export function OptionsPanel({
  trip,
  schedule,
  placed,
  selectedCardId,
  onChooseOption,
  onChangeState,
  onChangeRanking,
  onMoveCardToDay,
  onAddOption,
  onEditOption,
  onRemoveOption,
  onRemoveCard,
  onFindOptions,
  searchingCardId,
}: {
  trip: Trip;
  schedule: Schedule;
  placed: readonly PlacedCard[];
  selectedCardId: string | undefined;
  onChooseOption: (cardId: string, optionId: string) => void;
  onChangeState: (cardId: string, state: PlanningState) => void;
  onChangeRanking: (preset: RankingPreset) => void;
  onMoveCardToDay: (cardId: string, dayOffset: number) => void;
  onAddOption: (cardId: string) => void;
  onEditOption: (cardId: string, optionId: string) => void;
  onRemoveOption: (cardId: string, optionId: string) => void;
  onRemoveCard: (cardId: string) => void;
  /** Absent in the browser build, where nothing can run a search. */
  onFindOptions?: (cardId: string) => void;
  searchingCardId?: string | null;
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

        <DayPicker trip={trip} schedule={schedule} placed={placed} card={card} onMove={onMoveCardToDay} />

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
            This is booked, so nothing here will change it — but the numbers are still what each
            alternative would have done, so you can see what you committed to.
          </p>
        ) : null}

        <div className="weigh">
          <span className="weigh__label">Weigh these for</span>
          <span className="weigh__set" role="group" aria-label="What to weigh options for">
            {PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                className="pill"
                aria-pressed={trip.preferences.ranking === preset.id}
                title={preset.hint}
                onClick={() => onChangeRanking(preset.id)}
              >
                {preset.label}
              </button>
            ))}
          </span>
        </div>
        <p className="panel__note">{groundTimeBasis(trip)}</p>

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
          {onFindOptions && card.kind !== 'note' ? (
            <button
              type="button"
              className="btn"
              disabled={searchingCardId !== null || card.state === 'booked'}
              title={
                card.state === 'booked'
                  ? 'Unlock this booking first'
                  : 'Claude searches the live web and brings back candidates with source links'
              }
              onClick={() => onFindOptions(card.id)}
            >
              {searchingCardId === card.id
                ? 'Searching the web… this can take a few minutes'
                : 'Find options with Claude'}
            </button>
          ) : null}
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
        {option.source === 'discovered' ? <span className="opt__badge">found</span> : null}
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

      {/* What the source would not stand behind. A found price is often a "from" figure for other
          dates, and the search says so — showing the number without the caveat would turn a
          rough indication into a quote. */}
      {sourceCaveat(option) ? (
        <span className="opt__warn" data-kind="source">
          <span aria-hidden="true">▲</span>
          <span>{sourceCaveat(option)}</span>
        </span>
      ) : null}
    </button>

      {/* Sibling buttons rather than nested ones: a button inside a button is invalid markup and
          breaks keyboard navigation. */}
      {canEdit || canRemove || option.sourceUrl ? (
        <div className="opt__tools">
          {option.sourceUrl ? (
            // Somewhere to go back to. Carried, never re-fetched — the shell routes it to the
            // real browser.
            <a className="link" href={option.sourceUrl} target="_blank" rel="noreferrer">
              Source
            </a>
          ) : null}
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
 * What a found option's source would not vouch for.
 *
 * Searches routinely come back with a real property at a real link whose price is a "starting from"
 * figure for dates other than the ones asked about — and they say so. A low confidence with nothing
 * written down still earns a line: the number is worth a second look either way.
 */
function sourceCaveat(option: Option): string | null {
  const warnings = option.attributes?.['warnings'];
  if (typeof warnings === 'string' && warnings !== '') return warnings;
  return option.attributes?.['confidence'] === 'low' ? 'Worth checking — read with low confidence.' : null;
}

/**
 * Which day of a stay a card sits on.
 *
 * Added because there was nowhere to say it: an activity dropped onto the segment landed on day one
 * whatever you meant, which put a 09:30 tour on the morning of an 08:45 landing. It doubles as the
 * way out for an orphan — a card stranded past the end of a shortened stay can be put back on a day
 * that still exists, rather than only deleted.
 */
function DayPicker({
  trip,
  schedule,
  placed,
  card,
  onMove,
}: {
  trip: Trip;
  schedule: Schedule;
  placed: readonly PlacedCard[];
  card: Card;
  onMove: (cardId: string, dayOffset: number) => void;
}) {
  const anchor = card.anchor;
  if (anchor.kind !== 'segment-day') return null;

  const scheduled = schedule.segments.find((s) => s.segmentId === anchor.segmentId);
  if (!scheduled || scheduled.nights === 0) return null;

  const orphaned = placed.find((p) => p.card.id === card.id)?.orphaned === true;
  const place = trip.segments.find((s) => s.id === anchor.segmentId)?.location.name ?? 'this stop';
  const current = anchor.dayOffset;

  return (
    <div className="field field--inline">
      <label className="label" htmlFor="card-day">
        Which day in {place}
      </label>
      <select
        id="card-day"
        className="select"
        value={Math.min(current, scheduled.nights - 1)}
        onChange={(e) => onMove(card.id, Number(e.target.value))}
      >
        {Array.from({ length: scheduled.nights }, (_, offset) => (
          <option key={offset} value={offset}>
            Day {offset + 1}
            {scheduled.startDate ? ` · ${shortDate(addDays(scheduled.startDate, offset))}` : ''}
          </option>
        ))}
      </select>
      {orphaned ? (
        <div className="field__hint">
          This was planned for day {current + 1}, and the stay is now only {scheduled.nights} day
          {scheduled.nights === 1 ? '' : 's'} long. Pick a day it can actually happen on.
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
 * would be quietly wrong. Naming the stop is not enough either: "Shifts Amsterdam" was the only
 * warning on an option that took a stay from the four nights the traveller asked for down to three,
 * and they only found that out after committing. Say what it costs, before.
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

  for (const shift of scheduleShift) {
    const segment = trip.segments.find((seg) => seg.id === shift.segmentId);
    const name = segment?.location.name ?? shift.segmentId;
    const change = shift.toNights - shift.fromNights;

    if (change === 0) {
      parts.push(`${name} moves`);
      continue;
    }

    const wanted = segment?.duration.ideal;
    const shortOfWish =
      wanted !== undefined && shift.toNights < wanted ? `, ${wanted - shift.toNights} short of the ${wanted} you want` : '';
    parts.push(
      `${name} ${change > 0 ? 'gains' : 'drops to'} ${change > 0 ? `${change} night${change === 1 ? '' : 's'}` : `${shift.toNights} night${shift.toNights === 1 ? '' : 's'}`}${shortOfWish}`,
    );
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
