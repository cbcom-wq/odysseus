# Trip Workspace — Slice 1 Design

**Project:** Odysseus
**Date:** 2026-07-25
**Status:** Approved for implementation
**Supersedes:** the stack described in `docs/design/high_level_sw_architecture.md`

---

## 1. Purpose

The Workspace is the novel part of Odysseus and the right place to start building.

Every planning tool on the market assumes you either know your dates or you don't. Odysseus claims
something different:

> Flights are booked. Hotels are locked. Transit is still being explored. Activities are unplanned.
> Now find me the best trip inside what's left.

Slice 1 exists to prove that mechanic is real and feels good. Nothing else.

### In scope

- Structure view ↔ Day view, one model, live reflow
- Five planning states, with scheduling that routes around Locked and Booked
- Select a card → ranked alternatives → swap → trip recalculates
- Live budget rollup
- Conflicts surfaced as first-class, explainable output

### Out of scope — designed for, built later

Optimization suggestion strip · Value Score · map view · AI assistant · Trip Explorer · Collections ·
documents and OCR.

---

## 2. Decisions that override the existing design docs

| Question | Decision | Rationale |
|---|---|---|
| Option data | Fixture provider now; user override always wins; real APIs and AI-assist later behind the same interface | Live flight/hotel pricing is gated behind commercial agreements. Blocking the novel UX on it would be backwards. |
| Planning model | One location-based model with flexible durations. The dated day grid is a **derived view**. | `trip_workspace_design_document.md` §3–4 and §5 describe two different UIs. They are two lenses on one model, not two products. |
| Stack | TypeScript end-to-end | Portability to desktop, web, and mobile was a stated goal. A Python sidecar inside Electron fights that goal on every axis. |
| Storage | One readable JSON file per trip; IndexedDB behind the same interface for the browser | Local-first in the honest sense: openable, diffable, backup-able, hand-editable. |

### Open question

The mockups are branded **WanderWise**; the repo and `CLAUDE.md` say **Odysseus**. This spec uses
Odysseus. Settle before UI work begins — it lands in the shell, window title, and package names.

---

## 3. Domain model

### 3.1 The Card / Option split

The design docs use "card" for two distinct things. Separating them is the move that makes both the
lifecycle and the Alternatives panel fall out cleanly.

- **Card** — a *slot* in the trip. "We need lodging in Paris." Owns the planning `state`, its anchor,
  and which option is currently chosen.
- **Option** — a *candidate* that could fill the slot. "Hotel Alpha, $110/night." Owns cost, timing,
  and attributes.

Swapping an alternative sets `card.selectedOptionId`. The planning state is untouched. This is what
makes "it's locked, but show me what else is out there" a coherent thing to say.

### 3.2 Entities

```ts
Trip        id, name, travelers, anchorDate?, length {min, max}, currency,
            segments[], connections[], schemaVersion
Segment     id, location, duration {min, ideal, max}, cards[]
Connection  id, fromSegmentId, toSegmentId, card
Card        id, kind, state, anchor, selectedOptionId?, options[]
Option      id, source, cost, timing?, attributes
```

- `kind` — `flight | lodging | transport | activity | dining | note`
- `state` — `unplanned | exploring | selected | locked | booked`
- `source` — `fixture | user`

**Anchors.** A card's `anchor` says what it is attached to, and it must survive reflow — anchoring to
an absolute date would break the moment a duration changes upstream. Three forms:

```ts
{ kind: 'segment',    segmentId }                      // lodging, "somewhere in Paris"
{ kind: 'segment-day', segmentId, dayOffset }          // activity, "day 2 of Paris"
{ kind: 'connection', connectionId }                   // transport between segments
```

`dayOffset` is relative to the segment's arrival day. When a segment is compressed below an activity's
offset, the activity is **orphaned**, not deleted — it surfaces in the Structure view as unscheduled
so the user decides. Silently dropping a user's plan is never acceptable.

`Trip.length` is a night range; when the trip length is exact, `min === max`. `anchorDate` may be
absent — an undated trip schedules to relative days (Day 1, Day 2, …) and everything else still
works. That is the "start flexible" requirement, honored in the model rather than bolted on.

