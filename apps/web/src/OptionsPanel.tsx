import type {
  Card,
  CardAnchor,
  CardKind,
  PlacedCard,
  PlanningState,
  RankingPreset,
  Schedule,
  Trip,
  TripSlots,
} from '@odysseus/domain';
import { CardDetail } from './CardDetail.js';
import type { PanelTab } from './SlotList.js';
import { SlotList, TABS } from './SlotList.js';
import type { SlotSearchRequest } from './slot-search.js';

/**
 * The primary surface of the workspace.
 *
 * Always present and always tabbed. It used to show one line telling the traveller to pick
 * something, on trips where there was nothing to pick.
 */
export function OptionsPanel({
  trip,
  slots,
  tab,
  onChangeTab,
  selectedCardId,
  conflictedCardIds,
  onSelectCard,
  onAddToSlot,
  onFindForSlot,
  canSearch,
  ...detail
}: {
  trip: Trip;
  schedule: Schedule;
  placed: readonly PlacedCard[];
  slots: TripSlots;
  tab: PanelTab;
  onChangeTab: (tab: PanelTab) => void;
  selectedCardId: string | undefined;
  conflictedCardIds: ReadonlySet<string>;
  onSelectCard: (id: string) => void;
  onAddToSlot: (anchor: CardAnchor, kinds: readonly CardKind[]) => void;
  onFindForSlot: (request: SlotSearchRequest) => void;
  canSearch: boolean;
  onBack: () => void;
  onChooseOption: (cardId: string, optionId: string) => void;
  onChangeState: (cardId: string, state: PlanningState) => void;
  onChangeRanking: (preset: RankingPreset) => void;
  onMoveCardToDay: (cardId: string, dayOffset: number) => void;
  onAddOption: (cardId: string) => void;
  onEditOption: (cardId: string, optionId: string) => void;
  onRemoveOption: (cardId: string, optionId: string) => void;
  onRemoveCard: (cardId: string) => void;
  onFindOptions?: (card: Card) => void;
  searchingSlotId: string | null;
}) {
  const card = trip.cards.find((c) => c.id === selectedCardId);

  return (
    <aside className="panel">
      <div className="panel__tabs" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            className="panel__tab"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => onChangeTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {card ? (
        <CardDetail trip={trip} card={card} {...detail} />
      ) : (
        <div className="panel__scroll">
          <SlotList
            trip={trip}
            slots={slots}
            tab={tab}
            selectedCardId={selectedCardId}
            conflictedCardIds={conflictedCardIds}
            onSelectCard={onSelectCard}
            onAdd={onAddToSlot}
            onFind={onFindForSlot}
            searchingSlotId={detail.searchingSlotId}
            canSearch={canSearch}
            onAddOption={detail.onAddOption}
          />
        </div>
      )}
    </aside>
  );
}
