# Partial and multi-option imports

**Status:** approved, ready to implement
**Date:** 2026-07-27
**Extends:** `2026-07-27-roundtrip-flights-design.md`

## Problem

Every real screenshot in `docs/example_options_screenshots/` holds several options, and the extractor
returns exactly one — recording the loss as prose in `warnings`, where nothing acts on it.

Reading the three examples, "partial" is not one problem but three:

- **Uniform** (`flights_example.png`) — three rows, structurally identical, all missing the same
  thing (the return leg).
- **Shared-header** (`flight_fare_options_example.png`) — times, route, duration and carrier are
  printed **once** above five fare cards. Each card alone has no timing at all; the missing data is
  fully recoverable from the header.
- **Ragged** (`hotels_example.png`) — different rows state different attributes. Row 2 does not say
  it is non-refundable, it says nothing. Rendering that as a blank beside row 1's "Fully refundable"
  manufactures a fact.

Rows at the bottom of both list screenshots are clipped by the image edge, so the last row is
systematically the least trustworthy.

## 1. Per-traveller pricing — a live bug, fixed first

`flight_fare_options_example.png` prints **$1,304** in large type over *"$2,607.69 roundtrip for 3
travelers"*. The extractor returns `1304`; `budget.ts` records costs for the whole party. The trip
therefore understates its largest line item by about half, today, with nothing to do with multiple
options.

No rule recovers this: $2,607.69 ÷ 3 = $869.23, which reconciles with neither figure. The source
contradicts itself, so the app must surface the ambiguity rather than compute through it.

- `ExtractedFields` gains `perTraveler: boolean | null`.
- `CardDraft` gains `perTraveler: boolean`, shown in the form as a checkbox beside the amount with
  the resulting whole-party figure spelled out next to it.
- `optionFrom(draft, id, travelers)` multiplies on the way in, because the domain stores whole-party
  costs and slice 1 has no per-traveller pricing.

The conversion is visible and editable at the moment of entry. A number the user cannot interrogate
is one they will not trust.

## 2. Several options, one card

Three flights are three candidates for one slot. That is what `Card` and `Option` already mean, so
the extraction shape changes rather than the model:

```ts
buildExtractionSchema(kinds) -> z.object({ options: z.array(option).min(1) })
```

`confidence` and `warnings` move **onto each option**. A crisp first row and a clipped last row do
not deserve the same trust, and one figure for the batch either over-trusts the tail or under-trusts
the head.

The prompt gains three rules:

- Fields printed once for the whole page — times, route, carrier — apply to **every** option.
  Without this the five fare bundles all come back with null timing, score identically on
  `usableHoursDelta`, and ranking collapses to price alone, which is the one thing this workspace
  exists not to do.
- Never state an attribute the source does not show. Absent is not false.
- A row cut off by the edge of the image is reported with low confidence or not at all.

## 3. Landing them without deciding anything

Imported options go onto one card **with nothing selected**, state `exploring`.

`addOption` auto-selects when a card has none, which would silently pick row 1. Landing unselected
turns the card into a real comparison instead, and `rankOptions` already handles a selectionless
baseline: each candidate is measured against a trip that has not chosen yet, so the panel shows what
each one costs in full.

The paste box lists the extras it is about to add — "2 more: American $1,301, United $1,311" — each
droppable before the card is created. The form keeps reviewing option one; the rest ride along.

## 4. One fare group per option

Every row in `flights_example.png` is a round-trip fare. Three imported outbound options therefore
need three fare groups and three matching placeholders on the return card, so that selecting
outbound #2 selects return placeholder #2.

Option-level linking already expresses this. `linkReturnLeg` reads `selectedOptionId` and builds a
single pair; it generalises to every round-trip option on the card.

## Testing

- A per-traveller price is multiplied by the traveller count and stored whole-party.
- The schema accepts several options and rejects an empty list.
- Imported options land unselected, and every one of them ranks against the same baseline.
- `linkReturnLeg` builds one group and one placeholder per round-trip option.
- Attributes absent from a source stay absent rather than becoming `false`.
