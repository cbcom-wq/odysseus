# Trip Workspace — Slice 1 Design

**Project:** Odysseus
**Date:** 2026-07-25
**Status:** Approved for implementation
**Supersedes:** the stack described in `docs/design/high_level_sw_architecture.md`

---

## 1. Purpose

The Workspace is where a chosen destination becomes a designed trip.

It is not a place to arrange things you have already booked. It is the environment where every part
of the trip is still **an open question with competing answers** — flights, hotels, trains,
activities — and each candidate differs in **timing, price, and value**. The work the user is doing
is evaluation:

> Which of these flights is actually better, *for this trip*?

That qualifier is the whole product. Any site can sort flights by price. Only the Workspace knows
that the cheaper one lands at 7 PM and costs you an evening in Amsterdam, pushes your canal cruise
into a conflict with the next morning's train, and saves less than the hotel night it wastes.

Committing — Locked, Booked — is what happens at the *end* of that process. It is a policy flag that
quiets the system down about a slot. It is not the reason the Workspace exists.

### In scope for slice 1

- Structure view ↔ Day view, one model, live reflow
- Select a card → ranked alternatives with **trip-level impact** → swap → whole trip recalculates
- Live budget rollup
- Planning states, including lock semantics
- Conflicts surfaced as first-class, explainable output

### Out of scope — designed for, built later

Standalone optimization suggestion strip · side-by-side compare view · map view · AI assistant ·
Trip Explorer · Collections · documents and OCR.

---

## 2. Decisions that override the existing design docs

| Question | Decision | Rationale |
|---|---|---|
| Option data | Fixture provider now; user override always wins; real APIs and AI-assist later behind the same interface | Live pricing is gated behind commercial agreements. Blocking the novel UX on it would be backwards. |
| Planning model | One location-based model with flexible durations. The dated day grid is a **derived view**. | `trip_workspace_design_document.md` §3–4 and §5 describe two different UIs. They are two lenses on one model, not two products. |
| Stack | TypeScript end-to-end | Portability to desktop, web, and mobile was a stated goal. A Python sidecar inside Electron fights that goal on every axis. |
| Storage | One readable JSON file per trip; IndexedDB behind the same interface for the browser | Local-first in the honest sense: openable, diffable, backup-able, hand-editable. |
| Option ranking | Trip-level impact vector, ranked by a weighted sum with visible preset weights | "Optimize the whole trip" is a stated design principle. Per-slot ranking cannot express it. |

### Open question

The mockups are branded **WanderWise**; the repo and `CLAUDE.md` say **Odysseus**. This spec uses
Odysseus. Settle before UI work begins — it lands in the shell, window title, and package names.

---

## 3. Domain model

### 3.1 The Card / Option split

The design docs use "card" for two distinct things. Separating them is the move that makes both the
comparison loop and the planning lifecycle fall out cleanly.

- **Card** — a *slot* in the trip. "We need lodging in Paris." Owns the planning `state`, its anchor,
  and which option is currently chosen.
- **Option** — a *candidate* that could fill the slot. "Hotel Alpha, $110/night." Owns cost, timing,
  and attributes.

Swapping an alternative sets `card.selectedOptionId`. The planning state is untouched. This is what
makes "I've settled on staying in Paris, but I'm still comparing hotels" a coherent thing to express.

### 3.2 Entities

```ts
Trip        id, name, travelers, anchorDate?, length {min, max}, currency,
            segments[], connections[], preferences, schemaVersion
Segment     id, location, duration {min, ideal, max}, cards[]
Connection  id, fromSegmentId, toSegmentId, card
Card        id, kind, state, anchor, selectedOptionId?, options[]
Option      id, source, cost, timing?, attributes
```

- `kind` — `flight | lodging | transport | activity | dining | note`
- `state` — `unplanned | exploring | selected | locked | booked`
- `source` — `fixture | user`

`Trip.length` is a night range; when the length is exact, `min === max`. `anchorDate` may be absent —
an undated trip schedules to relative days (Day 1, Day 2, …) and everything else still works. That is
the "start flexible" requirement honored in the model rather than bolted on.

**Anchors.** A card's `anchor` says what it is attached to, and it must survive reflow — anchoring to
an absolute date would break the moment an upstream option changes. Three forms:

```ts
{ kind: 'segment',     segmentId }              // lodging, "somewhere in Paris"
{ kind: 'segment-day', segmentId, dayOffset }   // activity, "day 2 of Paris"
{ kind: 'connection',  connectionId }           // transport between segments
```

`dayOffset` is relative to the segment's arrival day. When a segment compresses below an activity's
offset, the activity is **orphaned**, not deleted — it surfaces in the Structure view as unscheduled
so the user decides. Silently dropping a user's plan is never acceptable.

