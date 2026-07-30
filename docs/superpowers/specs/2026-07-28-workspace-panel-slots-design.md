# The Workspace panel — always present, organised by slot

Status: approved 2026-07-28. Extends, and where silent defers to,
`2026-07-25-trip-workspace-design.md` and `2026-07-28-option-discovery-design.md`.

## Why

A trip with no cards is a dead end. The panel renders one line — "Pick anything in the trip to see
what else it could be" — and there is nothing to pick. Every way into the app's central act, adding
and comparing options, is reached by first selecting a card that does not exist. The Claude search
shipped in the last slice is unreachable on exactly the trips that need it most: the empty ones.

The banners above the grid already name what is missing — "Nothing gets you from home to Sao Paulo",
"15 nights in Sao Paulo have nowhere to stay" — and then leave the traveller to find the door
themselves.

The panel should not be a viewer for whatever was last clicked. It should be a standing account of
what the trip is made of and what still has no answer.

## Decisions

| Decision | Choice | Why |
| --- | --- | --- |
| Panel presence | Always tabbed, never empty | The empty state was the bug. `panel__empty` is deleted. |
| Tabs | Flights · Lodging · Transport · Activities | Four kinds the traveller thinks in. `dining` and `note` live under Activities, as they already do in the day grid's third column. |
| Tab contents | Slot list that drills into detail | The list stays scannable at any trip size; the detail view is today's panel body, unchanged. |
| Legs in two tabs | Flights and Transport both list every connection | A connection is one slot that a flight *or* a train fills (`kindsForAnchor`). A Flights tab reading "nothing yet" over a booked train would be false. The tab decides what a search asks for, not which legs exist. |
| Card creation on search | Only when results arrive | An empty result, an error, or the ten-minute timeout leaves the trip untouched. Avoids option-less cards, which `placeCards` skips and the day grid therefore cannot draw. |
| Slot derivation | New pure `tripSlots(trip, schedule)` in `packages/domain` | Structure derivation belongs beside `placeCards` and `stayNights`, is testable without React, and the Structure view will want it. |
| Activity discovery | Shortlist, not options on a card | A museum and a beach day are not competing answers to one slot. Phase 2. |
| Day grid | Untouched | Out of scope by explicit decision, including the hover-fade on `.add--cell`. |

## Shape

```
OptionsPanel            tab shell; owns active tab and drill-down state
  ├── SlotList          rows derived from tripSlots(trip, schedule)
  │     └── SlotRow     what fills it, or what is missing · Add · Find
  └── CardDetail        today's OptionsPanel body, moved wholesale, plus a back arrow
```

The detail view is not redesigned. State pills, day picker, ranking presets, ranked options with
whole-trip impact, source caveats, add/edit/remove — all of it moves across as it stands.

### What each tab lists

| Tab | Slots | A slot with no card reads |
| --- | --- | --- |
| Flights | one per `trip.connections` | `Home → Sao Paulo · nothing yet` |
| Lodging | one per stay in each segment (`staysInOrder`); a segment with no stay yields one empty slot | `Sao Paulo, 15 nights · nowhere to stay` |
| Transport | the same connection slots as Flights, plus a second section of `transport` cards anchored to a `segment-day`, grouped by stop | `Home → Sao Paulo · nothing yet` |
| Activities | existing `activity`, `dining` and `note` cards grouped by stop | `Sao Paulo · nothing planned` |

A filled row shows the chosen option's title and price, or says the card has options but nothing
chosen. On desktop, a slot-shaped row also offers **Find options with Claude**. What Add offers
depends on whether the row already has a card: an empty slot row and every stop-group row (local
transport, activities) offer **Add one you found**, which creates a new card on the anchor. A
*filled* slot-shaped row — a leg or a stay — offers **Add another option** instead, which adds a
second candidate to the card already there rather than a second card on the same anchor. Pressing
Add on a row already showing Hotel Alpha means another candidate for that slot, not a second stay
claiming nights the first one already covers — that ambiguity is exactly what a stop-group row does
not have, since a museum and a beach day are different things, not rival answers to one question.
Rows carry the same conflict badging the day grid uses, so an orphaned or clashing card is visible
from the list.

### Adding by hand from a slot row

**Add one you found**, on an empty slot row or a stop group, opens the existing `CardEditor` on the
slot's anchor, through the same `new-card` path the day grid uses. The kind list is `kindsForAnchor`
for that anchor, reordered so the tab's own kind comes first — reordered, not filtered, or adding a
train from the Flights tab would become impossible. Where the anchor is a `segment-day`, the
editor's day picker owns the day, as it already does.

**Add another option**, on a filled slot-shaped row, instead opens the editor through the
`new-option` path against the card already there. There is only one kind it could possibly be — the
kind of the card it is joining — so `orderedKinds` does not apply on this path; the reordering
problem only exists when a kind still has to be chosen.

### Slot identity

A filled slot is identified by its card id. An empty one is identified by its structural element:
`connection:<connectionId>`, `stay:<segmentId>`, `stop:<segmentId>`. These ids key React rows.

The busy key is not quite the same string. A connection's is suffixed with the tab's kind —
`connection:<connectionId>:flight` or `connection:<connectionId>:transport` — because one leg can
be busy under one tab while merely blocked under the other: searching it as a flight does not stop
a traveller from also asking whether a train gets them there, and a single unsuffixed key would make
the two tabs fight over one busy flag for what are, to the search, two different questions.

### Tabs and selection

