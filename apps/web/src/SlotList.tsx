import type { Card, CardAnchor, CardKind, Option, Trip, TripSlots } from '@odysseus/domain';
import { kindsForAnchor } from '@odysseus/domain';
import type { ReactNode } from 'react';
import { useState } from 'react';
import type { DayChoice } from './CardEditor.js';
import { optionCost } from './format.js';
import type { SlotSearchRequest } from './slot-search.js';
import { TravelCard } from './TravelCard.js';

/**
 * What the trip is made of, one tab at a time.
 *
 * The panel used to be a viewer for whatever was last clicked, which meant a trip with no cards had
 * no way in at all: every route to adding or searching for an option began by selecting a card that
 * did not exist. These lists are the standing account instead — a leg with nothing on it is a row
 * here, and the row is where the search starts.
 */

export type PanelTab = 'flights' | 'lodging' | 'transport' | 'activities';

export const TABS: readonly { id: PanelTab; label: string }[] = [
  { id: 'flights', label: 'Flights' },
  { id: 'lodging', label: 'Lodging' },
  { id: 'transport', label: 'Transport' },
  { id: 'activities', label: 'Activities' },
];

/**
 * Where a card's detail view lives.
 *
 * A leg appears under both Flights and Transport, because a train fills it as well as a flight
 * does — but one card has one home, or selecting it from the day grid would have no single answer.
 */
export function tabForKind(kind: CardKind): PanelTab {
  switch (kind) {
    case 'flight':
      return 'flights';
    case 'lodging':
      return 'lodging';
    case 'transport':
      return 'transport';
    default:
      return 'activities';
  }
}

/**
 * The kinds the editor offers, the tab's own first.
 *
 * Reordered, never filtered: a connection legally takes a flight or a train, and filtering would
 * make adding a train from the Flights tab impossible rather than merely unlikely.
 */
export function orderedKinds(anchor: CardAnchor, preferred: CardKind): readonly CardKind[] {
  const legal = kindsForAnchor(anchor.kind);
  return legal.includes(preferred) ? [preferred, ...legal.filter((k) => k !== preferred)] : legal;
}

interface Shared {
  trip: Trip;
  conflictedCardIds: ReadonlySet<string>;
  onSelectCard: (id: string) => void;
  onAdd: (anchor: CardAnchor, kinds: readonly CardKind[]) => void;
  onFind: (request: SlotSearchRequest) => void;
  searchingSlotId: string | null;
  canSearch: boolean;
}

function Slot({
  trip,
  title,
  meta,
  emptyText,
  cards,
  anchor,
  kind,
  slotKey,
  addLabel,
  findLabel,
  conflictedCardIds,
  onSelectCard,
  onAdd,
  onFind,
  searchingSlotId,
  canSearch,
  onAddOption,
  children,
}: Shared & {
  title: string;
  meta?: string;
  emptyText: string;
  cards: readonly Card[];
  anchor: CardAnchor;
  kind: CardKind;
  slotKey: string;
  addLabel: string;
  /** Absent where searching this sort of slot is not a thing the app does yet. */
  findLabel?: string;
  /**
   * Present on slot-shaped rows only.
   *
   * A stop group's Add always makes a new card: a museum and a beach day are different things, not
   * rival answers to one question. A leg or a stay is one question, so a second candidate for it
   * belongs on the card already there.
   */
  onAddOption?: (cardId: string) => void;
  /**
   * Rendered inside the slot, after its own tools row.
   *
   * A stop group (local transport, activities) has a per-stop Find button and, for activities, a
   * shortlist beneath it. Both belong to *this* stop, not the next one down, so they need to live
   * inside the same `.slot` element that carries the border rule between stops — a sibling wrapper
   * would put the rule between a stop and its own contents instead, and would stop `.slot:last-child`
   * from ever matching, since the wrapper rather than the `.slot` would be the last child.
   */
  children?: ReactNode;
}) {
  const existing = cards.find((c) => c.kind === kind);
  const busy = searchingSlotId !== null;
  const booked = existing?.state === 'booked';
  const searchKey = existing?.id ?? slotKey;

  return (
    <div className="slot">
      <div className="slot__head">
        <span className="slot__title">{title}</span>
        {meta ? <span className="slot__meta">{meta}</span> : null}
      </div>

      {cards.length === 0 ? (
        <div className="slot__empty">{emptyText}</div>
      ) : (
        <div className="slot__cards">
          {cards.map((card) => (
            <TravelCard
              key={card.id}
              card={card}
              trip={trip}
              // Always false: `OptionsPanel` renders `SlotList` only while no card is selected — a
              // real selection switches it to `CardDetail` instead — so a row here can never be the
              // selected one.
              selected={false}
              conflicted={conflictedCardIds.has(card.id)}
              onSelect={onSelectCard}
            />
          ))}
        </div>
      )}

      <div className="slot__tools">
        {canSearch && findLabel !== undefined ? (
          <button
            type="button"
            className="btn"
            disabled={busy || booked}
            title={
              booked
                ? 'Unlock this booking first'
                : busy && searchingSlotId !== searchKey
                  ? 'Another search is running — one at a time.'
                  : 'Claude searches the live web and brings back candidates with source links'
            }
            onClick={() => onFind({ existing, anchor, kind, slotKey })}
          >
            {searchingSlotId === searchKey ? 'Searching the web…' : findLabel}
          </button>
        ) : null}
        {existing && onAddOption ? (
          <button type="button" className="btn" onClick={() => onAddOption(existing.id)}>
            + Add another option
          </button>
        ) : (
          <button
            type="button"
            className="btn"
            onClick={() => onAdd(anchor, orderedKinds(anchor, kind))}
          >
            {addLabel}
          </button>
        )}
      </div>
      {children}
    </div>
  );
}

