# Workspace Panel — Slots Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the right-hand panel always useful — four tabs listing what the trip is made of, so an empty trip has a way to add and search for options.

**Architecture:** A new pure derivation `tripSlots(trip, schedule)` in `packages/domain` answers "what slots does this trip have and what fills each". The panel becomes a tab shell over a slot list that drills into today's detail view, moved across unchanged. Searching a slot with no card builds a throwaway card that never enters the trip; the real card is created only if results arrive.

**Tech Stack:** TypeScript, React 19, Vite, Vitest. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-07-28-workspace-panel-slots-design.md`

## Global Constraints

- `packages/domain` must not import anything framework-shaped or perform I/O. `purity.test.ts` enforces this.
- No changes to `packages/providers`, `packages/extraction`, or `packages/persistence`. If a task seems to need one, stop and ask.
- Never hardcode the product name; user-facing text reads `PRODUCT_NAME` from `packages/brand`. (No task here needs it.)
- The day grid is out of scope, including the `opacity: 0` hover-fade on `.add--cell` in `styles.css`.
- `apps/web` has no React testing library. Logic that needs a test goes in a plain `.ts` module beside the component; components are verified by driving the running app.
- Tests are Vitest. Domain: `npm test -w @odysseus/domain`. Web: `npm test -w @odysseus/web`.
- Commit after every task.

---

## File Structure

**Create**
- `packages/domain/src/slots.ts` — `tripSlots` and its four slot types. Pure derivation, no React.
- `packages/domain/src/slots.test.ts`
- `apps/web/src/slot-search.ts` — ephemeral search card, and create-then-land. No React.
- `apps/web/src/slot-search.test.ts`
- `apps/web/src/CardDetail.tsx` — today's `OptionsPanel` body, moved.
- `apps/web/src/SlotList.tsx` — the tab lists, plus `PanelTab` and `tabForKind`.
- `apps/web/src/shortlist.ts` (phase 2) — candidate to card.
- `apps/web/src/shortlist.test.ts` (phase 2)

**Modify**
- `packages/domain/src/index.ts` — export `./slots.js`.
- `apps/web/src/OptionsPanel.tsx` — becomes the tab shell only.
- `apps/web/src/useDiscovery.ts` — `searchingCardId` becomes an opaque `searchingSlotId`.
- `apps/web/src/App.tsx` — panel wiring: tab state, `selectCard`, slot search, slot add.
- `apps/web/src/styles.css` — panel tabs, slot rows, candidate rows.

---

# Phase 1 — the tabbed panel

## Task 1: `tripSlots` in the domain

**Files:**
- Create: `packages/domain/src/slots.ts`
- Create: `packages/domain/src/slots.test.ts`
- Modify: `packages/domain/src/index.ts`

**Interfaces:**
- Consumes: `Schedule` from `./scheduler.js`, `stayNights` from `./layout.js`, `staysInOrder` from `./stays.js`, `Card`/`Trip`/`CardKind` from `./types.js`.
- Produces: `tripSlots(trip: Trip, schedule: Schedule): TripSlots`, plus exported interfaces `TripSlots`, `ConnectionSlot`, `StaySlot`, `StopGroup`. Tasks 4 and 7 consume these.

- [ ] **Step 1: Write the failing test**

Create `packages/domain/src/slots.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { schedule } from './scheduler.js';
import { tripSlots } from './slots.js';
import {
  card,
  connection,
  floatingStayOption,
  journeyOption,
  segment,
  slotOption,
  trip,
} from './test-support.js';
import type { Card, Trip } from './types.js';

/** Home → Sao Paulo → home, 15 nights, exactly the trip in the bug report. */
function brazil(cards: Card[] = []): Trip {
  return trip({
    segments: [segment('sao', 'Sao Paulo', { min: 15, ideal: 15, max: 15 })],
    connections: [connection('leg-1', null, 'sao'), connection('leg-2', 'sao', null)],
    cards,
  });
}

const slots = (t: Trip) => tripSlots(t, schedule(t));