The panel opens on Flights. Selecting a card anywhere — day grid, Structure view — switches to the
tab matching its `kind` and opens its detail. Back returns to that tab's list. Removing a card from
the detail view returns to the list, where its slot is now empty.

`transport` on a connection maps to the Transport tab, even though its slot also appears under
Flights. One card, one home.

## Searching a slot that has no card

`buildSearchQuery(trip, card)` reads only the card's `kind`, `anchor` and `options`. So a slot row
builds a card that never enters the trip:

```
SlotRow "Find options"
  → ephemeral card { kind: <tab's kind>, anchor: <slot's anchor>, options: [] }
  → discovery.find(trip, ephemeral)        unchanged provider, unchanged bridge
  ← options
  → addCard(tripNow, { kind, anchor, options: [], state: 'unplanned' })
  → applyDiscovery(trip, newCardId, found) unchanged
```

Nothing in `packages/providers`, `packages/extraction`, or the bridge changes. Two small changes in
`apps/web`:

- `useDiscovery.searchingCardId` becomes `searchingSlotId`, an opaque busy key, so a slot with no
  card can hold it. `find` takes the key alongside the card.
- The ephemeral-card construction and the create-then-apply sequence live in a new pure module,
  `apps/web/src/slot-search.ts`, not in the component — the app has no React test infrastructure,
  and this is the part that must be tested.

`applyDiscovery` already promotes a card from `unplanned` to `exploring` when options land, which is
exactly right for a card born this way.

## Phase 2 — the activity shortlist

"Find things to do in Sao Paulo" returns a museum, a beach day and a food tour. They are not three
answers to one question, so they do not become options on a card.

Per stop, the Activities tab offers **Find things to do**. The search runs with an ephemeral card of
kind `activity` anchored to the `segment`, which yields a query carrying the place and the whole
stay's dates. `KIND_TASK` already covers `activity`; nothing in extraction changes.

Results land in a **shortlist** under that stop. Each candidate shows its title, price, detail and
source link, alongside a placeholder-only day picker reading "Which day?" and a separate **Add to
trip** button; choosing a day creates one `activity` card on the day chosen. **The picker has no
default and adding is blocked until a day is chosen.** An activity silently landing on day one is
the bug that put a 09:30 tour on the morning of an 08:45 landing; the day picker in the detail view
exists because of it, and this must not reintroduce it.

The accepted candidate *is* selected on its new card, unlike an option landing from a slot search.
Nothing was decided for the traveller: they picked this thing and named the day it happens on, which
is the same act as typing it in by hand. Its `source` stays `discovered` — provenance is not a
decision.

The shortlist is session state. It does not survive a reload, and the empty-shortlist copy says so.
Dismissing a candidate removes it from the list and nothing else.

Candidate ids are re-stamped per search batch (`stampCandidates`), not kept as the search returned
them. The search mints its ids against a throwaway card — the same ephemeral-card trick as an
options search, described above — and that card is identical on every "find things to do" call, so
every batch comes back with the same `pending-opt-1`, `pending-opt-2`, … no matter what it actually
found. `CandidateRow` keys on `candidate.id`, so without re-stamping, a second search's rows would
reuse the first search's React instances, and the day already chosen on the old candidate would
survive onto whatever different activity the new search put in its place. That is exactly what the
no-default rule above exists to prevent, so it would otherwise look like it survives a re-search for
free when it does not; `stampCandidates` gives each batch ids unique enough that React never
confuses the two.

The conversion — candidate plus segment and day offset to a card — lives in
`apps/web/src/shortlist.ts` as a pure function, for the same reason as `slot-search.ts`.

## Rules the implementation must keep

- **Slots are derived, never stored.** `tripSlots` reads the trip and the schedule and returns a
  fresh answer. A slot list that could disagree with the day grid is a second source of truth.
- **A failed search leaves no trace.** No card, no option, no state change. The notice says what
  happened, using the existing `describeExtractionError` copy.
- **The trip may have moved.** A search runs for minutes. Results apply to the trip as it is when
  they arrive — the `tripNow` ref pattern already in `Workspace` — and a slot whose connection or
  segment no longer exists reports that nothing was added, as the card-gone path already does.
- **Nothing is chosen for the traveller.** Unchanged from the discovery spec: options land
  unselected, and a card created by a search is `exploring`, never `selected`.
- **One search at a time.** The busy key is single-valued, as `searchingCardId` was.
- **The browser build offers no search.** No bridge, no Find button — the tabs and slot lists work
  regardless, and Add is always available.
- **Booked cards do not search.** The detail view's existing guard stands; a slot row for a booked
  card offers no Find.
- **The detail view is moved, not rewritten.** Any change to how an option reads is a different
  slice.

## Testing

- `tripSlots` in `packages/domain`: empty trip, trip with connections and no cards, split stays,
  a connection filled by a `transport` card, a segment shortened until a stay is orphaned.
- `slot-search.ts` in `apps/web`: ephemeral card shape per tab and anchor; create-then-apply lands
  options on a new card; a vanished connection adds nothing.
- `shortlist.ts` in `apps/web` (phase 2): candidate to card with the chosen day offset.
- Component behaviour is verified by driving the running app, as the Workspace already is.

## Out of scope

The day grid, including `.add--cell` hover-fade. Redesigning the option detail view. Searching for
local transport (same one-slot-many-things problem as activities; defer with it). Whole-trip
sweeps. Auto-search. Persisting the shortlist. Any change to `packages/providers`,
`packages/extraction`, or the bridge.
