import type { Card, CardAnchor, CardKind, Trip, TripSlots } from '@odysseus/domain';
import { kindsForAnchor } from '@odysseus/domain';
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
function orderedKinds(anchor: CardAnchor, preferred: CardKind): readonly CardKind[] {
  const legal = kindsForAnchor(anchor.kind);
  return legal.includes(preferred) ? [preferred, ...legal.filter((k) => k !== preferred)] : legal;
}

interface Shared {
  trip: Trip;
  selectedCardId: string | undefined;
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
  selectedCardId,
  conflictedCardIds,
  onSelectCard,
  onAdd,
  onFind,
  searchingSlotId,
  canSearch,
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
              selected={card.id === selectedCardId}
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
        <button
          type="button"
          className="btn"
          onClick={() => onAdd(anchor, orderedKinds(anchor, kind))}
        >
          {addLabel}
        </button>
      </div>
    </div>
  );
}

export function SlotList({ slots, tab, ...shared }: Shared & { slots: TripSlots; tab: PanelTab }) {
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
      {slots.activities.map((stop) => (
        <Slot
          key={stop.id}
          {...shared}
          title={stop.placeName}
          emptyText="Nothing planned here yet."
          cards={stop.cards}
          anchor={{ kind: 'segment-day', segmentId: stop.segmentId, dayOffset: 0 }}
          kind="activity"
          slotKey={`activities:${stop.segmentId}`}
          addLabel="+ Add something to do"
        />
      ))}
    </>
  );
}
