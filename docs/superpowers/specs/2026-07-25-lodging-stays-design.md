# Lodging as a Whole-Stay Decision — Design

**Project:** Odysseus
**Date:** 2026-07-25
**Status:** Approved for implementation
**Extends:** `2026-07-25-trip-workspace-design.md` (§3.2 anchors, §5.2 pins, §5.5 conflicts)

---

## 1. Purpose

Where you sleep is decided per *place*, not per *night*. Someone spending five nights in Paris books
one hotel for five nights; they do not make five independent lodging decisions. The Workspace should
default to that, show the stay across every night in the day grid, and treat the whole thing as one
decision — while still allowing a deliberate split when the traveller genuinely does change hotels
mid-stay.

### What already holds

Lodging cards anchor to `{ kind: 'segment', segmentId }`, and `placeCards` spreads a segment-anchored
card across every night of the stop. The Day view's Lodging column adds segment anchors, not day
anchors. So a hotel is already one card and one decision covering the whole stay. **The default is
not what needs building.**

### What does not hold

- **Splitting is silently wrong.** A second lodging card on the same stop does not divide the nights:
  both cards cover *all* nights. The budget charges both nightly rates on every night, and
  `UNCOVERED_NIGHT` is satisfied twice over. This is not an unimplemented feature, it is a
  correctness hole.
- **Nothing communicates the shared decision.** The Day view repeats an identical card on five rows
  with no signal that those five rows are one choice rather than five.

This design closes both.

### Out of scope

Splitting anything other than lodging. Rendering check-out on the following stop's first row.
Deriving `fromNight` from booked dates — see §7.

---

## 2. Decisions

| Question | Decision | Rationale |
|---|---|---|
| How is a split expressed? | An optional `fromNight` on the existing `segment` anchor; the end is **not stored** | The tail's end is "end of stay", so reflow needs no rule and no stored value can go stale |
| What absorbs a length change? | The last stay | Matches how travellers think — the first booking is the fixed one, slack lives in the tail |
| Split as two segments in one city? | Rejected | Manufactures a fake Paris→Paris connection and destroys the thing being asked for: the stop stops being one location |
| Split as several selected options on one card? | Rejected | Breaks the Card/Option contract the comparison loop rests on. A card owns one selection and one planning state; "compare alternatives to this card" is meaningless when the card is three hotels |

---

## 3. The anchor

```ts
export type CardAnchor =
  | { readonly kind: 'segment'; readonly segmentId: string; readonly fromNight?: number }
  | { readonly kind: 'segment-day'; readonly segmentId: string; readonly dayOffset: number }
  | { readonly kind: 'connection'; readonly connectionId: string };
```

`fromNight` is the night of the stay a lodging starts on, counted from arrival. Absent means 0.

**No end is stored.** A lodging card runs until the next lodging card in the same stop begins, or
until the stay ends if it is the last. This single omission is what makes the reflow rule automatic:
stretching Paris from five nights to six lengthens the tail with no code doing anything, and there is
no stored end that can disagree with the schedule.

`fromNight` is interpreted for `kind: 'lodging'` only. A note anchored to a segment continues to
cover the whole stay, as today. Like every anchor, it is relative and therefore survives reflow.

No migration: existing trips have no `fromNight`, which reads as 0, which is today's behaviour.

---

## 4. Derived ranges

In `layout.ts`, for each segment: take its lodging cards, sort by `fromNight` with card id as a
stable tiebreak, and give each the nights from its own start to the next one's start (or to the end
of the stay).

Stability is not cosmetic. Scheduling determinism is load-bearing — the trip-workspace spec §5.3
depends on it, and speculative apply/diff depends on that in turn. Range derivation must be as
deterministic as the scheduler it feeds.

**Boundaries come from all lodging cards on the stop, including ones with nothing selected yet.**
`placeCards` skips cards without a selected option. If it also skipped them when computing
boundaries, splitting Paris at night 2 and not yet choosing Hotel B would make Hotel A appear to
cover all five nights, no conflict would fire, and the user would believe they were covered. So:
boundaries from every lodging card, `PlacedCard` emitted only for those with a selection. The
uncovered tail then correctly raises `UNCOVERED_NIGHT`.

A card whose derived range is empty — the stay compressed below its start night, or an earlier card
already claims that night — gets `orphaned: true, days: []`. That is the existing vocabulary, so it
surfaces in the interface rather than vanishing. Never silently discarding user intent is a stated
design principle and it applies here directly.

---

## 5. Budget and conflicts

Almost all of this falls out.

- **Budget:** unchanged. Per-night cost already multiplies across the card's actual days; once those
  days are a real range, the double-charge cannot occur.
- **`UNCOVERED_NIGHT`:** unchanged. It reads placed lodging days, so gaps become genuinely detectable
  for the first time.
- **Over-coverage is impossible by construction.** Ranges are derived from sort order and cannot
  overlap. The bug class is designed out rather than validated against.
- **`ORPHANED_CARD` needs work.** Its message assumes an activity ("no longer has a day to sit on")
  and it populates `segmentIds` only for `segment-day` anchors. Both need a lodging case: a stay that
  lost its nights must name its stop and say what happened in lodging terms.

---

## 6. The scheduler