### 3.3 Planning state machine

An explicit transition table, not scattered conditionals. Two rules carry real weight:

- `locked` and `booked` contribute **hard date pins** to the scheduler.
- `booked` additionally rejects mutation unless explicitly unlocked first.

Everything else about a booked card stays readable and swappable-in-principle; the guard is on
mutation, not on inspection.

---

## 4. The two layers

```
Structure layer (authored)              Schedule layer (derived)
Trip                                     Sep 23  AMS  Hotel Alpha  Canal Cruise  $832
 ├ Segment  Amsterdam   2–4 nights  ──▶  Sep 24  AMS  Hotel Alpha  Van Gogh      $152
 ├ Connection  train                     Sep 25  BRU  Hotel Bravo  Grand Place   $197
 └ Segment  Brussels    2–3 nights       …
```

You author the structure. The scheduler derives the days. The day grid is never a second source of
truth — that is what keeps "start flexible, become concrete" from requiring two separate apps.

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

**Overnight connections.** A transport option carries `nightsInTransit: 0 | 1`, which shifts the
downstream boundary by that amount. Same-day trains and short hops are `0`; red-eyes and night trains
are `1`. The mechanism matters for inter-segment moves.

The *inbound* leg into segment 0 is a different case: it does not connect two segments, it only pins
`B_0`. So the arrival date is what pins the boundary, and the departure date is display metadata on
the card. The mockup's ORD→AMS departs Sep 23 at 7:45 PM and lands the morning of Sep 24, but the
grid shows Sep 23 as Day 1 with Hotel Alpha checking in that night — a small inconsistency in the
mockup. The fixture resolves it by pinning `B_0 = Sep 23`, which keeps every downstream date in §5.1
matching the design. The same applies in reverse to the outbound return leg and `B_k`.

Verified against `docs/design_concept_images/trip_workspace_view.png`:

| Segment | Nights | Start | Derived transition | Mockup shows |
|---|---|---|---|---|
| Amsterdam | 2 (Sep 23, 24) | Sep 23 | Sep 25 | Train to Brussels on Sep 25 ✓ |
| Brussels | 2 (Sep 25, 26) | Sep 25 | Sep 27 | Flight to Paris on Sep 27 ✓ |
| Paris | — | Sep 27 | — | Hotel Lumière Sep 27 – Oct 2 ✓ |

The mockup and this arithmetic agree exactly.

### 5.2 Boundaries and pins — the simplification

Define boundaries `B_0 … B_k`, where `B_0` is the trip start, `B_i` is the start of segment `i`, and
`B_k` is the trip end. By construction `B_{i+1} − B_i = nights_i`.

Every hard pin, whatever its source, reduces to *"boundary `B_j` is fixed to date `D_j`"*:

| Locked/booked card | Pin produced |
|---|---|
| Inbound flight into segment 0 | `B_0 = first night in segment 0` (see §5.1 on inbound legs) |
| Transport on the connection between segment *i* and *i+1* | `B_{i+1} = departure date` |
| Lodging within segment *i* | `B_i = check-in date`, and `nights_i ≥ checkOut − checkIn` |
| Return flight after the last segment | `B_k = departure date` |

A segment whose lodging is locked for its full stay is handled by folding it into the same math as
`min = max = forced`. No special case in the solver.

So the entire scheduling problem is:

> Choose `nights_i ∈ [min_i, max_i]` such that for every pinned pair of boundaries `(B_a, B_b)`,
> `Σ nights_a…nights_{b−1} = D_b − D_a`.

### 5.3 Algorithm

1. Build the boundary list; collect pins from every `locked`/`booked` card.
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
input, same schedule, every time. That is a testable property, and it is worth protecting.

### 5.4 Explanations

The scheduler returns not just nights but *why*, per segment:

```ts
{ segmentId, nights,
  reason: 'ideal' | 'at-minimum' | 'at-maximum'
        | 'compressed-to-fit' | 'expanded-to-fit' | 'pinned-by-locked-card',
  pinnedBy?: cardId }
```