describe('tripSlots', () => {
  it('has nothing to say about a trip with no stops', () => {
    const s = slots(trip());
    expect(s.connections).toEqual([]);
    expect(s.stays).toEqual([]);
    expect(s.localTransport).toEqual([]);
    expect(s.activities).toEqual([]);
  });

  it('gives every leg a slot, named end to end, with home for the unmodelled ends', () => {
    const s = slots(brazil());
    expect(s.connections.map((c) => [c.id, c.fromName, c.toName])).toEqual([
      ['connection:leg-1', null, 'Sao Paulo'],
      ['connection:leg-2', 'Sao Paulo', null],
    ]);
    expect(s.connections.every((c) => c.cards.length === 0)).toBe(true);
  });

  it('counts a train as filling a leg, because a leg is one slot either way', () => {
    const train = card('card-1', 'transport', { kind: 'connection', connectionId: 'leg-1' }, [
      journeyOption('o1', { departDate: '2027-03-01' }),
    ]);
    const s = slots(brazil([train]));
    expect(s.connections[0]!.cards.map((c) => c.id)).toEqual(['card-1']);
    expect(s.connections[1]!.cards).toEqual([]);
  });

  it('offers one empty stay per stop with nowhere to sleep', () => {
    const s = slots(brazil());
    expect(s.stays).toHaveLength(1);
    expect(s.stays[0]!.id).toBe('stay:sao');
    expect(s.stays[0]!.placeName).toBe('Sao Paulo');
    expect(s.stays[0]!.nights).toBe(15);
    expect(s.stays[0]!.card).toBeUndefined();
  });

  it('gives a split stay one slot each, holding the nights it actually covers', () => {
    const first = card('card-a', 'lodging', { kind: 'segment', segmentId: 'sao' }, [
      floatingStayOption('a1', { perNight: 100 }),
    ]);
    const second = card(
      'card-b',
      'lodging',
      { kind: 'segment', segmentId: 'sao', fromNight: 10 },
      [floatingStayOption('b1', { perNight: 120 })],
    );
    const s = slots(brazil([first, second]));
    expect(s.stays.map((x) => [x.id, x.nights])).toEqual([
      ['stay:card-a', 10],
      ['stay:card-b', 5],
    ]);
  });

  it('separates getting around a stop from what you do there', () => {
    const tour = card(
      'card-act',
      'activity',
      { kind: 'segment-day', segmentId: 'sao', dayOffset: 2 },
      [slotOption('x', { startTime: '09:00', endTime: '11:00' })],
    );
    const reminder = card('card-note', 'note', { kind: 'segment', segmentId: 'sao' }, []);
    const taxi = card(
      'card-taxi',
      'transport',
      { kind: 'segment-day', segmentId: 'sao', dayOffset: 0 },
      [slotOption('y', { startTime: '08:00', endTime: '09:00' })],
    );
    const s = slots(brazil([tour, reminder, taxi]));
    expect(s.activities[0]!.cards.map((c) => c.id)).toEqual(['card-act', 'card-note']);
    expect(s.localTransport[0]!.cards.map((c) => c.id)).toEqual(['card-taxi']);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npm test -w @odysseus/domain -- slots
```

Expected: FAIL — cannot resolve `./slots.js`.

- [ ] **Step 3: Write the implementation**

Create `packages/domain/src/slots.ts`:

```ts
import { stayNights } from './layout.js';
import type { Schedule } from './scheduler.js';
import { staysInOrder } from './stays.js';
import type { Card, CardKind, Trip } from './types.js';

/**
 * What the trip is made of, slot by slot.
 *
 * The panel needs a standing account of the trip's open questions, not just of the cards that
 * happen to exist — a leg with nothing on it is the most important thing the panel can say, and
 * `placeCards` deliberately cannot see it (it skips anything with nothing chosen).
 *
 * Derived, never stored, for the same reason the day grid is: a slot list that could disagree with
 * the schedule would be a second source of truth about the shape of the trip.
 *
 * A connection is one slot however it is filled. A flight and a train are two answers to "how do we
 * get there", not two questions, so the cards on a leg are returned whatever their kind and it is
 * the caller's tab that decides what a search should ask for.
 */

export interface ConnectionSlot {
  readonly id: string;
  readonly connectionId: string;
  /** Null at the ends of the trip, where the other endpoint is an unmodelled home. */
  readonly fromName: string | null;
  readonly toName: string | null;
  /** Every card on this leg, whatever its kind. */
  readonly cards: readonly Card[];
}

export interface StaySlot {
  readonly id: string;
  readonly segmentId: string;
  readonly placeName: string;
  /** Nights this stay actually covers, which a split makes different from the stop's length. */
  readonly nights: number;
  readonly card: Card | undefined;
}

/** Everything of one sort attached to one stop, which is as much structure as these kinds have. */
export interface StopGroup {
  readonly id: string;
  readonly segmentId: string;
  readonly placeName: string;
  readonly cards: readonly Card[];
}

export interface TripSlots {
  readonly connections: readonly ConnectionSlot[];
  readonly stays: readonly StaySlot[];
  readonly localTransport: readonly StopGroup[];
  readonly activities: readonly StopGroup[];
}

const ACTIVITY_KINDS: ReadonlySet<CardKind> = new Set<CardKind>(['activity', 'dining', 'note']);

export function tripSlots(trip: Trip, schedule: Schedule): TripSlots {
  const placeOf = (id: string | null): string | null =>
    id === null ? null : (trip.segments.find((s) => s.id === id)?.location.name ?? null);

  const connections: ConnectionSlot[] = trip.connections.map((conn) => ({
    id: `connection:${conn.id}`,
    connectionId: conn.id,
    fromName: placeOf(conn.fromSegmentId),
    toName: placeOf(conn.toSegmentId),
    cards: trip.cards.filter(
      (c) => c.anchor.kind === 'connection' && c.anchor.connectionId === conn.id,
    ),
  }));

  const nights = stayNights(trip, schedule);
  const stays: StaySlot[] = [];
  const localTransport: StopGroup[] = [];
  const activities: StopGroup[] = [];

  for (const scheduled of schedule.segments) {
    const segmentId = scheduled.segmentId;
    const placeName = trip.segments.find((s) => s.id === segmentId)?.location.name ?? segmentId;

    const staying = staysInOrder(trip, segmentId);
    if (staying.length === 0) {
      // A stop the schedule gives no nights has nothing to cover, so it is not an open question.
      if (scheduled.nights > 0) {
        stays.push({
          id: `stay:${segmentId}`,
          segmentId,
          placeName,
          nights: scheduled.nights,
          card: undefined,
        });
      }
    } else {
      for (const card of staying) {
        stays.push({
          id: `stay:${card.id}`,
          segmentId,
          placeName,
          nights: nights.get(card.id)?.length ?? 0,
          card,
        });
      }
    }

    localTransport.push({
      id: `stop:${segmentId}`,
      segmentId,
      placeName,
      cards: trip.cards.filter(
        (c) =>
          c.kind === 'transport' &&
          c.anchor.kind === 'segment-day' &&
          c.anchor.segmentId === segmentId,
      ),
    });

    activities.push({
      id: `stop:${segmentId}`,
      segmentId,
      placeName,
      cards: trip.cards.filter(
        (c) =>
          ACTIVITY_KINDS.has(c.kind) &&
          (c.anchor.kind === 'segment-day' || c.anchor.kind === 'segment') &&
          c.anchor.segmentId === segmentId,
      ),
    });
  }

  return { connections, stays, localTransport, activities };
}
```

- [ ] **Step 4: Export it**

In `packages/domain/src/index.ts`, add after the `./stays.js` line:

```ts
export * from './slots.js';
```

- [ ] **Step 5: Run the tests and the typecheck**

```bash
npm test -w @odysseus/domain && npm run typecheck -w @odysseus/domain
```

Expected: all PASS, including the existing `purity.test.ts`.

- [ ] **Step 6: Commit**

```bash
git add packages/domain/src/slots.ts packages/domain/src/slots.test.ts packages/domain/src/index.ts && git commit -m "Derive the trip's slots, filled and empty"
```

---

## Task 2: Searching a slot that has no card

**Files:**
- Create: `apps/web/src/slot-search.ts`
- Create: `apps/web/src/slot-search.test.ts`

**Interfaces:**
- Consumes: `applyDiscovery` and `DiscoveryOutcome` from `./discover.js`; `addCard`, `nextCardId` from `@odysseus/domain`.
- Produces:
  - `interface SlotSearchRequest { existing: Card | undefined; anchor: CardAnchor; kind: CardKind; slotKey: string }`
  - `interface SlotSearchTarget { card: Card; key: string; ephemeral: boolean }`
  - `slotSearchTarget(request: SlotSearchRequest): SlotSearchTarget`
  - `landSearchResults(trip: Trip, target: SlotSearchTarget, found: readonly Option[]): DiscoveryOutcome | null`

  Tasks 3 and 4 consume all four.

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/slot-search.test.ts`:

```ts
import { SCHEMA_VERSION } from '@odysseus/domain';
import type { Card, Option, Trip } from '@odysseus/domain';
import { describe, expect, it } from 'vitest';
import { landSearchResults, slotSearchTarget } from './slot-search.js';

/** Home → Lisbon → home, nothing on either leg. */
function build(cards: Card[] = []): Trip {
  return {
    id: 'trip-1',
    name: 'Lisbon',
    travelers: 2,
    anchorDate: '2027-03-10',
    length: { min: 5, max: 5 },
    currency: 'USD',
    segments: [{ id: 'lis', location: { name: 'Lisbon' }, duration: { min: 5, ideal: 5, max: 5 } }],
    connections: [
      { id: 'leg-1', fromSegmentId: null, toSegmentId: 'lis' },
      { id: 'leg-2', fromSegmentId: 'lis', toSegmentId: null },
    ],
    cards,
    preferences: { ranking: 'balanced', dayStart: '08:00', dayEnd: '22:00' },
    schemaVersion: SCHEMA_VERSION,
  };
}

const found: Option[] = [
  { id: 'x1', source: 'discovered', title: 'TAP 218', cost: { kind: 'fixed', amount: 640 } },
  { id: 'x2', source: 'discovered', title: 'TAP 224', cost: { kind: 'fixed', amount: 710 } },
];

const outbound = { kind: 'connection', connectionId: 'leg-1' } as const;

describe('slotSearchTarget', () => {
  it('builds a card that never enters the trip when the slot is empty', () => {
    const target = slotSearchTarget({
      existing: undefined,
      anchor: outbound,
      kind: 'flight',
      slotKey: 'connection:leg-1:flight',
    });
    expect(target.ephemeral).toBe(true);
    expect(target.key).toBe('connection:leg-1:flight');
    expect(target.card.kind).toBe('flight');
    expect(target.card.anchor).toEqual(outbound);
    expect(target.card.options).toEqual([]);
  });

  it('searches the card already there, so a re-search cleans up after itself', () => {
    const card: Card = {
      id: 'card-1',
      kind: 'flight',
      state: 'exploring',
      anchor: outbound,
      options: [],
    };
    const target = slotSearchTarget({
      existing: card,
      anchor: outbound,
      kind: 'flight',
      slotKey: 'connection:leg-1:flight',
    });
    expect(target.ephemeral).toBe(false);
    expect(target.key).toBe('card-1');
    expect(target.card).toBe(card);
  });
});

describe('landSearchResults', () => {
  it('creates the card only now, with the options on it and nothing chosen', () => {
    const target = slotSearchTarget({
      existing: undefined,
      anchor: outbound,
      kind: 'flight',
      slotKey: 'connection:leg-1:flight',
    });
    const outcome = landSearchResults(build(), target, found);
    expect(outcome).not.toBeNull();

    const created = outcome!.trip.cards;
    expect(created).toHaveLength(1);
    expect(created[0]!.kind).toBe('flight');
    expect(created[0]!.anchor).toEqual(outbound);
    expect(created[0]!.state).toBe('exploring');
    expect(created[0]!.selectedOptionId).toBeUndefined();
    expect(created[0]!.options.map((o) => o.title)).toEqual(['TAP 218', 'TAP 224']);
    expect(outcome!.added).toBe(2);
  });

  it('adds nothing when the leg was deleted while the search ran', () => {
    const target = slotSearchTarget({
      existing: undefined,
      anchor: { kind: 'connection', connectionId: 'leg-gone' },
      kind: 'flight',
      slotKey: 'connection:leg-gone:flight',
    });
    expect(landSearchResults(build(), target, found)).toBeNull();
  });

  it('adds nothing when the card it was searching for was removed', () => {
    const card: Card = {
      id: 'card-1',
      kind: 'flight',
      state: 'exploring',
      anchor: outbound,
      options: [],
    };
    const target = slotSearchTarget({
      existing: card,
      anchor: outbound,
      kind: 'flight',
      slotKey: 'connection:leg-1:flight',
    });
    expect(landSearchResults(build(), target, found)).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npm test -w @odysseus/web -- slot-search
```

Expected: FAIL — cannot resolve `./slot-search.js`.

- [ ] **Step 3: Write the implementation**

Create `apps/web/src/slot-search.ts`:

```ts
import { addCard, nextCardId } from '@odysseus/domain';
import type { Card, CardAnchor, CardKind, Option, Trip } from '@odysseus/domain';
import type { DiscoveryOutcome } from './discover.js';
import { applyDiscovery } from './discover.js';

/**
 * Searching a slot the trip has no card for.
 *
 * A search runs for minutes and cannot be recalled, so creating the card up front would leave an
 * option-less card behind every time one came back empty, errored, or hit the ten-minute ceiling —
 * and an option-less card shows nowhere but the panel, because `placeCards` skips anything with
 * nothing chosen. So the search runs against a card that never enters the trip, and the real one is
 * created only if there is something to put on it.
 *
 * `buildSearchQuery` reads only a card's kind, anchor and options, which is what makes this safe.
 */

/** The id the throwaway card carries. It is never written to a trip. */
const PENDING_CARD_ID = 'pending';

export interface SlotSearchRequest {
  /** The card of the right kind already on this slot, when there is one. */
  readonly existing: Card | undefined;
  readonly anchor: CardAnchor;
  readonly kind: CardKind;
  /** Identity for the busy indicator while the slot has no card to be identified by. */
  readonly slotKey: string;
}

export interface SlotSearchTarget {
  readonly card: Card;
  readonly key: string;
  readonly ephemeral: boolean;
}

export function slotSearchTarget(request: SlotSearchRequest): SlotSearchTarget {
  // A slot that already holds a card searches *that* card: it is the only way a re-search can clean
  // up the options it is replacing, fare partners and all.
  if (request.existing !== undefined) {
    return { card: request.existing, key: request.existing.id, ephemeral: false };
  }
  return {
    card: {
      id: PENDING_CARD_ID,
      kind: request.kind,
      state: 'unplanned',
      anchor: request.anchor,
      options: [],
    },
    key: request.slotKey,
    ephemeral: true,
  };
}

/** Whether the thing a card is pinned to is still part of the trip. */
export function anchorExists(trip: Trip, anchor: CardAnchor): boolean {
  if (anchor.kind === 'connection') {
    return trip.connections.some((c) => c.id === anchor.connectionId);
  }
  return trip.segments.some((s) => s.id === anchor.segmentId);
}

/**
 * Put a search's results on the trip, creating the card first when the slot was empty.
 *
 * Null when the slot no longer exists. Minutes have passed and the app stayed live: the leg may
 * have been deleted, or the card removed, and silently re-creating it would put back something the
 * traveller took away.
 */
export function landSearchResults(
  trip: Trip,
  target: SlotSearchTarget,
  found: readonly Option[],
): DiscoveryOutcome | null {
  if (!target.ephemeral) {
    if (!trip.cards.some((c) => c.id === target.card.id)) return null;
    return applyDiscovery(trip, target.card.id, found);
  }

  if (!anchorExists(trip, target.card.anchor)) return null;

  const id = nextCardId(trip);
  const created: Card = {
    id,
    kind: target.card.kind,
    state: 'unplanned',
    anchor: target.card.anchor,
    options: [],
  };
  // `applyDiscovery` promotes unplanned to exploring once options land, which is exactly what a
  // card born this way should be: candidates gathered, nothing decided.
  return applyDiscovery(addCard(trip, created), id, found);
}
```

- [ ] **Step 4: Run the tests**

```bash
npm test -w @odysseus/web && npm run typecheck -w @odysseus/web
```

Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/slot-search.ts apps/web/src/slot-search.test.ts && git commit -m "Search a slot before it has a card"
```

---

## Task 3: Move the detail view out of `OptionsPanel`, and route the existing search through the new seam

This task changes no behaviour. Verify by running the app and confirming the panel is identical.

**Files:**
- Create: `apps/web/src/CardDetail.tsx`
- Modify: `apps/web/src/OptionsPanel.tsx`
- Modify: `apps/web/src/useDiscovery.ts`
- Modify: `apps/web/src/App.tsx`

**Interfaces:**
- Consumes: `slotSearchTarget`, `landSearchResults`, `SlotSearchRequest` from Task 2.
- Produces: `CardDetail` (default-less named export) with the props listed in Step 2. `useDiscovery` now returns `{ available, searchingSlotId, find(trip, card, key) }`. `App` gains `findForSlot(request: SlotSearchRequest): Promise<void>`. Task 4 consumes all of these.

- [ ] **Step 1: Move the body verbatim**

Create `apps/web/src/CardDetail.tsx` by cutting from `OptionsPanel.tsx`:

- the whole of `OptionRow`, `sourceCaveat`, `DayPicker`, `ripple`, `TripSpine`
- the `STATES` and `PRESETS` constants
- the JSX from `<div className="panel__head">` through the closing `</div>` of `panel__scroll`

Keep every comment. Do not reword any user-facing string. `CardDetail` returns a fragment, **not** an `<aside>` — the shell owns that element so `.panel`'s flex column keeps `panel__head` and `panel__scroll` as direct children.

- [ ] **Step 2: Give it this signature**

```tsx
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
 * One slot, and what could fill it.
 *
 * Everything here answers one question: what would this alternative do to the trip? Never what it
 * costs on its own. An option that is $96 cheaper and loses you an evening should be visibly a
 * tradeoff, not a saving.
 */
export function CardDetail({
  trip,
  schedule,
  placed,
  card,
  onChooseOption,
  onChangeState,
  onChangeRanking,
  onMoveCardToDay,
  onAddOption,
  onEditOption,
  onRemoveOption,
  onRemoveCard,
  onFindOptions,
  searchingSlotId,
}: {
  trip: Trip;
  schedule: Schedule;
  placed: readonly PlacedCard[];
  card: Card;
  onChooseOption: (cardId: string, optionId: string) => void;
  onChangeState: (cardId: string, state: PlanningState) => void;
  onChangeRanking: (preset: RankingPreset) => void;
  onMoveCardToDay: (cardId: string, dayOffset: number) => void;
  onAddOption: (cardId: string) => void;
  onEditOption: (cardId: string, optionId: string) => void;
  onRemoveOption: (cardId: string, optionId: string) => void;
  onRemoveCard: (cardId: string) => void;
  /** Absent in the browser build, where nothing can run a search. */
  onFindOptions?: (card: Card) => void;
  searchingSlotId: string | null;
}) {
```

Two edits inside the moved body, and no others:

1. Delete the `const card = trip.cards.find(...)` line and the `if (!card)` early return — `card` is now a prop.
2. In the Find button, `searchingCardId` becomes `searchingSlotId`, the disabled test becomes `searchingSlotId !== null || card.state === 'booked'`, the busy test becomes `searchingSlotId === card.id`, and the click handler becomes `onClick={() => onFindOptions(card)}`.

- [ ] **Step 3: Reduce `OptionsPanel` to a shell**

Replace the whole of `apps/web/src/OptionsPanel.tsx` with:

```tsx
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
```

- [ ] **Step 4: Make the busy key opaque**

In `apps/web/src/useDiscovery.ts`:

```ts
export interface Discovery {
  /** False in the browser build, where the button should not exist. */
  readonly available: boolean;
  /**
   * What is being searched right now, or null. One search at a time.
   *
   * A key rather than a card id: a slot with nothing on it can start a search, and there is no card
   * to name it by until the results come back.
   */
  readonly searchingSlotId: string | null;
  readonly find: (trip: Trip, card: Card, key: string) => Promise<readonly Option[]>;
}
```

and in the body:

```ts
  const [searchingSlotId, setSearchingSlotId] = useState<string | null>(null);
```

```ts
  const find = async (trip: Trip, card: Card, key: string): Promise<readonly Option[]> => {
    if (!provider) throw new Error('Searching needs the desktop app.');
    setSearchingSlotId(key);
    try {
      return await provider.fetch(trip, card);
    } finally {
      setSearchingSlotId(null);
    }
  };

  return { available: provider !== null, searchingSlotId, find };
```

- [ ] **Step 5: Route the existing button through `slot-search`**

In `apps/web/src/App.tsx`, add to the imports:

```ts
import type { SlotSearchRequest } from './slot-search.js';
import { landSearchResults, slotSearchTarget } from './slot-search.js';
```

Replace the whole `findOptions` function with:

```tsx
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
```

Then update the two props on `<OptionsPanel>`:

```tsx
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
```

- [ ] **Step 6: Typecheck and test**

```bash
npm run typecheck -w @odysseus/web && npm test -w @odysseus/web
```

Expected: PASS with no errors.

- [ ] **Step 7: Confirm nothing moved**

Start the app with the `preview_start` tool (never Bash), open a trip that has cards, select one, and check the panel renders exactly as before: state pills, day picker where applicable, ranking presets, ranked options with deltas and the trip spine, Find/Add/Remove at the bottom. `read_console_messages` must show no errors.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src && git commit -m "Split the panel's detail view out of its shell"
```

---

## Task 4: The tabs and the slot lists

**Files:**
- Create: `apps/web/src/SlotList.tsx`
- Modify: `apps/web/src/OptionsPanel.tsx`
- Modify: `apps/web/src/CardDetail.tsx` (adds the back control)
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/styles.css`

**Interfaces:**
- Consumes: `tripSlots`/`TripSlots` (Task 1), `SlotSearchRequest` (Task 2), `findForSlot` (Task 3), `TravelCard`, `kindsForAnchor`.
- Produces: `SlotList`, `PanelTab`, `TABS`, `tabForKind(kind: CardKind): PanelTab`.

- [ ] **Step 1: Write `SlotList.tsx`**

```tsx
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
```

- [ ] **Step 2: Add the back control to `CardDetail`**

Add `onBack: () => void;` to the props type, and put this as the first child of `<div className="panel__head">`:

```tsx
        <button type="button" className="panel__back" onClick={onBack}>
          ← All {card.kind === 'lodging' ? 'lodging' : `${card.kind}s`}
        </button>
```

- [ ] **Step 3: Rewrite `OptionsPanel` as the tab shell**

```tsx
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
          />
        </div>
      )}
    </aside>
  );
}
```

- [ ] **Step 4: Wire it in `App.tsx`**

Add the imports:

```ts
import { tripSlots } from '@odysseus/domain';
import type { PanelTab } from './SlotList.js';
import { tabForKind } from './SlotList.js';
```

Add tab state beside `selectedCardId`:

```tsx
  const [tab, setTab] = useState<PanelTab>('flights');
```

Add `slots` to the derived memo — replace the return object with:

```tsx
    return {
      schedule,
      budget: computeBudget(trip, schedule),
      placed: placeCards(trip, schedule),
      conflicts: [...schedule.conflicts, ...detectCompatibilityConflicts(trip, schedule)],
      slots: tripSlots(trip, schedule),
    };
```

and destructure it: `const { schedule, budget, placed, conflicts, slots } = useMemo(...)`.

Add the selection helper below it:

```tsx
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
```

Replace every `onSelectCard={setSelectedCardId}` on `<DayView>` and `<StructureView>` with `onSelectCard={selectCard}`, and in `changeHotelsFrom` replace `setSelectedCardId(after.cards[after.cards.length - 1]!.id)` with `selectCard(after.cards[after.cards.length - 1]!.id)`.

Replace the `<OptionsPanel>` element with:

```tsx
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
```

- [ ] **Step 5: Add the styles**

In `apps/web/src/styles.css`, delete the `.panel__empty` rule and append at the end of the panel section:

```css
/* ---------- panel tabs and slot list ---------- */

.panel__tabs {
  display: flex;
  gap: 1px;
  padding: 0 8px;
  border-bottom: 1px solid var(--line);
}

.panel__tab {
  flex: 1;
  background: none;
  border: 0;
  border-bottom: 2px solid transparent;
  padding: 11px 2px;
  color: var(--ink-2);
  font-size: 12px;
}

.panel__tab[aria-selected='true'] {
  color: var(--ink);
  font-weight: 600;
  border-bottom-color: var(--accent);
}

.panel__back {
  background: none;
  border: 0;
  padding: 0 0 9px;
  color: var(--ink-2);
  font-size: 12px;
}

.panel__back:hover {
  color: var(--accent);
}

.slot {
  border-bottom: 1px solid var(--line);
  padding: 13px 0;
}

.slot:last-child {
  border-bottom: 0;
}

.slot__head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 7px;
}

