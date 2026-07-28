import type { Card, CardKind, Option, OptionTiming } from '@odysseus/domain';
import type { DraftPatch } from '@odysseus/extraction';
import type { ReactNode } from 'react';
import { useState } from 'react';

/**
 * Entering something you found yourself.
 *
 * Until a provider is wired up this is the only way anything gets into a trip, so it has to be
 * quick and it has to accept partial knowledge. You may have a hotel name and a nightly rate and
 * nothing else; that is enough to compare it against the rest of the trip. Times are optional
 * everywhere, and everything can be edited later.
 */

export interface CardDraft {
  readonly kind: CardKind;
  readonly title: string;
  readonly detail: string;
  readonly amount: string;
  readonly perNight: boolean;
  /** The figure typed is one traveller's share. Converted to a whole-party cost on save. */
  readonly perTraveler: boolean;
  readonly departDate: string;
  readonly departTime: string;
  readonly arriveTime: string;
  readonly overnight: boolean;
  readonly durationMinutes: string;
  readonly startTime: string;
  readonly endTime: string;
  readonly sourceUrl: string;
  /** Which day of the stay, when the card is being attached to one. Relative, so reflow is safe. */
  readonly dayOffset: string;
}

/**
 * Smart paste fills this form in, and it lives in another package that cannot import this one.
 * The two shapes therefore have to agree by hand — so make the compiler check it. Let a field's
 * type drift apart from its counterpart and this stops building.
 */
type Assert<T extends true> = T;
type _PatchFitsDraft = Assert<Partial<DraftPatch> extends Partial<CardDraft> ? true : false>;

const JOURNEY_KINDS: readonly CardKind[] = ['flight', 'transport'];
const SLOT_KINDS: readonly CardKind[] = ['activity', 'dining'];

const KIND_LABEL: Record<CardKind, string> = {
  flight: 'Flight',
  transport: 'Train, bus, or transfer',
  lodging: 'Somewhere to stay',
  activity: 'Something to do',
  dining: 'Somewhere to eat',
  note: 'Note',
};

export function emptyDraft(kind: CardKind): CardDraft {
  return {
    kind,
    title: '',
    detail: '',
    amount: '',
    perNight: kind === 'lodging',
    perTraveler: false,
    departDate: '',
    departTime: '',
    arriveTime: '',
    overnight: false,
    durationMinutes: '',
    startTime: '',
    endTime: '',
    sourceUrl: '',
    dayOffset: '0',
  };
}

export function draftFromOption(card: Card, option: Option): CardDraft {
  const base = emptyDraft(card.kind);
  const timing = option.timing;
  return {
    ...base,
    title: option.title,
    detail: option.detail ?? '',
    sourceUrl: option.sourceUrl ?? '',
    amount: String(option.cost.amount),
    perNight: option.cost.kind === 'per-night',
    perTraveler: false,
    ...(timing?.kind === 'journey'
      ? {
          departDate: timing.departDate,
          departTime: timing.departTime,
          arriveTime: timing.arriveTime,
          overnight: timing.nightsInTransit === 1,
          durationMinutes: String(timing.durationMinutes),
        }
      : {}),
    ...(timing?.kind === 'slot' ? { startTime: timing.startTime, endTime: timing.endTime } : {}),
  };
}

function timingFrom(draft: CardDraft): OptionTiming | undefined {
  if (JOURNEY_KINDS.includes(draft.kind)) {
    // A journey only pins the calendar once it has a date. Without one it still shows up as a plan,
    // it just cannot move anything around it yet.
    if (!draft.departDate) return undefined;
    return {
      kind: 'journey',
      departDate: draft.departDate,
      departTime: draft.departTime || '09:00',
      arriveTime: draft.arriveTime || '12:00',
      nightsInTransit: draft.overnight ? 1 : 0,
      durationMinutes: Number(draft.durationMinutes) || 120,
    };
  }
  if (SLOT_KINDS.includes(draft.kind) && draft.startTime) {
    return { kind: 'slot', startTime: draft.startTime, endTime: draft.endTime || draft.startTime };
  }
  return undefined;
}

/**
 * Costs in this model are for the whole party, so a per-traveller price is multiplied here.
 *
 * Flight results quote per-traveller by default. Storing that figure as-is understates the biggest
 * line item in the trip by the size of the party, which is why the form makes the conversion visible
 * rather than doing it silently on the way past.
 */
