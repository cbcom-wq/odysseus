import { PRODUCT_NAME, SURFACE_NAME } from '@odysseus/brand';
import type {
  Card,
  CardAnchor,
  CardKind,
  PlanningState,
  RankingPreset,
  Trip,
} from '@odysseus/domain';
import {
  addCard,
  addDays,
  addOption,
  addSegment,
  computeBudget,
  detectCompatibilityConflicts,
  fareGroupPartners,
  kindsForAnchor,
  moveCardToDay,
  moveSegment,
  nextCardId,
  nextOptionId,
  placeCards,
  removeCard,
  removeOption,
  removeSegment,
  schedule as runSchedule,
  selectOptionInTrip,
  splitStay,
  transitionCardInTrip,
  tripSlots,
  updateOption,
} from '@odysseus/domain';
import type { ExtractedFields } from '@odysseus/extraction';
import { describeExtractionError, toDraftPatch } from '@odysseus/extraction';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { CardDraft, DayChoice } from './CardEditor.js';
import { CardEditor, draftFromOption, emptyDraft, optionFrom } from './CardEditor.js';
import { CreateTripDialog } from './CreateTripDialog.js';
import { DayView } from './DayView.js';
import { OptionsPanel } from './OptionsPanel.js';
import { PasteImportBox } from './PasteImportBox.js';
import { SaveStatus } from './SaveStatus.js';
import { SettingsDialog } from './SettingsDialog.js';
import type { PanelTab } from './SlotList.js';
import { tabForKind } from './SlotList.js';
import { StructureView } from './StructureView.js';
import { dateRange, money, shortDate, tripSubtitle } from './format.js';
import type { LinkedImport } from './import-fares.js';
import { linkImportedFares } from './import-fares.js';
import type { SlotSearchRequest } from './slot-search.js';
import { landSearchResults, slotSearchTarget } from './slot-search.js';
import { useDiscovery } from './useDiscovery.js';
import { useExtractor } from './useExtractor.js';
import { useSettingsStore } from './useSettingsStore.js';
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

  // Settings belong up here rather than in the workspace: the workspace is remounted whenever you
  // switch trips, and an API key is not a per-trip thing.
  const settingsStore = useSettingsStore();
  const [showSettings, setShowSettings] = useState(false);

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

  return (
    <>
      <Workspace
        key={trip.id}
        store={store}
        trip={trip}
        onOpenTrip={setActiveId}
        apiKey={settingsStore.settings.anthropicApiKey}
        onOpenSettings={() => setShowSettings(true)}
      />
      {showSettings ? (
        <SettingsDialog
          settings={settingsStore.settings}
          persistent={settingsStore.persistent}
          onSave={settingsStore.update}
          onClose={() => setShowSettings(false)}
        />
      ) : null}
    </>
  );
}

