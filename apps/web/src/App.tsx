import type { Card, CardAnchor, CardKind, PlanningState, Trip } from '@odysseus/domain';
import {
  addCard,
  addDays,
  addOption,
  addSegment,
  computeBudget,
  detectCompatibilityConflicts,
  kindsForAnchor,
  moveSegment,
  nextCardId,
  nextOptionId,
  placeCards,
  removeCard,
  removeOption,
  removeSegment,
  schedule as runSchedule,
  selectOption,
  transitionCard,
  updateOption,
} from '@odysseus/domain';
import { useEffect, useMemo, useState } from 'react';
import type { CardDraft } from './CardEditor.js';
import { CardEditor, draftFromOption, emptyDraft, optionFrom } from './CardEditor.js';
import { CreateTripDialog } from './CreateTripDialog.js';
import { DayView } from './DayView.js';
import { OptionsPanel } from './OptionsPanel.js';
import { SaveStatus } from './SaveStatus.js';
import { StructureView } from './StructureView.js';
import { dateRange, money, tripSubtitle } from './format.js';
import { useTripStore } from './useTripStore.js';

type View = 'structure' | 'days';
type Store = ReturnType<typeof useTripStore>;

type Editor =
  | { mode: 'new-card'; anchor: CardAnchor; kinds: readonly CardKind[] }
  | { mode: 'new-option'; cardId: string }
  | { mode: 'edit-option'; cardId: string; optionId: string };

/** Loads trips, then hands one to the workspace. Keeps the loading path out of the planning UI. */
export function App() {
  const store = useTripStore();
  const [activeId, setActiveId] = useState<string | undefined>();

  // Settle on a trip once they have loaded, and again if the open one is deleted.
  useEffect(() => {
    if (store.trips.length === 0) return;
    if (activeId === undefined || !store.trips.some((t) => t.id === activeId)) {
      setActiveId(store.trips[0]!.id);
    }
  }, [store.trips, activeId]);

  const trip = store.trips.find((t) => t.id === activeId);

  if (!trip) {
    return (
      <div className="booting">
        {store.saveState === 'loading'
          ? 'Opening your trips…'
          : (store.error ?? 'No trips yet. Reload to start a new one.')}
      </div>
    );
  }

  return <Workspace key={trip.id} store={store} trip={trip} onOpenTrip={setActiveId} />;
}