/**
 * One thing a search turned up, not yet on the trip.
 *
 * The day picker has no default and adding is blocked until it is answered. An activity quietly
 * landing on day one is the bug that put a 09:30 tour on the morning of an 08:45 landing, and this
 * is exactly the path that would reintroduce it.
 */
function CandidateRow({
  candidate,
  trip,
  days,
  onAdd,
  onDismiss,
}: {
  candidate: Option;
  trip: Trip;
  days: readonly DayChoice[];
  onAdd: (dayOffset: number) => void;
  onDismiss: () => void;
}) {
  const [day, setDay] = useState('');

  return (
    <div className="cand">
      <div className="cand__top">
        <span className="cand__title">{candidate.title}</span>
        <span className="cand__cost">{optionCost(candidate, trip.currency)}</span>
      </div>
      {candidate.detail ? <div className="cand__detail">{candidate.detail}</div> : null}
      <div className="cand__tools">
        <select
          className="select"
          value={day}
          aria-label={`Which day for ${candidate.title}`}
          onChange={(e) => setDay(e.target.value)}
        >
          <option value="">Which day?</option>
          {days.map((d) => (
            <option key={d.offset} value={String(d.offset)}>
              {d.label}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="btn"
          disabled={day === ''}
          onClick={() => onAdd(Number(day))}
        >
          Add to trip
        </button>
        {candidate.sourceUrl ? (
          <a className="link" href={candidate.sourceUrl} target="_blank" rel="noreferrer">
            Source
          </a>
        ) : null}
        <button type="button" className="link" onClick={onDismiss}>
          Dismiss
        </button>
      </div>
    </div>
  );
}

export function SlotList({
  slots,
  tab,
  onAddOption,
  shortlists,
  daysOfSegment,
  onAcceptCandidate,
  onDismissCandidate,
  onFindThingsToDo,
  ...shared
}: Shared & {
  slots: TripSlots;
  tab: PanelTab;
  /**
   * Kept out of `Shared` deliberately: `Shared` is spread onto every `Slot`, including the
   * stop-group rows (local transport, activities) whose Add must keep making new cards — a museum
   * and a beach day are different things, not rival answers to one question. Destructured here
   * alongside `slots` and `tab` so it never reaches `shared`, and so it can be passed only to the
   * connection and stay rows below.
   */
  onAddOption: (cardId: string) => void;
  /** Found things to do, by segment id. Session state — never written to the trip. */
  shortlists: Readonly<Record<string, readonly Option[]>>;
  daysOfSegment: (segmentId: string) => readonly DayChoice[];
  onAcceptCandidate: (segmentId: string, candidate: Option, dayOffset: number) => void;
  onDismissCandidate: (segmentId: string, candidate: Option) => void;
  onFindThingsToDo: (segmentId: string) => void;
}) {
  const leg = (from: string | null, to: string | null) => `${from ?? 'Home'} → ${to ?? 'Home'}`;

  if (tab === 'flights' || tab === 'transport') {
    const kind: CardKind = tab === 'flights' ? 'flight' : 'transport';
    if (slots.connections.length === 0) {
      return <p className="panel__note">Add a stop and the legs to it appear here.</p>;
    }
    return (
      <>
        {slots.connections.map((slot) => (
          <Slot
            key={slot.id}
            {...shared}
            title={leg(slot.fromName, slot.toName)}
            emptyText="Nothing gets you there yet."
            cards={slot.cards}
            anchor={{ kind: 'connection', connectionId: slot.connectionId }}
            kind={kind}
            slotKey={`${slot.id}:${kind}`}
            addLabel="+ Add one you found"
            findLabel={
              tab === 'flights' ? 'Find flights with Claude' : 'Find a way there with Claude'
            }
            onAddOption={onAddOption}
          />
        ))}
        {tab === 'transport'
          ? slots.localTransport.map((stop) => (
              <Slot
                key={`local-${stop.id}`}
                {...shared}
                title={`Getting around ${stop.placeName}`}
                emptyText="Nothing added."
                cards={stop.cards}
                anchor={{ kind: 'segment-day', segmentId: stop.segmentId, dayOffset: 0 }}
                kind="transport"
                slotKey={`local:${stop.segmentId}`}
                addLabel="+ Add local transport"
              />
            ))
          : null}
      </>
    );
  }

  if (tab === 'lodging') {
    if (slots.stays.length === 0) {
      return <p className="panel__note">Add a stop and its nights appear here.</p>;
    }
    return (
      <>
        {slots.stays.map((slot) => (
          <Slot
            key={slot.id}
            {...shared}
            title={slot.placeName}
            meta={`${slot.nights} night${slot.nights === 1 ? '' : 's'}`}
            emptyText="Nowhere to stay yet."
            cards={slot.card ? [slot.card] : []}
            anchor={slot.card ? slot.card.anchor : { kind: 'segment', segmentId: slot.segmentId }}
            kind="lodging"
            slotKey={slot.id}
            addLabel="+ Add one you found"
            findLabel="Find places to stay with Claude"
            onAddOption={onAddOption}
          />
        ))}
      </>
    );
  }

  if (slots.activities.length === 0) {
    return <p className="panel__note">Add a stop and it appears here.</p>;
  }
  return (
    <>
      {slots.activities.map((stop) => {
        const shortlist = shortlists[stop.segmentId] ?? [];
        const busy = shared.searchingSlotId !== null;
        const searchKey = `activities:${stop.segmentId}`;
        return (
          <Slot
            key={stop.id}
            {...shared}
            title={stop.placeName}
            emptyText="Nothing planned here yet."
            cards={stop.cards}
            anchor={{ kind: 'segment-day', segmentId: stop.segmentId, dayOffset: 0 }}
            kind="activity"
            slotKey={searchKey}
            addLabel="+ Add something to do"
          >
            {shared.canSearch ? (
              <div className="slot__tools">
                <button
                  type="button"
                  className="btn"
                  disabled={busy}
                  // No booked branch here, unlike the slot-shaped Find button above: a stop group has
                  // no single card whose state could be booked. Just running-elsewhere or idle.
                  title={
                    busy && shared.searchingSlotId !== searchKey
                      ? 'Another search is running — one at a time.'
                      : 'Claude searches the live web and brings back candidates with source links'
                  }
                  onClick={() => onFindThingsToDo(stop.segmentId)}
                >
                  {shared.searchingSlotId === searchKey
                    ? 'Searching the web…'
                    : `Find things to do in ${stop.placeName}`}
                </button>
              </div>
            ) : null}
            {shortlist.length > 0 ? (
              <>
                <p className="panel__note">
                  Found for {stop.placeName}. None of it is on your trip until you pick a day, and
                  none of it survives a reload.
                </p>
                {shortlist.map((candidate) => (
                  <CandidateRow
                    key={candidate.id}
                    candidate={candidate}
                    trip={shared.trip}
                    days={daysOfSegment(stop.segmentId)}
                    onAdd={(dayOffset) => onAcceptCandidate(stop.segmentId, candidate, dayOffset)}
                    onDismiss={() => onDismissCandidate(stop.segmentId, candidate)}
                  />
                ))}
              </>
            ) : null}
          </Slot>
        );
      })}
    </>
  );
}
