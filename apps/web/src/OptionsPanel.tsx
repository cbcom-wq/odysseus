import type {
  Card,
  PlacedCard,
  PlanningState,
  RankingPreset,
  Schedule,
  Trip,
} from '@odysseus/domain';
import { CardDetail } from './CardDetail.js';

/** The primary surface of the workspace. */
export function OptionsPanel({
  trip,
  selectedCardId,
  ...detail
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
  onFindOptions?: (card: Card) => void;
  searchingSlotId: string | null;
}) {
  const card = trip.cards.find((c) => c.id === selectedCardId);

  return (
    <aside className="panel">
      {card ? (
        <CardDetail trip={trip} card={card} {...detail} />
      ) : (
        <div className="panel__empty">
          Pick anything in the trip to see what else it could be, and what each choice would do to
          the days around it.
        </div>
      )}
    </aside>
  );
}