export function partyAmount(draft: CardDraft, travelers: number): number {
  const each = Math.max(0, Number(draft.amount) || 0);
  return draft.perTraveler ? each * Math.max(1, travelers) : each;
}

export function optionFrom(draft: CardDraft, id: string, travelers: number): Option {
  const timing = timingFrom(draft);
  const detail = draft.detail.trim();
  const sourceUrl = draft.sourceUrl.trim();
  return {
    id,
    source: 'user',
    title: draft.title.trim() || 'Untitled',
    ...(detail ? { detail } : {}),
    ...(sourceUrl ? { sourceUrl } : {}),
    cost: {
      kind: draft.perNight ? 'per-night' : 'fixed',
      amount: partyAmount(draft, travelers),
    },
    ...(timing ? { timing } : {}),
  };
}

export interface DayChoice {
  readonly offset: number;
  readonly label: string;
}

export function CardEditor({
  draft: initial,
  kinds,
  days,
  title,
  submitLabel,
  topSlot,
  busy,
  travelers,
  onSave,
  onCancel,
}: {
  draft: CardDraft;
  /** Kinds valid for where this is being attached. */
  kinds: readonly CardKind[];
  /**
   * Days this can be attached to, when it is going onto a stay rather than a leg. Without it
   * everything silently landed on the first day of the segment, which is how a tour ended up on the
   * morning of the arriving flight.
   */
  days?: readonly DayChoice[];
  title: string;
  submitLabel: string;
  /**
   * Rendered above the first field. Anything that fills the form in for you belongs here — this
   * component stays a form and knows nothing about where a draft came from.
   */
  topSlot?: ReactNode;
  /** Something is about to rewrite these fields, so hold them still until it does. */
  busy?: boolean;
  /** Party size, so a per-traveller price can show what it comes to. */
  travelers: number;
  onSave: (draft: CardDraft) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(initial);
  const set = <K extends keyof CardDraft>(key: K, value: CardDraft[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  const isJourney = JOURNEY_KINDS.includes(draft.kind);
  const isSlot = SLOT_KINDS.includes(draft.kind);
  const isNote = draft.kind === 'note';

  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-label={title}>
      <form
        className="dialog"
        onSubmit={(e) => {
          e.preventDefault();
          onSave(draft);
        }}
      >
        <h2>{title}</h2>
        <p>Whatever you know is enough. You can fill in the rest later.</p>

        {topSlot}

        {/*
          Frozen while a paste is being read, because the fields are about to be rewritten with what
          comes back. Letting someone type into a form that is seconds from being overwritten is a
          good way to lose what they typed. Cancel and the paste box above stay live throughout.
        */}
        <fieldset className="formfields" disabled={busy === true}>
          {kinds.length > 1 ? (
          <div className="field">
            <label className="label" htmlFor="card-kind">
              What is it
            </label>
            <select
              id="card-kind"
              className="select"
              value={draft.kind}
              onChange={(e) => {
                const kind = e.target.value as CardKind;
                setDraft((d) => ({ ...d, kind, perNight: kind === 'lodging' }));
              }}
            >
              {kinds.map((k) => (
                <option key={k} value={k}>
                  {KIND_LABEL[k]}
                </option>
              ))}
            </select>
          </div>
        ) : null}

        {days && days.length > 0 ? (
          <div className="field">
            <label className="label" htmlFor="card-dayoffset">
              Which day
            </label>
            <select
              id="card-dayoffset"
              className="select"
              value={draft.dayOffset}
              onChange={(e) => set('dayOffset', e.target.value)}
            >
              {days.map((day) => (
                <option key={day.offset} value={String(day.offset)}>
                  {day.label}
                </option>
              ))}
            </select>
            <div className="field__hint">You can move it to another day later.</div>
          </div>
        ) : null}

        <div className="field">
          <label className="label" htmlFor="card-title">
            Name
          </label>
          <input
            id="card-title"
            value={draft.title}
            onChange={(e) => set('title', e.target.value)}
            placeholder={
              draft.kind === 'lodging'
                ? 'Hotel Lumière'
                : isJourney
                  ? 'KLM 602'
                  : 'Van Gogh Museum'
            }
            autoFocus
          />
        </div>

        <div className="field">
          <label className="label" htmlFor="card-detail">
            Details
          </label>
          <input
            id="card-detail"
            value={draft.detail}
            onChange={(e) => set('detail', e.target.value)}
            placeholder={
              draft.kind === 'lodging' ? 'Le Marais · 8.7 · free cancellation' : 'ORD → AMS · nonstop'
            }
          />
          <div className="field__hint">Anything worth remembering when you compare it later.</div>
        </div>

        <div className="field">
          <label className="label" htmlFor="card-source">
            Where you found it
          </label>
          <input
            id="card-source"
            type="url"
            value={draft.sourceUrl}
            onChange={(e) => set('sourceUrl', e.target.value)}
            placeholder="https://"
          />
          <div className="field__hint">
            Optional. A link to go back to — the price here will not change on its own.
          </div>
        </div>

        {isNote ? null : (
          <div className="row">
            <div className="field">
              <label className="label" htmlFor="card-amount">
                Price
              </label>
              <input
                id="card-amount"
                type="number"
                min="0"
                step="1"
                value={draft.amount}
                onChange={(e) => set('amount', e.target.value)}
                placeholder="0"
              />
            </div>
            <div className="field">
              <label className="label" htmlFor="card-pernight">
                Charged
              </label>
              <select
                id="card-pernight"
                className="select"
                value={draft.perNight ? 'night' : draft.perTraveler ? 'traveler' : 'once'}
                onChange={(e) => {
                  const how = e.target.value;
                  setDraft((d) => ({
                    ...d,
                    perNight: how === 'night',
                    perTraveler: how === 'traveler',
                  }));
                }}
              >
                <option value="once">In total</option>
                <option value="night">Per night</option>
                <option value="traveler">Per traveller</option>
              </select>
              {draft.perTraveler && travelers > 1 ? (
                // Spelled out rather than converted quietly. This is the number that goes into the
                // budget, and a figure the traveller cannot see is one they cannot correct.
                <div className="field__hint">
                  {`× ${travelers} travellers = ${partyAmount(draft, travelers).toLocaleString()} in total`}
                </div>
              ) : null}
            </div>
          </div>
        )}

        {isJourney ? (
          <>
            <div className="row">
              <div className="field">
                <label className="label" htmlFor="card-depart-date">
                  Date
                </label>
                <input
                  id="card-depart-date"
                  type="date"
                  value={draft.departDate}
                  onChange={(e) => set('departDate', e.target.value)}
                />
              </div>
              <div className="field">
                <label className="label" htmlFor="card-depart-time">
                  Leaves
                </label>
                <input
                  id="card-depart-time"
                  type="time"
                  value={draft.departTime}
                  onChange={(e) => set('departTime', e.target.value)}
                />
              </div>
              <div className="field">
                <label className="label" htmlFor="card-arrive-time">
                  Arrives
                </label>
                <input
                  id="card-arrive-time"
                  type="time"
                  value={draft.arriveTime}
                  onChange={(e) => set('arriveTime', e.target.value)}
                />
              </div>
            </div>
            <div className="row">
              <div className="field">
                <label className="label" htmlFor="card-duration">
                  How long, in minutes
                </label>
                <input
                  id="card-duration"
                  type="number"
                  min="0"
                  value={draft.durationMinutes}
                  onChange={(e) => set('durationMinutes', e.target.value)}
                  placeholder="120"
                />
              </div>
              <div className="field">
                <label className="label" htmlFor="card-overnight">
                  Lands
                </label>
                <select
                  id="card-overnight"
                  className="select"
                  value={draft.overnight ? 'next' : 'same'}
                  onChange={(e) => set('overnight', e.target.value === 'next')}
                >
                  <option value="same">Same day</option>
                  <option value="next">Next morning</option>
                </select>
              </div>
            </div>
            <div className="field__hint" style={{ marginTop: '-6px', marginBottom: '4px' }}>
              Without a date this still sits in your plan, it just will not move anything around it
              yet.
            </div>
          </>
        ) : null}

        {isSlot ? (
          <div className="row">
            <div className="field">
              <label className="label" htmlFor="card-start">
                Starts
              </label>
              <input
                id="card-start"
                type="time"
                value={draft.startTime}
                onChange={(e) => set('startTime', e.target.value)}
              />
            </div>
            <div className="field">
              <label className="label" htmlFor="card-end">
                Ends
              </label>
              <input
                id="card-end"
                type="time"
                value={draft.endTime}
                onChange={(e) => set('endTime', e.target.value)}
              />
            </div>
          </div>
        ) : null}
        </fieldset>

        <div className="actions">
          <button type="button" className="btn" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="submit"
            className="btn btn--primary"
            disabled={draft.title.trim() === '' || busy === true}
          >
            {submitLabel}
          </button>
        </div>
      </form>
    </div>
  );
}