The one genuine hazard. Today, any segment-anchored card with `stay` timing pins `B_i = checkIn` and
forces `nights_i = checkOut − checkIn`. Splits break that: a Hotel B booked Sep 29–Oct 2 would pin
Paris to *start* on Sep 29 and force it to three nights.

Generalised:

| Case | Pin | Forced length |
|---|---|---|
| Any lodging with fixed dates | `B_i = checkIn − fromNight` | — |
| **Last** lodging in the stop | as above | `nights_i = fromNight + (checkOut − checkIn)`, exactly — its end is the stay's end |
| **Middle** lodging | as above | floor: `nights_i ≥ fromNight + (checkOut − checkIn)` |

At `fromNight = 0` on a sole lodging card, both rules reduce to today's behaviour exactly. That is
the compatibility argument and it should be visible in the code, not just asserted here.

The floor is applied as `max(duration.min, floor)` when seeding the span distributor. A floor
exceeding `duration.max` is a capacity conflict, handled like any other — never a silent clip.

---

## 7. Interface

### 7.1 Day view: one decision, drawn as one thing

Today an identical card renders on all five Paris rows, which is exactly the reading to kill — five
rows that look like five decisions.

Render a range as a **stay ribbon**. The first night carries the full card: name, per-night price,
check-in. Subsequent nights carry a quiet continuation — a spanning rule and dimmed text, not a
repeated card. The last night is marked as the last night. Selecting any night selects the one card,
as it already does, and highlights the **whole ribbon**. That shared highlight is the visible proof
that the decision is shared.

The Cost column continues to show the nightly charge on every row. Per-day visibility was never the
problem; per-day *decision-making* was.

### 7.2 The split affordance, where the thought occurs

The Lodging column's "+ Somewhere to stay" button currently appears in every cell. It splits in two:

- A night with **no** lodging keeps **"+ Somewhere to stay"**.
- A night **inside** a ribbon, other than its first, gets **"Change where you stay from this night"**.

That second control is the feature. The user has the thought on a specific night — *from Thursday I
want to be somewhere else* — and acts on it there. It also means the only route to lodging mid-stay
is a split at a named night, so an overlapping duplicate is unreachable through the interface rather
than merely discouraged.

### 7.3 Structure view

A stop's lodging renders as ordered ranges — "Nights 1–2 · Hotel Alpha", "Nights 3–5 · Hotel Bravo"
— carrying the same split control.

Undoing a split is deleting the later card. The earlier one re-absorbs the nights automatically,
because its end was never stored. No unsplit code is written.

### 7.4 Domain edits

- `splitStay(trip, segmentId, fromNight)` — creates an unplanned lodging card at that night. Returns
  the trip unchanged when `fromNight <= 0` or a lodging already starts there; the interface offers
  neither case.
- `addCard` on a segment anchor leaves `fromNight` absent, so existing call sites are untouched.
- Card deletion needs no special handling; re-absorption is emergent.

### 7.5 Comparison

No changes. Select Hotel B and its alternatives rank by whole-trip impact across *its* nights,
because `applyOption` → `diffTrips` runs the same placement code as the real swap. A cheaper tail
hotel that would require an extra night shows up as a whole-trip cost change, which is the entire
point of trip-level evaluation.

---

## 8. Testing

Domain first, as the trip-workspace spec requires. Each test encodes a claim, not a mechanism.

- A stop with one lodging card covers every night, with no `fromNight` written anywhere — the default
  behaviour, guarded as a regression.
- Splitting Paris at night 2 gives Hotel A nights 0–1 and Hotel B nights 2–4, and the budget charges
  each only for its own nights. This pins the double-charge bug.
- Stretching the stay grows only the last range; earlier ranges are unchanged.
- Compressing below a split's start orphans the tail card and never deletes it.
- A split whose tail has no selected option raises `UNCOVERED_NIGHT` for exactly those nights.
- Ranges never overlap and never gap, across generated `fromNight` sets.
- A booked tail stay pins the stop to start on `checkIn − fromNight`.
- A booked middle stay raises the effective minimum; a floor above `duration.max` produces a capacity
  conflict rather than a silent clip.
- Two cards at the same `fromNight` resolve identically across repeated runs.
- **Every existing scheduler, budget, and compatibility test passes unchanged.** That is the proof
  the single-card path did not move.

---

## 9. Edge cases

Stated here so they are not decided by accident during implementation.

| Case | Behaviour |
|---|---|
| `fromNight >= nights` | Card orphaned, days empty, surfaced |
| Two cards at the same `fromNight` | Earlier by card id takes the nights; the later is orphaned |
| Zero-night segment | No lodging placed |
| Note on a segment anchor | `fromNight` ignored; covers the whole stay |
| Undated trip | Identical — `fromNight` is a night offset, never a date |
| Stop reordered or removed | Nothing new; the anchor is relative, which is why it survives reflow |
| Booked dates disagree with `fromNight` | The anchor stays authoritative; §6's pin and forcing rules resolve it. The anchor is never quietly rewritten |

---

## 10. Build order

1. `layout.ts` — range derivation, boundaries from all lodging cards, orphaning
2. `compatibility.ts` — `ORPHANED_CARD` lodging case
3. `scheduler.ts` — generalised pin and forced length
4. `edit.ts` — `splitStay`
5. `apps/web` — stay ribbon, then the split affordance, then the Structure view ranges

Steps 1–4 are fully testable with no interface. Budget requires no change and its existing tests are
the check on that.