### 3.3 Planning state governs policy, not scheduling

This is the distinction the original design docs blur, and getting it wrong makes the whole model
incoherent. Two **orthogonal** axes:

| Axis | Source | Governs |
|---|---|---|
| **Timing** | The selected option's concrete times | Where things land on the calendar |
| **Policy** | The card's planning state | Whether the system may suggest or apply changes |

A flight you are merely *Exploring* still lands at a specific hour, and therefore still determines
what day you reach Amsterdam. Scheduling reads option timing, always, regardless of state.

State governs only this:

| State | May the system rank alternatives? | May the system auto-apply a change? | Mutable? |
|---|---|---|---|
| `unplanned` | yes — nothing chosen yet | n/a | yes |
| `exploring` | yes, prominently | no | yes |
| `selected` | yes | no | yes |
| `locked` | yes, on request | no | yes |
| `booked` | yes, on request | no | **no** — requires explicit unlock |

Locking never hides alternatives. "It's locked, but show me what I'd be giving up" stays available;
locking only stops the system from volunteering. Booked additionally guards mutation, since a booked
card has real money behind it.

---

## 4. The two layers

```
Structure layer (authored)              Schedule layer (derived)
Trip                                     Sep 23  AMS  Hotel Alpha  Canal Cruise  $832
 ├ Segment  Amsterdam   2–4 nights  ──▶  Sep 24  AMS  Hotel Alpha  Van Gogh      $152
 ├ Connection  train                     Sep 25  BRU  Hotel Bravo  Grand Place   $197
 └ Segment  Brussels    2–3 nights       …
```

You author the structure and choose options. The scheduler derives the days. The day grid is never a
second source of truth — that is what keeps "start flexible, become concrete" from requiring two
separate applications.

---

## 5. The scheduler

The load-bearing algorithm. Deliberately **not** a general constraint solver.

### 5.1 Day arithmetic

Each segment has `resolvedNights` — the nights you sleep there. Its start day is your arrival day.
The departure day is shared with the next segment's arrival:

```
segment[i+1].startDay = segment[i].startDay + segment[i].resolvedNights
totalNights           = Σ resolvedNights
totalDays             = totalNights + 1
```

A connection is anchored to the transition day: `segment[i].startDay + segment[i].resolvedNights`.

Verified against `docs/design_concept_images/trip_workspace_view.png`:

| Segment | Nights | Start | Derived transition | Mockup shows |
|---|---|---|---|---|
| Amsterdam | 2 (Sep 23, 24) | Sep 23 | Sep 25 | Train to Brussels on Sep 25 ✓ |
| Brussels | 2 (Sep 25, 26) | Sep 25 | Sep 27 | Flight to Paris on Sep 27 ✓ |
| Paris | — | Sep 27 | — | Hotel Lumière Sep 27 – Oct 2 ✓ |

The mockup and this arithmetic agree exactly.

**Overnight connections.** A transport option carries `nightsInTransit: 0 | 1`, shifting the
downstream boundary by that amount. Same-day trains and short hops are `0`; red-eyes and night trains
are `1`.

The *inbound* leg into segment 0 is a different case: it does not connect two segments, it only pins
`B_0`. The arrival date pins the boundary; the departure date is display metadata on the card. The
mockup's ORD→AMS departs Sep 23 at 7:45 PM and lands the morning of Sep 24, yet the grid shows Sep 23
as Day 1 with Hotel Alpha checking in that night — a small inconsistency in the mockup. The fixture
resolves it by pinning `B_0 = Sep 23`, keeping every downstream date in the table above intact. The
same applies in reverse to the outbound return leg and `B_k`.

### 5.2 Boundaries and pins — the simplification

Define boundaries `B_0 … B_k`, where `B_0` is the trip start, `B_i` is the start of segment `i`, and
`B_k` is the trip end. By construction `B_{i+1} − B_i = nights_i`.

**Pins come from selected option timing, not from planning state.** Any card holding an option with
concrete times contributes a pin, whether it is Exploring or Booked. Every such constraint reduces to
the same statement: *"boundary `B_j` is fixed to date `D_j`."*

| Card holding a timed option | Pin produced |
|---|---|
| Inbound leg into segment 0 | `B_0 = first night in segment 0` (see §5.1) |
| Transport on the connection between segment *i* and *i+1* | `B_{i+1} = departure date` |
| Lodging within segment *i* | `B_i = check-in date`, and `nights_i ≥ checkOut − checkIn` |
| Return leg after the last segment | `B_k = departure date` |

A segment whose lodging covers its full stay is handled by folding it into the same math as
`min = max = forced`. No special case in the solver.

So the entire scheduling problem is:

> Choose `nights_i ∈ [min_i, max_i]` such that for every pinned pair of boundaries `(B_a, B_b)`,
> `Σ nights_a…nights_{b−1} = D_b − D_a`.

### 5.3 Algorithm

1. Build the boundary list; collect pins from every card with a timed selected option.
2. Validate pins: chronologically ordered, no boundary pinned to two different dates. Otherwise emit
   `CONTRADICTORY_PINS`.
3. For each span between consecutive pinned boundaries `a < b`:
   - `available = D_b − D_a`, `minSum = Σ min_i`, `maxSum = Σ max_i`
   - `available < minSum` → `INSUFFICIENT_TIME`
   - `available > maxSum` → `EXCESS_TIME`
   - otherwise: seed each segment at `min_i`, then distribute `available − minSum` in proportion to
     `(ideal_i − min_i)`, using **largest remainder** with segment index as a stable tiebreak, capped
     at `max_i`.
4. Unpinned tail (or a wholly unpinned trip): use `ideal_i`, then clamp toward `Trip.length`. If the
   result falls outside that range, emit `TRIP_LENGTH_MISMATCH`.

Largest-remainder with a stable tiebreak gives integer nights and **deterministic** output — same
input, same schedule, every time. Determinism is not a nicety here: §6 depends on it.

### 5.4 Explanations

The scheduler returns not just nights but *why*, per segment:

```ts
{ segmentId, nights,
  reason: 'ideal' | 'at-minimum' | 'at-maximum'
        | 'compressed-to-fit' | 'expanded-to-fit' | 'pinned-by-option',
  pinnedBy?: cardId }
```

This is what lets the Structure view explain itself instead of silently moving numbers around.

### 5.5 Conflicts are output, not errors

Two families. The second is the one users will actually hit while comparing.

**Capacity conflicts** — `INSUFFICIENT_TIME`, `EXCESS_TIME`, `CONTRADICTORY_PINS`,
`TRIP_LENGTH_MISMATCH`.

**Compatibility conflicts** — two selected options that cannot coexist:

- `TIMING_OVERLAP` — the walking tour runs to 10:00, the train departs 08:41
- `IMPOSSIBLE_TRANSFER` — the flight lands at 18:40, the connection departs 19:05 from another city
- `UNCOVERED_NIGHT` — a night in a segment with no lodging option selected
- `ORPHANED_CARD` — an activity whose `dayOffset` no longer exists after a reflow

Each conflict names the cards involved, the segments affected, and which cards still have flexibility
— that last part is what makes a conflict actionable rather than merely annoying:

> Your train to Brussels departs 08:41, but the Grand Place walking tour you selected runs until
> 10:00. The tour is Exploring; the train is Selected. Either can move.

### 5.6 Budget rollup

Pure derivation over selected options → per-day, per-category, and trip totals. No totals stored
anywhere; always recomputed from the model.

---

## 6. Option evaluation — the heart of the Workspace

Ranking alternatives by their own price is what every booking site already does, and it is precisely
what the Workspace exists not to do. An option is evaluated by **what it does to the whole trip**.

### 6.1 Speculative apply and diff

Because `domain` is pure and the scheduler is deterministic, this needs no separate estimation model:

```
applyOption(trip, cardId, optionId) → trip′
diffTrips(trip, trip′)             → TripImpact
```

The "what if" and the "what is" run identical code, so the preview can never drift from the result.
This is the concrete payoff of the zero-I/O constraint on `domain`, and it is worth protecting.

### 6.2 The impact vector

```ts
TripImpact {
  costDelta            number      // whole-trip, not just this slot
  transitTimeDelta     minutes
  usableHoursDelta     hours       // waking hours at destination, not in transit
  conflictsIntroduced  Conflict[]
  conflictsResolved    Conflict[]
  cardsOrphaned        CardRef[]
  scheduleShift        SegmentDateChange[]
}
```

`usableHoursDelta` is what turns a timestamp into a reason. A flight landing 11:35 instead of 19:00
is not "7½ hours earlier" — it is *an evening in Amsterdam you get back*, computed against the
segment's day boundaries. This is the number that makes the panel feel like it understands the trip.

Note that `costDelta` is whole-trip. An option that costs $40 more but removes a hotel night is
cheaper, and only a trip-level diff can see that. This directly implements the design principle
*"Every recommendation should consider the impact on the entire vacation."*

### 6.3 Ranking

A weighted sum over the impact vector. Weights come from a **visible preset** on `Trip.preferences` —
the Explorer mockup already names these under Budget Style:

| Preset | Emphasis |
|---|---|
| Best Value | cost, weighted against usable hours |
| Balanced | even |
| Comfort | usable hours and transit time over cost |

Two rules, both non-negotiable:

- Any option introducing a conflict is **demoted and badged**, never silently hidden. The user decides
  whether the conflict is worth it.