function Workspace({
  store,
  trip,
  onOpenTrip,
  apiKey,
  onOpenSettings,
}: {
  store: Store;
  trip: Trip;
  onOpenTrip: (id: string) => void;
  apiKey: string | undefined;
  onOpenSettings: () => void;
}) {
  const { trips, saveTrip: update, deleteTrip } = store;

  const [view, setView] = useState<View>('days');
  const [selectedCardId, setSelectedCardId] = useState<string | undefined>();
  const [tab, setTab] = useState<PanelTab>('flights');
  const [creating, setCreating] = useState(false);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  /**
   * Fields a paste has filled in, and a counter to remount the form when they arrive.
   *
   * The editor holds its own draft in local state, so handing it new initial values only takes
   * effect on a fresh mount — the same reason `Workspace` itself is keyed by trip id above.
   */
  const [pasted, setPasted] = useState<Partial<CardDraft> | null>(null);
  // Not everything read off a listing is a form field. Whether the price covered a return journey
  // decides whether saving builds a second leg, and the form has nowhere to put that.
  const [pastedFields, setPastedFields] = useState<ExtractedFields | null>(null);
  const [returnPrompt, setReturnPrompt] = useState<string | null>(null);
  /** Candidates beyond the first, which land on the same card as alternatives to compare. */
  const [extras, setExtras] = useState<readonly ExtractedFields[]>([]);
  const [draftVersion, setDraftVersion] = useState(0);
  const [reading, setReading] = useState(false);

  const extractor = useExtractor(apiKey);
  const discovery = useDiscovery();

  // A search runs for minutes, and the trip may be edited while it does. Landing its results on
  // the trip as it was when the button was clicked would silently undo everything since, so the
  // completion reads the trip as it is *now*.
  const tripNow = useRef(trip);
  tripNow.current = trip;

  const findForSlot = async (request: SlotSearchRequest) => {
    const target = slotSearchTarget(request);
    try {
      const found = await discovery.find(trip, target.card, target.key);
      if (found.length === 0) {
        setNotice(
          "Claude searched but didn't find anything it could stand behind. Try adding what you " +
            'find by hand.',
        );
        return;
      }
      // Minutes have passed and the app stayed live. The slot these were found for may not be
      // there any more, and "Found 0 options" would explain none of that.
      const outcome = landSearchResults(tripNow.current, target, found);
      if (!outcome) {
        setNotice(
          `Claude found ${found.length} option${found.length === 1 ? '' : 's'}, but the slot they ` +
            'were for is gone. Nothing was added.',
        );
        return;
      }

      update(outcome.trip);
      reportLinking(outcome);
      setNotice(
        `Found ${outcome.added} option${outcome.added === 1 ? '' : 's'} — nothing has been ` +
          'chosen for you.',
      );
    } catch (error) {
      setNotice(describeExtractionError(error).message);
    }
  };

  /** Opening a different editor starts a different card. Nothing from the last one carries over. */
  const openEditor = (next: Editor | null) => {
    setEditor(next);
    setPasted(null);
    setPastedFields(null);
    setExtras([]);
    setReading(false);
    setDraftVersion((n) => n + 1);
  };

  /** Apply an edit that may invalidate cards, and say so rather than letting them vanish. */
  const applyEdit = (
    result: { trip: Trip; removedCardIds: readonly string[]; unpairedCardIds?: readonly string[] },
    why: string,
  ) => {
    update(result.trip);
    if (result.removedCardIds.length > 0) {
      const n = result.removedCardIds.length;
      setNotice(
        `${why} ${n} card${n === 1 ? '' : 's'} no longer applied, so ${n === 1 ? 'it was' : 'they were'} removed.`,
      );
      if (result.removedCardIds.includes(selectedCardId ?? '')) setSelectedCardId(undefined);
    } else if (result.unpairedCardIds !== undefined && result.unpairedCardIds.length > 0) {
      // The survivor still holds half a price for a purchase that no longer exists. Only the
      // traveller can say what it should be now, so the least we owe them is to point at it.
      setNotice(
        `${why} A return fare lost its other leg — check the price on what is left of it.`,
      );
    }
  };

  // Everything below is derived. No planning state is stored twice, so the two views cannot
  // disagree and the budget cannot go stale.
  const { schedule, budget, placed, conflicts, slots } = useMemo(() => {
    const schedule = runSchedule(trip);
    return {
      schedule,
      budget: computeBudget(trip, schedule),
      placed: placeCards(trip, schedule),
      conflicts: [...schedule.conflicts, ...detectCompatibilityConflicts(trip, schedule)],
      slots: tripSlots(trip, schedule),
    };
  }, [trip]);

  /**
   * Selecting a card anywhere puts the panel on its tab.
   *
   * One card has one home, so a flight clicked in the day grid always opens under Flights — even
   * though its leg is also listed under Transport.
   */
  const selectCard = (id: string) => {
    setSelectedCardId(id);
    const card = trip.cards.find((c) => c.id === id);
    if (card) setTab(tabForKind(card.kind));
  };

  /** A leg that exists but has no times yet. Nothing to correct, everything still to fill in. */
  const editingPlaceholder =
    editor?.mode === 'edit-option' &&
    trip.cards
      .find((c) => c.id === editor.cardId)
      ?.options.find((o) => o.id === editor.optionId)?.timing === undefined;

  const conflictedCardIds = useMemo(() => new Set(conflicts.flatMap((c) => c.cardIds)), [conflicts]);
  const conflictedSegmentIds = useMemo(
    () => new Set(conflicts.flatMap((c) => c.segmentIds)),
    [conflicts],
  );

  // Both go through the trip-level forms: a return fare fills two cards, and a decision about one
  // leg is a decision about both. The card-level versions cannot see that.
  const chooseOption = (cardId: string, optionId: string) => {
    const result = selectOptionInTrip(trip, cardId, optionId);
    if (!result.ok) return setNotice(result.reason);
    update(result.trip);
  };

  const changeState = (cardId: string, state: PlanningState) => {
    const result = transitionCardInTrip(trip, cardId, state);
    if (!result.ok) return setNotice(result.reason);
    update(result.trip);
  };

  /**
   * Move hotels partway through a stay.
   *
   * Where you sleep is one decision for a whole place, so this is the only way a second hotel gets
   * into one. The new slot takes the nights from here to the end of the stay and the previous hotel
   * gives up exactly those; deleting it hands them straight back.
   */
  const changeHotelsFrom = (segmentId: string, fromNight: number) => {
    const after = splitStay(trip, segmentId, fromNight);
    if (after === trip) return;
    update(after);
    selectCard(after.cards[after.cards.length - 1]!.id);
  };

  /**
   * Pulling a duration control changes how long you *want* to stay, not the range itself.
   *
   * Collapsing the range would destroy the flexibility the traveller authored, and it would be a
   * lie: how long you actually get somewhere is decided by the legs either side of it. Record the
   * wish and let the schedule show what it can give.
   */
  /**
   * What the traveller is optimising for. A trip preference, not a view setting — the same two
   * flights rank differently for someone counting money and someone counting evenings, and which
   * of those they are is a fact about this trip.
   */
  const changeRanking = (ranking: RankingPreset) => {
    update({ ...trip, preferences: { ...trip.preferences, ranking } });
  };

  const changeDuration = (segmentId: string, nights: number) => {
    update({
      ...trip,
      segments: trip.segments.map((s) =>
        s.id === segmentId ? { ...s, duration: { ...s.duration, ideal: nights } } : s,
      ),
    });
  };

  /** Say what building the second leg did, when it did something the traveller has to know about. */
  const reportLinking = (linked: LinkedImport) => {
    if (linked.promptCardId !== null) setReturnPrompt(linked.promptCardId);
    else if (linked.occupied) {
      setNotice(
        'That looked like a return fare, but the leg home already has a flight. The whole ' +
          'price stayed on this one.',
      );
    }
  };

  const saveFromEditor = (draft: CardDraft) => {
    if (!editor) return;

    if (editor.mode === 'new-card') {
      const cardId = nextCardId(trip);
      const option = optionFrom(draft, `${cardId}-opt-1`, trip.travelers);
      // The form owns which day this lands on. Taking the anchor's day verbatim is what put a
      // 09:30 tour on the morning the traveller was still in the air.
      const anchor: CardAnchor =
        editor.anchor.kind === 'segment-day'
          ? { ...editor.anchor, dayOffset: Math.max(0, Number(draft.dayOffset) || 0) }
          : editor.anchor;
      // A screenshot of a results list is several candidates for one slot, which is exactly what a
      // card full of options is. They land together and nothing is chosen: picking for the user
      // would decide the thing they pasted three flights in order to decide themselves.
      const extraOptions = extras.map((fields, i) =>
        optionFrom(
          { ...emptyDraft(draft.kind), ...toDraftPatch(fields), dayOffset: draft.dayOffset },
          `${cardId}-opt-${i + 2}`,
          trip.travelers,
        ),
      );

      const options = [option, ...extraOptions];
      const card: Card = {
        id: cardId,
        kind: draft.kind,
        state: 'exploring',
        anchor,
        options,
        ...(options.length === 1 ? { selectedOptionId: option.id } : {}),
      };

      const sources = [pastedFields, ...extras];
      const linked = linkImportedFares(
        addCard(trip, card),
        cardId,
        options.map((opt, i) => ({ optionId: opt.id, source: sources[i] ?? null })),
      );

      reportLinking(linked);
      update(linked.trip);
      setSelectedCardId(cardId);
    } else if (editor.mode === 'new-option') {
      const card = trip.cards.find((c) => c.id === editor.cardId);
      if (card) {
        const option = optionFrom(draft, nextOptionId(card), trip.travelers);
        // The second flight a traveller compares is a round trip as often as the first was, and it
        // arrives here rather than through a new card. It needs its own leg home for the same reason.
        const linked = linkImportedFares(addOption(trip, card.id, option), card.id, [
          { optionId: option.id, source: pastedFields },
        ]);
        reportLinking(linked);
        update(linked.trip);
      }
    } else {
      update(updateOption(trip, editor.cardId, optionFrom(draft, editor.optionId, trip.travelers)));
    }
    openEditor(null);
  };

  /** The days of a stay, so a card being attached to one can say which. */
  const daysOfSegment = (segmentId: string): DayChoice[] => {
    const scheduled = schedule.segments.find((s) => s.segmentId === segmentId);
    if (!scheduled) return [];
    return Array.from({ length: scheduled.nights }, (_, offset) => ({
      offset,
      label: `Day ${offset + 1}${scheduled.startDate ? ` · ${shortDate(addDays(scheduled.startDate, offset))}` : ''}`,
    }));
  };

  const editorProps = () => {
    if (!editor) return null;
    if (editor.mode === 'new-card') {
      const anchor = editor.anchor;
      return {
        draft: {
          ...emptyDraft(editor.kinds[0]!),
          ...(anchor.kind === 'segment-day' ? { dayOffset: String(anchor.dayOffset) } : {}),
        },
        kinds: editor.kinds,
        ...(anchor.kind === 'segment-day' ? { days: daysOfSegment(anchor.segmentId) } : {}),
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
          <strong>{PRODUCT_NAME}</strong>
          <span>{SURFACE_NAME}</span>
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

        <div className="rail__group">This app</div>
        <button type="button" className="rail__item" onClick={onOpenSettings}>
          Settings
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
          <SaveStatus
            state={store.saveState}
            savedAt={store.savedAt}
            ephemeral={store.ephemeral}
            location={store.location}
            onReveal={store.reveal}
          />
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
              onSelectCard={selectCard}
              onAdd={(anchor) =>
                openEditor({ mode: 'new-card', anchor, kinds: kindsForAnchor(anchor.kind) })
              }
              onSplitStay={changeHotelsFrom}
            />
          ) : (
            <StructureView
              trip={trip}
              schedule={schedule}
              placed={placed}
              selectedCardId={selectedCardId}
              conflictedCardIds={conflictedCardIds}
              conflictedSegmentIds={conflictedSegmentIds}
              onSelectCard={selectCard}
              onChangeDuration={changeDuration}
              onAdd={(anchor, kinds) => openEditor({ mode: 'new-card', anchor, kinds })}
              onAddStop={(name, at) => applyEdit(addSegment(trip, name, at), 'Added a stop.')}
              onRemoveStop={(id) => applyEdit(removeSegment(trip, id), 'Removed a stop.')}
              onMoveStop={(id, delta) =>
                applyEdit(moveSegment(trip, id, delta), 'Reordered your stops.')
              }
              onSplitStay={changeHotelsFrom}
            />
          )}
        </div>
      </main>

      <OptionsPanel
        trip={trip}
        schedule={schedule}
        placed={placed}
        slots={slots}
        tab={tab}
        onChangeTab={(next) => {
          setTab(next);
          // Switching tabs means going to that tab's list, not carrying a detail view across.
          setSelectedCardId(undefined);
        }}
        selectedCardId={selectedCardId}
        conflictedCardIds={conflictedCardIds}
        onSelectCard={selectCard}
        onAddToSlot={(anchor, kinds) => openEditor({ mode: 'new-card', anchor, kinds })}
        onFindForSlot={(request) => void findForSlot(request)}
        canSearch={discovery.available}
        onBack={() => setSelectedCardId(undefined)}
        onChooseOption={chooseOption}
        onChangeState={changeState}
        onChangeRanking={changeRanking}
        onMoveCardToDay={(cardId, dayOffset) => update(moveCardToDay(trip, cardId, dayOffset))}
        onAddOption={(cardId) => openEditor({ mode: 'new-option', cardId })}
        onEditOption={(cardId, optionId) => openEditor({ mode: 'edit-option', cardId, optionId })}
        onRemoveOption={(cardId, optionId) => update(removeOption(trip, cardId, optionId))}
        onRemoveCard={(cardId) => {
          update(removeCard(trip, cardId));
          setSelectedCardId(undefined);
        }}
        {...(discovery.available
          ? {
              onFindOptions: (card: Card) =>
                void findForSlot({
                  existing: card,
                  anchor: card.anchor,
                  kind: card.kind,
                  slotKey: card.id,
                }),
            }
          : {})}
        searchingSlotId={discovery.searchingSlotId}
      />

      {creating ? (
        <CreateTripDialog
          existingIds={trips.map((t) => t.id)}
          onCreate={startTrip}
          onCancel={() => setCreating(false)}
        />
      ) : null}

      {editing ? (
        <CardEditor
          key={draftVersion}
          draft={pasted ? { ...editing.draft, ...pasted } : editing.draft}
          kinds={editing.kinds}
          {...('days' in editing && editing.days ? { days: editing.days } : {})}
          title={editing.title}
          submitLabel={editing.submitLabel}
          topSlot={
            // Only when adding something. Re-editing an option you already saved is a correction,
            // and pasting a different listing over it would be a new option, not an edit. A blank
            // return leg is the exception: there is nothing there to correct, and pasting the
            // return flight is exactly what it is waiting for.
            editor?.mode !== 'edit-option' || editingPlaceholder ? (
              <PasteImportBox
                allowedKinds={editing.kinds}
                extractor={extractor}
                onOpenSettings={onOpenSettings}
                onBusyChange={setReading}
                onExtracted={(patch, fields) => {
                  setPasted((current) => ({ ...current, ...patch }));
                  setPastedFields(fields);
                  setDraftVersion((n) => n + 1);
                }}
                onExtrasChange={setExtras}
              />
            ) : null
          }
          busy={reading}
          travelers={trip.travelers}
          onSave={saveFromEditor}
          onCancel={() => openEditor(null)}
        />
      ) : null}

      {returnPrompt ? (
        <ReturnLegPrompt
          onAdd={() => {
            const card = trip.cards.find((c) => c.id === returnPrompt);
            const optionId = card?.selectedOptionId ?? card?.options[0]?.id;
            setReturnPrompt(null);
            if (card && optionId) openEditor({ mode: 'edit-option', cardId: card.id, optionId });
          }}
          onLater={() => setReturnPrompt(null)}
        />
      ) : null}
    </div>
  );
}

/**
 * The other half of a fare that was only half shown.
 *
 * The leg already exists by the time this appears — walking away costs nothing, and the trip is
 * left saying plainly that one flight has no times rather than quietly missing one.
 */
function ReturnLegPrompt({ onAdd, onLater }: { onAdd: () => void; onLater: () => void }) {
  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-label="Return flight">
      <div className="dialog">
        <h2>What about the flight home?</h2>
        <p>
          That price covers a return, but the listing only showed the outbound flight. The leg home
          is on your trip with half the fare against it and no times yet, so nothing is scheduled
          around it.
        </p>
        <div className="actions">
          <button type="button" className="btn" onClick={onLater}>
            Later
          </button>
          <button type="button" className="btn btn--primary" onClick={onAdd}>
            Add the return details
          </button>
        </div>
      </div>
    </div>
  );
}