function Workspace({
  store,
  trip,
  onOpenTrip,
}: {
  store: Store;
  trip: Trip;
  onOpenTrip: (id: string) => void;
}) {
  const { trips, saveTrip: update, deleteTrip } = store;

  const [view, setView] = useState<View>('days');
  const [selectedCardId, setSelectedCardId] = useState<string | undefined>();
  const [creating, setCreating] = useState(false);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  /** Apply an edit that may invalidate cards, and say so rather than letting them vanish. */
  const applyEdit = (result: { trip: Trip; removedCardIds: readonly string[] }, why: string) => {
    update(result.trip);
    if (result.removedCardIds.length > 0) {
      const n = result.removedCardIds.length;
      setNotice(
        `${why} ${n} card${n === 1 ? '' : 's'} no longer applied, so ${n === 1 ? 'it was' : 'they were'} removed.`,
      );
      if (result.removedCardIds.includes(selectedCardId ?? '')) setSelectedCardId(undefined);
    }
  };

  // Everything below is derived. No planning state is stored twice, so the two views cannot
  // disagree and the budget cannot go stale.
  const { schedule, budget, placed, conflicts } = useMemo(() => {
    const schedule = runSchedule(trip);
    return {
      schedule,
      budget: computeBudget(trip, schedule),
      placed: placeCards(trip, schedule),
      conflicts: [...schedule.conflicts, ...detectCompatibilityConflicts(trip, schedule)],
    };
  }, [trip]);

  const conflictedCardIds = useMemo(() => new Set(conflicts.flatMap((c) => c.cardIds)), [conflicts]);
  const conflictedSegmentIds = useMemo(
    () => new Set(conflicts.flatMap((c) => c.segmentIds)),
    [conflicts],
  );

  const chooseOption = (cardId: string, optionId: string) => {
    const card = trip.cards.find((c) => c.id === cardId);
    if (!card) return;
    const result = selectOption(card, optionId);
    if (!result.ok) return setNotice(result.reason);
    update({ ...trip, cards: trip.cards.map((c) => (c.id === cardId ? result.card : c)) });
  };

  const changeState = (cardId: string, state: PlanningState) => {
    const card = trip.cards.find((c) => c.id === cardId);
    if (!card) return;
    const result = transitionCard(card, state);
    if (!result.ok) return setNotice(result.reason);
    update({ ...trip, cards: trip.cards.map((c) => (c.id === cardId ? result.card : c)) });
  };

  /**
   * Pulling a duration control changes how long you *want* to stay, not the range itself.
   *
   * Collapsing the range would destroy the flexibility the traveller authored, and it would be a
   * lie: how long you actually get somewhere is decided by the legs either side of it. Record the
   * wish and let the schedule show what it can give.
   */
  const changeDuration = (segmentId: string, nights: number) => {
    update({
      ...trip,
      segments: trip.segments.map((s) =>
        s.id === segmentId ? { ...s, duration: { ...s.duration, ideal: nights } } : s,
      ),
    });
  };

  const saveFromEditor = (draft: CardDraft) => {
    if (!editor) return;

    if (editor.mode === 'new-card') {
      const cardId = nextCardId(trip);
      const option = optionFrom(draft, `${cardId}-opt-1`);
      const card: Card = {
        id: cardId,
        kind: draft.kind,
        state: 'exploring',
        anchor: editor.anchor,
        options: [option],
        selectedOptionId: option.id,
      };
      update(addCard(trip, card));
      setSelectedCardId(cardId);
    } else if (editor.mode === 'new-option') {
      const card = trip.cards.find((c) => c.id === editor.cardId);
      if (card) update(addOption(trip, card.id, optionFrom(draft, nextOptionId(card))));
    } else {
      update(updateOption(trip, editor.cardId, optionFrom(draft, editor.optionId)));
    }
    setEditor(null);
  };

  const editorProps = () => {
    if (!editor) return null;
    if (editor.mode === 'new-card') {
      return {
        draft: emptyDraft(editor.kinds[0]!),
        kinds: editor.kinds,
        title: 'Add to your trip',
        submitLabel: 'Add it',
      };
    }
    const card = trip.cards.find((c) => c.id === editor.cardId);
    if (!card) return null;
    if (editor.mode === 'new-option') {
      return {
        draft: emptyDraft(card.kind),
        kinds: [card.kind],
        title: 'Add another option',
        submitLabel: 'Add it',
      };
    }
    const option = card.options.find((o) => o.id === editor.optionId);
    if (!option) return null;
    return {
      draft: draftFromOption(card, option),
      kinds: [card.kind],
      title: `Edit ${option.title}`,
      submitLabel: 'Save changes',
    };
  };

  const startTrip = (created: Trip) => {
    update(created);
    onOpenTrip(created.id);
    setCreating(false);
  };

  const dates =
    schedule.startDate !== undefined
      ? dateRange(schedule.startDate, addDays(schedule.startDate, schedule.totalNights))
      : 'Dates not set';

  const editing = editorProps();

  return (
    <div className="app">
      <nav className="rail">
        <div className="rail__brand">
          <strong>Odysseus</strong>
          <span>Workspace</span>
        </div>

        <div className="rail__group">Plan</div>
        <button
          type="button"
          className="rail__item"
          aria-current={view === 'structure'}
          onClick={() => setView('structure')}
        >
          Structure
        </button>
        <button
          type="button"
          className="rail__item"
          aria-current={view === 'days'}
          onClick={() => setView('days')}
        >
          Days
        </button>

        <div className="rail__group">Trips</div>
        {trips.map((t) => (
          <button
            key={t.id}
            type="button"
            className="rail__item"
            aria-current={t.id === trip.id}
            onClick={() => onOpenTrip(t.id)}
          >
            {t.name}
          </button>
        ))}
        <button type="button" className="rail__item rail__item--add" onClick={() => setCreating(true)}>
          + Start a trip
        </button>

        <div className="rail__group">Later</div>
        <button type="button" className="rail__item" disabled>
          Map
        </button>
        <button type="button" className="rail__item" disabled>
          Documents
        </button>
        <button type="button" className="rail__item" disabled>
          Collections
        </button>

        <div className="rail__foot">
          <SaveStatus state={store.saveState} savedAt={store.savedAt} ephemeral={store.ephemeral} />
        </div>
      </nav>

      <main className="main">
        <header className="head">
          <div className="head__top">
            <div>
              <h1 className="head__title">{trip.name}</h1>
              <p className="head__sub">
                <span className="num">{dates}</span> ·{' '}
                {tripSubtitle(trip, schedule.totalNights, schedule.totalDays)}
              </p>
            </div>

            <div className="stats">
              <div className="stat">
                <span className="stat__value">{money(budget.total, trip.currency)}</span>
                <span className="stat__label">Trip total</span>
              </div>
              <div className="stat">
                <span className="stat__value">
                  {money(budget.total / Math.max(schedule.totalDays, 1), trip.currency)}
                </span>
                <span className="stat__label">Per day</span>
              </div>
              <div className="stat">
                <span className="stat__value">{schedule.totalNights}</span>
                <span className="stat__label">Nights</span>
              </div>
            </div>
          </div>

          <div className="tabs" role="tablist">
            <button
              type="button"
              className="tab"
              role="tab"
              aria-selected={view === 'structure'}
              onClick={() => setView('structure')}
            >
              Structure
            </button>
            <button
              type="button"
              className="tab"
              role="tab"
              aria-selected={view === 'days'}
              onClick={() => setView('days')}
            >
              Days
            </button>
            <button
              type="button"
              className="tab tab--danger"
              onClick={() => {
                if (window.confirm(`Delete ${trip.name}? This cannot be undone.`)) {
                  deleteTrip(trip.id);
                }
              }}
            >
              Delete trip
            </button>
          </div>
        </header>

        <div className="scroll">
          {store.problems.length > 0 ? (
            <div className="notice notice--warn">
              <span>
                {store.problems.length} saved trip{store.problems.length === 1 ? '' : 's'} could not
                be opened: {store.problems.map((p) => `${p.id} — ${p.reason}`).join('; ')}
              </span>
              <button
                type="button"
                className="notice__close"
                onClick={store.dismissProblems}
                aria-label="Dismiss"
              >
                ✕
              </button>
            </div>
          ) : null}

          {store.saveState === 'error' && store.error ? (
            <div className="notice notice--warn">
              <span>{store.error}</span>
            </div>
          ) : null}

          {notice ? (
            <div className="notice">
              <span>{notice}</span>
              <button
                type="button"
                className="notice__close"
                onClick={() => setNotice(null)}
                aria-label="Dismiss"
              >
                ✕
              </button>
            </div>
          ) : null}

          {conflicts.length > 0 ? (
            <div className="conflicts">
              {conflicts.map((conflict, i) => (
                <div
                  key={`${conflict.code}-${i}`}
                  className="conflict"
                  data-severity={conflict.severity}
                >
                  <span className="conflict__code">{conflict.code.replace(/_/g, ' ')}</span>
                  <span>{conflict.message}</span>
                </div>
              ))}
            </div>
          ) : null}

          {trip.segments.length === 0 ? (
            <div className="blank">
              <p>Nowhere to go yet.</p>
              <button
                type="button"
                className="btn btn--primary"
                onClick={() => {
                  const name = window.prompt('Where to?');
                  if (name?.trim()) applyEdit(addSegment(trip, name.trim()), 'Added a stop.');
                }}
              >
                Add the first stop
              </button>
            </div>
          ) : view === 'days' ? (
            <DayView
              trip={trip}
              schedule={schedule}
              budget={budget}
              placed={placed}
              selectedCardId={selectedCardId}
              conflictedCardIds={conflictedCardIds}
              onSelectCard={setSelectedCardId}
              onAdd={(anchor) =>
                setEditor({ mode: 'new-card', anchor, kinds: kindsForAnchor(anchor.kind) })
              }
            />
          ) : (
            <StructureView
              trip={trip}
              schedule={schedule}
              budget={budget}
              placed={placed}
              selectedCardId={selectedCardId}
              conflictedCardIds={conflictedCardIds}
              conflictedSegmentIds={conflictedSegmentIds}
              onSelectCard={setSelectedCardId}
              onChangeDuration={changeDuration}
              onAdd={(anchor, kinds) => setEditor({ mode: 'new-card', anchor, kinds })}
              onAddStop={(name, at) => applyEdit(addSegment(trip, name, at), 'Added a stop.')}
              onRemoveStop={(id) => applyEdit(removeSegment(trip, id), 'Removed a stop.')}
              onMoveStop={(id, delta) =>
                applyEdit(moveSegment(trip, id, delta), 'Reordered your stops.')
              }
            />
          )}
        </div>
      </main>

      <OptionsPanel
        trip={trip}
        schedule={schedule}
        selectedCardId={selectedCardId}
        onChooseOption={chooseOption}
        onChangeState={changeState}
        onAddOption={(cardId) => setEditor({ mode: 'new-option', cardId })}
        onEditOption={(cardId, optionId) => setEditor({ mode: 'edit-option', cardId, optionId })}
        onRemoveOption={(cardId, optionId) => update(removeOption(trip, cardId, optionId))}
        onRemoveCard={(cardId) => {
          update(removeCard(trip, cardId));
          setSelectedCardId(undefined);
        }}
      />

      {creating ? (
        <CreateTripDialog onCreate={startTrip} onCancel={() => setCreating(false)} />
      ) : null}

      {editing ? (
        <CardEditor
          draft={editing.draft}
          kinds={editing.kinds}
          title={editing.title}
          submitLabel={editing.submitLabel}
          onSave={saveFromEditor}
          onCancel={() => setEditor(null)}
        />
      ) : null}
    </div>
  );
}