- The score is always expandable into the raw deltas that produced it. A number the user cannot
  interrogate is a number they will not trust, and the design docs are explicit about this.

The panel displays deltas; the score only orders the list.

---

## 7. Package layout

```
packages/
  domain/        pure TS — entities, state machine, scheduler, impact diff, budget. Zero I/O.
  providers/     OptionProvider interface + FixtureProvider + fixture data
  persistence/   Repository interface + FileRepository + IndexedDbRepository
apps/
  web/           React + Vite — the entire UI
  desktop/       Electron shell wrapping apps/web
```

`domain/` importing nothing framework-shaped is the load-bearing constraint. It makes the scheduler
testable, makes §6 possible at all, and lets identical logic run in a browser, in Electron, and later
on a server.

### 7.1 Providers

`OptionProvider`: given a card and trip context, return candidate options. **Ranking is not the
provider's job** — providers supply candidates, `domain` evaluates them. A provider that ranked its
own results could not see the trip.

`FixtureProvider` seeds the Europe trip from the mockup — ORD→AMS, Hotel Alpha, train to Brussels,
Hotel Bravo, flight to Paris, Hotel Lumière.

**The fixture data is load-bearing, not filler.** If comparison is the point, alternatives that differ
only in price make for a dead demo. Every card needs candidates that genuinely trade off:

- a cheaper flight that lands at night and costs an evening
- a pricier one that arrives in time for the canal cruise
- a hotel $40/night more that removes a taxi and a transfer
- a train and a flight for the same leg, trading cost against hours
- at least one option that *introduces a conflict*, so demotion and badging are exercised

User-authored options are a **peer source** and always outrank fetched ones; a provider refresh must
never overwrite them. Amadeus, Duffel, and AI-assist arrive later as additional providers, and
nothing in `domain` or the UI should need to change when they do.

### 7.2 Persistence

`Repository` — load, save, list. `FileRepository` writes one readable `.json` per trip for Electron;
`IndexedDbRepository` backs the browser build. A `schemaVersion` field is written from the very first
save; migrating stored trips is the predictable future pain and the field costs nothing now.

---

## 8. Interface

Both views project the same model, and the same card component renders in both.

**Options panel — the primary surface of slice 1.** Select a card → ranked alternatives, each row
showing its trip-level deltas, not just its price → swap → the whole trip recalculates. Conflict-
introducing options appear demoted with a badge explaining what breaks. Scores expand into the deltas
behind them. Slice 1 ships the Alternatives tab; Insights ships with the optimization work.

**Day view** — the mockup grid. Rows are dates from scheduler output; columns are Travel / Lodging /
Activities / Notes / Daily Cost. Follow `trip_workspace_view.png` closely; it is a good design.

**Structure view** — ordered location rows; a duration control bounded by `min`/`max`; resolved night
count with its explanation; cost rollup; cards grouped by kind. Segments reorder by drag. Conflicts
and orphaned cards render inline on the offending segment.

**View toggle** must preserve card selection across the switch. These are two lenses on one trip, and
dropping the selection undercuts exactly the thing the feature demonstrates.

**Entry points** — a one-click seeded demo trip, and a minimal create flow (name, travelers, rough
length, first destinations). The create flow forces the empty-state design now rather than as a
retrofit later.

---

## 9. Testing

Risk is concentrated in `packages/domain`, so it is written test-first. The tests that encode the
product claim:

- Option timing drives scheduling regardless of planning state — an Exploring flight pins dates
  exactly as a Booked one does.
- Booked cards reject mutation without an explicit unlock.
- Resolved nights always respect `[min, max]`, or a conflict is raised — never silently clamped.
- Changing one option reflows only what genuinely depends on it.
- Infeasible configurations produce conflicts, not truncation and not crashes.
- Scheduling is deterministic across repeated runs.
- `applyOption` followed by `diffTrips` produces exactly the state the user gets after a real swap —
  preview and reality cannot diverge.
- Whole-trip `costDelta` catches the case where a pricier option lowers the total by removing a night.
- The mockup trip round-trips: the fixture's structure produces exactly the dates in
  `trip_workspace_view.png`.

The last one is a good canary — it ties the algorithm to the design we are actually trying to build.

---

## 10. Build order

1. `packages/domain` — entities, state machine, scheduler, conflicts
2. `packages/domain` — impact diff and ranking (§6), which depends on a working scheduler
3. `packages/providers` — interface and the fixture dataset
4. `packages/persistence` — repository and adapters
5. `apps/web` — Options panel first, then Day view, then Structure view
6. `apps/desktop` — Electron shell

Steps 1–4 are fully testable with no UI. The React work should not begin until the scheduler and
impact tests pass; if that logic is wrong, every interface decision built on top of it is built on
sand.