.slot__title {
  font-size: 13px;
  font-weight: 600;
}

.slot__meta {
  font-family: var(--mono);
  font-variant-numeric: tabular-nums;
  font-size: 11px;
  color: var(--ink-3);
  white-space: nowrap;
}

.slot__empty {
  font-size: 12px;
  color: var(--ink-3);
}

.slot__cards {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.slot__tools {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  margin-top: 8px;
}

.slot__tools .btn {
  padding: 5px 9px;
  font-size: 12px;
}
```

- [ ] **Step 6: Typecheck and test**

```bash
npm run typecheck -w @odysseus/web && npm test -w @odysseus/web
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src && git commit -m "Give the panel tabs and a standing list of slots"
```

---

## Task 5: Verify phase 1 in the running app

No code. If anything here fails, fix it and re-run before committing.

- [ ] **Step 1: Start the app**

Use the `preview_start` tool with the dev server from `.claude/launch.json` (create the entry if absent: `npm` / `["run","dev","-w","@odysseus/web"]`). Never start a server with Bash.

- [ ] **Step 2: The blank trip has a way in**

Open a trip with a stop and no cards. Confirm with `read_page`:
- four tabs — Flights, Lodging, Transport, Activities
- Flights shows two rows, `Home → <stop>` and `<stop> → Home`, each reading "Nothing gets you there yet." with **+ Add one you found** and (on desktop only) **Find flights with Claude**
- Lodging shows one row naming the stop and its nights, reading "Nowhere to stay yet."
- Activities shows the stop reading "Nothing planned here yet."

- [ ] **Step 3: Adding by hand works from a row**

Click **+ Add one you found** on the outbound leg. The card editor opens with Flight offered first and Transport still available. Save a flight; confirm it appears in that row, in the day grid, and that the `MISSING CONNECTION` banner drops the leg you filled.

- [ ] **Step 4: Selection routes to the right tab**

Click a lodging card in the day grid. The panel switches to Lodging and opens the detail view unchanged. Click **← All lodging**; the list returns with the tab intact. Click a tab while a detail is open; it goes to that tab's list.

- [ ] **Step 5: No console errors**

`read_console_messages` shows nothing. Take a `screenshot` of the empty-trip panel for the commit message thread.

- [ ] **Step 6: Commit any fixes**

```bash
git add -A && git commit -m "Fix what driving the panel turned up"
```

If nothing needed fixing, skip this step.

---

# Phase 2 — the activity shortlist

Stop here and check in with the user before starting Task 6.

## Task 6: Candidate to card

**Files:**
- Create: `apps/web/src/shortlist.ts`
- Create: `apps/web/src/shortlist.test.ts`

**Interfaces:**
- Produces: `addCandidate(trip: Trip, candidate: Option, segmentId: string, dayOffset: number): Trip | null`. Task 7 consumes it.

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/shortlist.test.ts`:

```ts
import { SCHEMA_VERSION } from '@odysseus/domain';
import type { Option, Trip } from '@odysseus/domain';
import { describe, expect, it } from 'vitest';
import { addCandidate } from './shortlist.js';

const trip: Trip = {
  id: 'trip-1',
  name: 'Lisbon',
  travelers: 2,
  anchorDate: '2027-03-10',
  length: { min: 5, max: 5 },
  currency: 'USD',
  segments: [{ id: 'lis', location: { name: 'Lisbon' }, duration: { min: 5, ideal: 5, max: 5 } }],
  connections: [{ id: 'leg-1', fromSegmentId: null, toSegmentId: 'lis' }],
  cards: [],
  preferences: { ranking: 'balanced', dayStart: '08:00', dayEnd: '22:00' },
  schemaVersion: SCHEMA_VERSION,
};

const candidate: Option = {
  id: 'found-3',
  source: 'discovered',
  title: 'Jerónimos Monastery',
  cost: { kind: 'fixed', amount: 24 },
  sourceUrl: 'https://example.test/jeronimos',
};

describe('addCandidate', () => {
  it('puts one candidate on the day the traveller chose, as its own card', () => {
    const next = addCandidate(trip, candidate, 'lis', 2)!;
    expect(next.cards).toHaveLength(1);

    const card = next.cards[0]!;
    expect(card.kind).toBe('activity');
    expect(card.anchor).toEqual({ kind: 'segment-day', segmentId: 'lis', dayOffset: 2 });
    expect(card.state).toBe('exploring');
    expect(card.options).toHaveLength(1);
    expect(card.options[0]!.title).toBe('Jerónimos Monastery');
    // Provenance survives: it was found by a search, not typed in.
    expect(card.options[0]!.source).toBe('discovered');
    expect(card.options[0]!.sourceUrl).toBe('https://example.test/jeronimos');
    // Chosen, because accepting a candidate onto a named day *is* the choice.
    expect(card.selectedOptionId).toBe(card.options[0]!.id);
  });

  it('renumbers the option against the card it lands on', () => {
    const next = addCandidate(trip, candidate, 'lis', 0)!;
    const card = next.cards[0]!;
    expect(card.options[0]!.id).toBe(`${card.id}-opt-1`);
  });

  it('adds nothing when the stop was deleted while the shortlist sat there', () => {
    expect(addCandidate(trip, candidate, 'gone', 0)).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npm test -w @odysseus/web -- shortlist
```

Expected: FAIL — cannot resolve `./shortlist.js`.

- [ ] **Step 3: Write the implementation**

Create `apps/web/src/shortlist.ts`:

```ts
import { addCard, nextCardId } from '@odysseus/domain';
import type { Card, Option, Trip } from '@odysseus/domain';

/**
 * Accepting one candidate from a "things to do" search.
 *
 * A museum, a beach day and a food tour are not three answers to one question, so they never become
 * competing options on one card. Each is its own slot in the trip, and which day it happens on is
 * the traveller's to say — the search cannot know.
 */

/**
 * Put one candidate on the trip as its own activity card.
 *
 * Null when the stop is gone: the shortlist sits around while the trip stays live, and re-creating
 * a stop the traveller deleted would be worse than losing the candidate.
 *
 * The option is selected, unlike one that lands from a slot search. Nothing was decided *for* the
 * traveller here — they picked this thing and named the day it happens on, which is the same act as
 * typing it in by hand.
 */
export function addCandidate(
  trip: Trip,
  candidate: Option,
  segmentId: string,
  dayOffset: number,
): Trip | null {
  if (!trip.segments.some((s) => s.id === segmentId)) return null;

  const id = nextCardId(trip);
  const optionId = `${id}-opt-1`;
  const card: Card = {
    id,
    kind: 'activity',
    state: 'exploring',
    anchor: { kind: 'segment-day', segmentId, dayOffset },
    options: [{ ...candidate, id: optionId }],
    selectedOptionId: optionId,
  };
  return addCard(trip, card);
}
```

- [ ] **Step 4: Run the tests**

```bash
npm test -w @odysseus/web && npm run typecheck -w @odysseus/web
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/shortlist.ts apps/web/src/shortlist.test.ts && git commit -m "Accept one found activity onto a named day"
```

---

## Task 7: The shortlist in the Activities tab

**Files:**
- Modify: `apps/web/src/SlotList.tsx`
- Modify: `apps/web/src/OptionsPanel.tsx`
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/styles.css`

**Interfaces:**
- Consumes: `addCandidate` (Task 6), `DayChoice` from `./CardEditor.js`, `optionCost` from `./format.js`, `discovery.find` (Task 3).

- [ ] **Step 1: Add the candidate row to `SlotList.tsx`**

Add imports:

```tsx
import type { Option } from '@odysseus/domain';
import { useState } from 'react';
import type { DayChoice } from './CardEditor.js';
import { optionCost } from './format.js';
```

Add the component:

```tsx
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
```

- [ ] **Step 2: Render shortlists in the Activities branch**

Add to `SlotList`'s props type:

```tsx
  /** Found things to do, by segment id. Session state — never written to the trip. */
  shortlists: Readonly<Record<string, readonly Option[]>>;
  daysOfSegment: (segmentId: string) => readonly DayChoice[];
  onAcceptCandidate: (segmentId: string, candidate: Option, dayOffset: number) => void;
  onDismissCandidate: (segmentId: string, candidate: Option) => void;
  onFindThingsToDo: (segmentId: string) => void;
```

Destructure them out of `shared` at the top of `SlotList` so they are not spread onto `Slot`:

```tsx
export function SlotList({
  slots,
  tab,
  shortlists,
  daysOfSegment,
  onAcceptCandidate,
  onDismissCandidate,
  onFindThingsToDo,
  ...shared
}: Shared & {
  slots: TripSlots;
  tab: PanelTab;
  shortlists: Readonly<Record<string, readonly Option[]>>;
  daysOfSegment: (segmentId: string) => readonly DayChoice[];
  onAcceptCandidate: (segmentId: string, candidate: Option, dayOffset: number) => void;
  onDismissCandidate: (segmentId: string, candidate: Option) => void;
  onFindThingsToDo: (segmentId: string) => void;
}) {
```

Replace the final `slots.activities.map(...)` block with:

```tsx
      {slots.activities.map((stop) => {
        const shortlist = shortlists[stop.segmentId] ?? [];
        const busy = shared.searchingSlotId !== null;
        return (
          <div key={stop.id}>
            <Slot
              {...shared}
              title={stop.placeName}
              emptyText="Nothing planned here yet."
              cards={stop.cards}
              anchor={{ kind: 'segment-day', segmentId: stop.segmentId, dayOffset: 0 }}
              kind="activity"
              slotKey={`activities:${stop.segmentId}`}
              addLabel="+ Add something to do"
            />
            {shared.canSearch ? (
              <div className="slot__tools">
                <button
                  type="button"
                  className="btn"
                  disabled={busy}
                  onClick={() => onFindThingsToDo(stop.segmentId)}
                >
                  {shared.searchingSlotId === `activities:${stop.segmentId}`
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
          </div>
        );
      })}
```

- [ ] **Step 3: Pass the new props through `OptionsPanel`**

Add the same five props to `OptionsPanel`'s type and forward them to `<SlotList>` unchanged.

- [ ] **Step 4: Wire `App.tsx`**

Add state and handlers beside `findForSlot`:

```tsx
  /**
   * Things found to do, not yet on the trip.
   *
   * Session state on purpose: a candidate is a suggestion until a day is named for it, and
   * persisting suggestions would fill saved trips with things nobody decided on.
   */
  const [shortlists, setShortlists] = useState<Record<string, readonly Option[]>>({});

  const findThingsToDo = async (segmentId: string) => {
    // The whole stay, not one day — "what is worth doing in Sao Paulo" is not a question about
    // Tuesday. The card is thrown away either way; only its kind and anchor shape the query.
    const asking: Card = {
      id: 'pending',
      kind: 'activity',
      state: 'unplanned',
      anchor: { kind: 'segment', segmentId },
      options: [],
    };
    try {
      const found = await discovery.find(trip, asking, `activities:${segmentId}`);
      if (found.length === 0) {
        setNotice(
          "Claude searched but didn't find anything it could stand behind. Try adding what you " +
            'find by hand.',
        );
        return;
      }
      setShortlists((current) => ({ ...current, [segmentId]: found }));
      setNotice(
        `Found ${found.length} thing${found.length === 1 ? '' : 's'} to consider — none of it is ` +
          'on your trip until you pick a day for it.',
      );
    } catch (error) {
      setNotice(describeExtractionError(error).message);
    }
  };

  const dropCandidate = (segmentId: string, candidate: Option) =>
    setShortlists((current) => ({
      ...current,
      [segmentId]: (current[segmentId] ?? []).filter((o) => o.id !== candidate.id),
    }));

  const acceptCandidate = (segmentId: string, candidate: Option, dayOffset: number) => {
    const next = addCandidate(tripNow.current, candidate, segmentId, dayOffset);
    if (!next) {
      setNotice(`That stop is gone, so ${candidate.title} was not added.`);
      dropCandidate(segmentId, candidate);
      return;
    }
    update(next);
    dropCandidate(segmentId, candidate);
  };
```

Add the imports `import type { Card, Option } from '@odysseus/domain';` (extend the existing type import) and `import { addCandidate } from './shortlist.js';`.

Pass to `<OptionsPanel>`:

```tsx
        shortlists={shortlists}
        daysOfSegment={daysOfSegment}
        onAcceptCandidate={acceptCandidate}
        onDismissCandidate={dropCandidate}
        onFindThingsToDo={(segmentId) => void findThingsToDo(segmentId)}
```

- [ ] **Step 5: Add the candidate styles**

Append to `styles.css`:

```css
.cand {
  border: 1px solid var(--line);
  border-radius: var(--r);
  padding: 9px 11px;
  margin-bottom: 6px;
}

.cand__top {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
}

.cand__title {
  font-size: 13px;
  font-weight: 600;
}

.cand__cost {
  font-family: var(--mono);
  font-variant-numeric: tabular-nums;
  font-size: 12px;
  white-space: nowrap;
}

.cand__detail {
  font-size: 12px;
  color: var(--ink-2);
  margin-top: 3px;
}

.cand__tools {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  margin-top: 8px;
}

.cand__tools .select {
  flex: 1;
  min-width: 108px;
  font-size: 12px;
  padding: 4px 6px;
}

.cand__tools .btn {
  padding: 5px 9px;
  font-size: 12px;
}
```

- [ ] **Step 6: Typecheck and test**

```bash
npm run typecheck -w @odysseus/web && npm test -w @odysseus/web
```

Expected: PASS.

- [ ] **Step 7: Verify in the running app**

With the desktop shell (a search needs the CLI bridge):
- Activities tab, a stop with nights, click **Find things to do in \<stop\>**. Every other search button disables while it runs.
- Candidates appear as a shortlist. **Add to trip** is disabled until a day is chosen.
- Choose a day, add. The card appears in the day grid on that day, the candidate leaves the shortlist, and the trip total moves.
- Dismiss another candidate; it goes and nothing else changes.
- Reload. The shortlist is gone and the added card is still there.
- `read_console_messages` shows nothing.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src && git commit -m "Shortlist found things to do until a day is named"
```

---

## Self-review notes

- Spec's "slot with no card offers Add and, on desktop, Find" — Task 4, `Slot`.
- Spec's "booked cards do not search" — Task 4, `Slot`'s `booked` guard; Task 3 keeps `CardDetail`'s.
- Spec's "one search at a time" — Task 3's single `searchingSlotId`; every `Slot` disables on `busy`.
- Spec's "browser build offers no search" — `canSearch={discovery.available}` in Task 4; `onFindOptions` still spread conditionally.
- Spec's "local transport search is out of scope" — `findLabel` omitted for the local rows in Task 4.
- Spec's "a failed search leaves no trace" — Task 2's `landSearchResults`, tested three ways.
- Spec's "the trip may have moved" — `tripNow.current` in Tasks 3 and 7.
