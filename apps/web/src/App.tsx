import type { PlanningState, Trip } from '@odysseus/domain';
import {
  addDays,
  computeBudget,
  detectCompatibilityConflicts,
  placeCards,
  schedule as runSchedule,
  selectOption,
  transitionCard,
} from '@odysseus/domain';
import { buildFixtureTrip } from '@odysseus/providers';
import { useMemo, useState } from 'react';
import { CreateTripDialog } from './CreateTripDialog.js';
import { DayView } from './DayView.js';
import { OptionsPanel } from './OptionsPanel.js';
import { StructureView } from './StructureView.js';
import { dateRange, money, tripSubtitle } from './format.js';

type View = 'structure' | 'days';

export function App() {
  const [trip, setTrip] = useState<Trip>(buildFixtureTrip);
  const [view, setView] = useState<View>('days');
  const [selectedCardId, setSelectedCardId] = useState<string | undefined>('c-inbound');
  const [creating, setCreating] = useState(false);

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

  const conflictedCardIds = useMemo(
    () => new Set(conflicts.flatMap((c) => c.cardIds)),
    [conflicts],
  );
  const conflictedSegmentIds = useMemo(
    () => new Set(conflicts.flatMap((c) => c.segmentIds)),
    [conflicts],
  );

  const chooseOption = (cardId: string, optionId: string) => {
    setTrip((current) => {
      const card = current.cards.find((c) => c.id === cardId);
      if (!card) return current;
      const result = selectOption(card, optionId);
      if (!result.ok) return current;
      return { ...current, cards: current.cards.map((c) => (c.id === cardId ? result.card : c)) };
    });
  };

  const changeState = (cardId: string, state: PlanningState) => {
    setTrip((current) => {
      const card = current.cards.find((c) => c.id === cardId);
      if (!card) return current;
      const result = transitionCard(card, state);
      if (!result.ok) return current;
      return { ...current, cards: current.cards.map((c) => (c.id === cardId ? result.card : c)) };
    });
  };

  /**
   * Pulling a duration control changes how long you *want* to stay. It does not collapse the range
   * to that number.
   *
   * Two reasons. Collapsing would destroy the flexibility the traveller authored — drag Paris to
   * seven nights and there would be no way back. And it would be a lie: how long you actually get
   * in Paris is decided by the flights either side of it, so the honest thing is to record the wish
   * and let the schedule show what it can actually give you.
   */
  const changeDuration = (segmentId: string, nights: number) => {
    setTrip((current) => ({
      ...current,
      segments: current.segments.map((s) =>
        s.id === segmentId ? { ...s, duration: { ...s.duration, ideal: nights } } : s,
      ),
    }));
  };

  const startTrip = (created: Trip) => {
    setTrip(created);
    setSelectedCardId(undefined);
    setView('structure'); // nothing is dated yet, so structure is the only useful lens
    setCreating(false);
  };

  const loadDemo = () => {
    setTrip(buildFixtureTrip());
    setSelectedCardId('c-inbound');
    setView('days');
  };

  const dates =
    schedule.startDate !== undefined
      ? dateRange(schedule.startDate, addDays(schedule.startDate, schedule.totalNights))
      : 'Dates not set';

  return (
    <div className="app">
      <nav className="rail">
        <div className="rail__brand">
          <strong>Odysseus</strong>
          <span>Workspace</span>
        </div>

        <div className="rail__group">Plan</div>
        <button type="button" className="rail__item" aria-current={view === 'structure'} onClick={() => setView('structure')}>
          Structure
        </button>
        <button type="button" className="rail__item" aria-current={view === 'days'} onClick={() => setView('days')}>
          Days
        </button>

        <div className="rail__group">Trips</div>
        <button type="button" className="rail__item" onClick={loadDemo}>
          Europe Adventure
        </button>
        <button type="button" className="rail__item" onClick={() => setCreating(true)}>
          Start a trip
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
          Slice 1. Options come from fixture data, and nothing is saved between sessions yet.
        </div>
      </nav>

      <main className="main">
        <header className="head">
          <div className="head__top">
            <div>
              <h1 className="head__title">{trip.name}</h1>
              <p className="head__sub">
                <span className="num">{dates}</span> · {tripSubtitle(trip, schedule.totalNights, schedule.totalDays)}
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
          </div>
        </header>

        <div className="scroll">
          {conflicts.length > 0 ? (
            <div className="conflicts">
              {conflicts.map((conflict, i) => (
                <div key={`${conflict.code}-${i}`} className="conflict" data-severity={conflict.severity}>
                  <span className="conflict__code">{conflict.code.replace(/_/g, ' ')}</span>
                  <span>{conflict.message}</span>
                </div>
              ))}
            </div>
          ) : null}

          {trip.segments.length === 0 ? (
            <p className="panel__empty">
              This trip has no destinations yet. Start another one to add some.
            </p>
          ) : view === 'days' ? (
            <DayView
              trip={trip}
              schedule={schedule}
              budget={budget}
              placed={placed}
              selectedCardId={selectedCardId}
              conflictedCardIds={conflictedCardIds}
              onSelectCard={setSelectedCardId}
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
      />

      {creating ? <CreateTripDialog onCreate={startTrip} onCancel={() => setCreating(false)} /> : null}
    </div>
  );
}
