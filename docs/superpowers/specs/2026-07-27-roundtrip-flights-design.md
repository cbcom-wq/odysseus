# Round-trip flights and one-way screenshots

**Status:** approved, ready to implement
**Date:** 2026-07-27
**Extends:** `2026-07-25-trip-workspace-design.md`

## Problem

A round-trip fare is one purchase that fills two slots. The model has no way to say so.

Two failures follow. First, a traveller who buys a $1,304 return fare has to enter it as two cards,
and the budget reads $2,608 — or they enter it once and half the trip has no flight. Second, the
booking sites people actually paste from show a round-trip price against *only the outbound leg's*
times. All three example screenshots do this. Imported as-is, the trip silently acquires a fare with
no return.

## Non-goals

Multiple *alternatives* in one screenshot — three competing flights for the same leg — is a
different problem with a different answer (one card, several options). Not this spec.

## Design

### 1. The link lives on the Option, not the Card

```ts
interface Option {
  /** Options across cards sharing this id were bought as one fare. */
  readonly fareGroupId?: string;
}
```

A Card is a slot; an Option is a candidate. The outbound slot can legitimately hold a $1,304
round-trip *and* a $700 one-way as rivals. Linking the two **cards** would declare the trip
permanently round-trip. Linking the two **options** means choosing the round-trip determines the
return leg, while choosing the one-way leaves the return free to shop separately.

This is the Card/Option split doing the job it exists for: a decision settled while its contents stay
under comparison.

Ids derive from the trip (`fare-1`, `fare-2`) through the existing `nextId` helper. The domain has no
clock and no randomness — that is what makes scheduling reproducible — so identity must be a function
of the trip.

**Invariant:** at most one option per card per group. Two alternatives on one card cannot both be
halves of a single purchase.

### 2. Cost splits evenly across the legs

$1,304 becomes $652 and $652. Split in cents, remainder to the outbound leg, so the halves sum to the
fare exactly.

`computeBudget` is not touched. It stays a pure sum over selected options, and the day grid shows
half the fare on each flight day, which is closer to how the trip is actually experienced than
loading the whole charge onto the outbound date.

### 3. "Moves as one" — one choke point

`applyOption(trip, cardId, optionId)` already sits underneath option preview (`rankOptions`). This
work also routes *commitment* through it. Making that one function group-aware buys every required
behaviour at once and preserves the guarantee in `evaluate.ts`: preview and result run identical
code, so they cannot drift. `costDelta` then reports the whole fare rather than half of it.

| Behaviour | Mechanism |
|---|---|
| Selecting one leg selects its partner | Group-aware `applyOption` |
| Planning state propagates | Trip-level `transitionCardInTrip` |
| Deleting one warns about the other | `removeOption` reports partner ids; UI confirms; group removed |
| Evaluation swaps both legs | Free, via `applyOption` |

`applyOption` returns `undefined` if *any* partner card fails `mayMutate`. A booked return leg
protects the outbound, which is correct — it is one purchase.

Removal warns before it acts: "this is half of the Delta round-trip; removing it removes the return
leg too." Confirming removes the whole group. Leaving a lone half-priced leg behind would be a
silently wrong number, which is worse than a cascade the user agreed to.

`App.tsx` routes its `chooseOption` and `changeState` handlers through the new trip-level functions
instead of the card-level ones.

### 4. An incomplete leg needs no new field

A placeholder return option is a flight option with **no `timing`**. That already means something
precise in this model: *"Absent means the option pins nothing and floats with the schedule."* The
scheduler stays honest rather than inventing a return date it was never told.

So "incomplete" is **derived, never stored**: a connection-anchored card whose selected option lacks
`journey` timing.

New conflict code `INCOMPLETE_LEG`, severity `warning`, raised in `compatibility.ts`, naming the card
as `flexible` so the warning comes with a next step.

This is load-bearing rather than decorative. `MISSING_CONNECTION` only fires when a connection has
*no card at all*, so creating the placeholder would **silence** the only existing signal. The
placeholder has to bring its own warning with it. `INCOMPLETE_LEG` also catches hand-made
timing-less flights, which are incomplete for the same reason.

### 5. Extraction and the paste flow

`ExtractedFields` gains:

- `roundTrip: boolean | null` — the listing is a return fare
- `returnDate: IsoDate | null` — whatever return date is visible

`FIELD_GUIDE` and the CLI JSON Schema instruct: if the fare is round-trip but only one leg's
specifics are shown, set `roundTrip` and report any visible return information. A date alone cannot
form valid `journey` timing, so it goes into the placeholder's `detail` text rather than being
promoted into a half-built timing object.

On import of a round-trip flight:

1. Outbound card on the `fromSegmentId === null` connection.
2. Return placeholder on the `toSegmentId === null` connection — **or, if that connection already has
   a flight card, added as an option on it.** Option-level linking makes this work with no special
   case, which is the second payoff of §1.
3. Both options carry the same `fareGroupId` and half the fare each.
4. A prompt offers `[Paste return leg]` `[Enter by hand]` `[Later]`.

Dismissing the prompt leaves the placeholder and its warning in place. Nothing is lost if the user
walks away, which is the reason to create both cards up front rather than asking first.

### 6. Broken groups

`syncConnections` deletes cards when a connection disappears. That can leave a fare group with one
surviving member holding half a price.

`EditResult` gains `unpairedCardIds`. Groups that fall below two live members have the id stripped,
and the interface says so. This follows the existing rule: never silently discard user intent.

## Testing

Domain, all pure:

- Selecting a grouped option selects its partner; selecting an ungrouped one does not.
- A booked partner blocks the swap on both legs.
- State propagates across the group; a rejected transition changes nothing.
- Budget totals the fare once across two legs.
- `diffTrips` on a grouped option reports the whole fare in `costDelta`, not half.
- `INCOMPLETE_LEG` fires for a timing-less flight and not for a timed one.
- `syncConnections` strips a group that drops to one member and reports the card.
- `sourceUrl` and `fareGroupId` survive `addOption`/`updateOption` (extends the existing test).

Extraction:

- A round-trip screenshot sets `roundTrip`; a one-way does not.
- Import creates two linked cards with halved cost and a timing-less return.