This is what lets the Structure view explain itself instead of silently moving numbers around.

### 5.5 Conflicts are output, not errors

`INSUFFICIENT_TIME` · `EXCESS_TIME` · `CONTRADICTORY_PINS` · `TRIP_LENGTH_MISMATCH`

Each conflict names the segments involved, the locked cards responsible, and — critically — which
segments still have flexibility. The user-facing payoff is a sentence like:

> Your booked return is Oct 7, but your minimum durations need 16 nights and you have 14.
> Tuscany and Rome are the only unlocked segments.

That sentence *is* the product. Model conflicts richly enough to render it.

### 5.6 Budget rollup

Pure derivation over selected options → per-day, per-category, and trip totals. No totals stored
anywhere; always recomputed from the model.

---

## 6. Package layout

```
packages/
  domain/        pure TS — entities, state machine, scheduler, budget. Zero I/O.
  providers/     OptionProvider interface + FixtureProvider + fixture data
  persistence/   Repository interface + FileRepository + IndexedDbRepository
apps/
  web/           React + Vite — the entire UI
  desktop/       Electron shell wrapping apps/web
```

`domain/` importing nothing framework-shaped is the load-bearing constraint. It is what makes the
scheduler testable, and what lets identical logic run in a browser, in Electron, and later on a
server.

### 6.1 Providers

`OptionProvider`: given a card and trip context, return ranked candidate options.

- `FixtureProvider` seeds the Europe trip from the mockup — ORD→AMS, Hotel Alpha, train to Brussels,
  Hotel Bravo, flight to Paris, Hotel Lumière — plus plausible alternatives per card so the panel has
  real content to show.
- User-authored options are a **peer source** that always outranks fetched ones. A provider refresh
  must never overwrite them.
- Ranking in slice 1 is a transparent per-kind comparator, primarily cost, always showing the delta
  against the current selection. Value Score is deliberately absent.

Amadeus, Duffel, and AI-assist arrive later as additional providers. Nothing in `domain` or the UI
should need to change when they do.

### 6.2 Persistence

`Repository` — load, save, list. `FileRepository` writes one readable `.json` per trip for Electron;
`IndexedDbRepository` backs the browser build. A `schemaVersion` field is written from the very first
save; migrating stored trips is the predictable future pain and the field costs nothing now.

---

## 7. Interface

Both views project the same model, and the same card component renders in both.

**Structure view** — ordered location rows; a duration control bounded by `min`/`max`; resolved night
count with its explanation; cost rollup; cards grouped by kind. Segments reorder by drag. Conflicts
render inline on the offending segment.

**Day view** — the mockup grid. Rows are dates from scheduler output; columns are Travel / Lodging /
Activities / Notes / Daily Cost. Follow `trip_workspace_view.png` closely; it is a good design.

**Options panel** — select a card → ranked alternatives with cost deltas → swap → trip recalculates
and the budget updates. Alternatives tab only in slice 1; Insights ships with the optimization work.

**View toggle** must preserve card selection across the switch. These are two lenses on one trip, and
dropping the selection undercuts exactly the thing the feature is meant to demonstrate.

**Entry points** — a one-click seeded demo trip, and a minimal create flow (name, travelers, rough
length, first destinations). The create flow forces the empty-state design now rather than as a
retrofit later.

---

## 8. Testing

Risk is concentrated in `packages/domain`, so it is written test-first. The tests that encode the
product claim:

- Locked and booked cards never move, under any reflow.
- Resolved nights always respect `[min, max]`, or a conflict is raised — never silently clamped.
- Changing one segment's duration reflows only unpinned neighbours.
- Infeasible configurations produce conflicts, not truncation and not crashes.
- Scheduling is deterministic across repeated runs.
- The mockup trip round-trips: the fixture's structure produces exactly the dates in
  `trip_workspace_view.png`.

That last one is a good canary — it ties the algorithm to the design we are actually trying to build.

---

## 9. Build order

Steps 1–3 are backend-shaped and fully testable with no UI. The React work should not begin until the
scheduler's lock and conflict tests pass. If that logic is wrong, every interface decision built on
top of it is built on sand.
