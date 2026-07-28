import type { CardKind } from '@odysseus/domain';
import { z } from 'zod';

/**
 * What we ask the model to pull out of a link, a screenshot, or a block of text.
 *
 * The shape deliberately mirrors the card editor's draft field for field, so a result can be merged
 * straight into the form the user is about to review. Anything else would mean a translation layer
 * that has to be kept in step with the form by hand.
 *
 * Every field is nullable because most sources are partial. A hotel listing has no departure time
 * and a boarding pass has no nightly rate, and a model that cannot say "not here" will invent
 * something instead. Null means absent; the form keeps whatever it already had.
 */

export interface ExtractedFields {
  readonly kind: CardKind | null;
  readonly title: string | null;
  readonly detail: string | null;
  readonly amount: number | null;
  readonly perNight: boolean | null;
  /**
   * The price shown is for one traveller, not the whole party.
   *
   * Flight results quote per-traveller by default and print the party total in small type beside it.
   * Costs in this model are for the whole party, so getting this wrong multiplies the largest line
   * item in the trip by the size of the party.
   */
  readonly perTraveler: boolean | null;
  readonly departDate: string | null;
  readonly departTime: string | null;
  readonly arriveTime: string | null;
  readonly overnight: boolean | null;
  readonly durationMinutes: number | null;
  readonly startTime: string | null;
  readonly endTime: string | null;
  /**
   * The price covers a return journey, even when only one leg's times are shown.
   *
   * This is the normal shape of a flight listing, not an edge case: the fare is quoted for the round
   * trip and the panel details the outbound. Taken at face value the trip acquires a return fare with
   * no return, so the import has to know to build the second leg.
   */
  readonly roundTrip: boolean | null;
  /** The return date when the source shows one, even if it shows no times to go with it. */
  readonly returnDate: string | null;
  /**
   * How sure the model is about *this option*. Drives whether the form warns the user to look twice.
   *
   * Per option rather than per screenshot: the first row of a list is usually crisp and the last one
   * is often clipped by the edge of the image, and one figure for the batch either over-trusts the
   * tail or under-trusts the head.
   */
  readonly confidence: 'high' | 'medium' | 'low' | null;
  /** Short notes about anything assumed or ambiguous, e.g. "no year was printed; assumed 2026". */
  readonly warnings: readonly string[] | null;
}

/**
 * Everything a single source offered.
 *
 * Real screenshots hold several candidates — three flights, five fare bundles, three hotels — and
 * returning one meant discarding the rest into a prose warning where nothing could act on them.
 * They are alternatives for the same slot, which is exactly what a Card full of Options is.
 */
export interface ExtractedBatch {
  readonly options: readonly ExtractedFields[];
}

/**
 * The schema, narrowed to the kinds this slot will actually accept.
 *
 * The card's anchor already decides what can go there — lodging belongs to a segment, a flight to a
 * connection. Passing that list through as an enum means the model cannot return a kind the slot
 * would reject, so an impossible answer is unrepresentable rather than validated away later.
 */
export function buildExtractionSchema(allowedKinds: readonly CardKind[]) {
  if (allowedKinds.length === 0) {
    throw new Error('Extraction needs at least one allowed card kind.');
  }

  const option = z.object({
    kind: z.enum(allowedKinds as [CardKind, ...CardKind[]]).nullable(),
    title: z.string().nullable(),
    detail: z.string().nullable(),
    amount: z.number().nullable(),
    perNight: z.boolean().nullable(),
    perTraveler: z.boolean().nullable(),
    departDate: z.string().nullable(),
    departTime: z.string().nullable(),
    arriveTime: z.string().nullable(),
    overnight: z.boolean().nullable(),
    durationMinutes: z.number().nullable(),
    startTime: z.string().nullable(),
    endTime: z.string().nullable(),
    roundTrip: z.boolean().nullable(),
    returnDate: z.string().nullable(),
    confidence: z.enum(['high', 'medium', 'low']).nullable(),
    warnings: z.array(z.string()).nullable(),
  });

  // At least one: a source that yielded nothing is a failure to report, not an empty list to merge
  // into the form and leave the user wondering what happened.
  return z.object({ options: z.array(option).min(1) });
}

/** The shape of one option on its own, for callers validating a single result. */
export function buildOptionSchema(allowedKinds: readonly CardKind[]) {
  return buildExtractionSchema(allowedKinds).shape.options.element;
}

/**
 * What each field means, in the model's terms.
 *
 * These are the same definitions the form's own labels and hints carry, written out because the
 * model cannot see the form. `overnight` and `perNight` in particular are easy to get backwards
 * from a listing alone.
 */
export const FIELD_GUIDE = `
- kind: what sort of thing this is. Choose only from the kinds offered.
- title: the name a traveller would recognise, e.g. "KLM 602" or "Hotel Lumiere". Not a sentence.
- detail: a short line worth remembering when comparing, e.g. "ORD to AMS, nonstop" or
  "Le Marais, 8.7, free cancellation". Keep it under about ten words.
- amount: the price as a plain number, no currency symbol or thousands separator. For lodging use
  the nightly rate if one is shown, otherwise the total.
- perNight: true when amount is a per-night rate, false when it is the whole cost.
- perTraveler: true when the price shown is for one traveller. Flight results usually are, and often
  print the party total in smaller type next to it — report the headline number in amount and say
  true here. If the two figures do not reconcile, still report both: the headline in amount, and what
  the source claimed the total was, in warnings.
- departDate: the date of departure, formatted YYYY-MM-DD. Only if a date is actually shown. Listings
  routinely print a day and month with no year — "Wed, Mar 3". Resolve that to its next occurrence
  and say so in warnings. A missing year is recoverable from context in a way a missing price is not,
  and a journey with no date pins nothing, so dropping it costs the traveller the whole comparison.
- departTime / arriveTime: local wall-clock times at each end, formatted HH:mm on a 24-hour clock.
- overnight: true only when arrival falls on the calendar day after departure, e.g. a red-eye or a
  night train. False for a same-day journey.
- durationMinutes: total travel time in minutes. "7h 25m" is 445.
- startTime / endTime: for something booked within a day, such as a tour or a dinner reservation.
- roundTrip: true when the price covers a return journey. Flight results usually quote a round-trip
  fare while detailing only the outbound flight — say true even when the return times are absent,
  and put the outbound's times in departTime/arriveTime. Say false for a genuine one-way.
- returnDate: the return date if one is shown anywhere, formatted YYYY-MM-DD, even when no return
  times are given. Null if the source does not show it.
- confidence: high when the source stated things plainly, low when you had to infer a lot.
- warnings: short notes on anything assumed, ambiguous, or possibly stale. Empty when nothing
  needed assuming.

Return every distinct option the source offers, in the order it shows them. A results list with
three flights is three options; a page of five fare bundles is five. They are alternatives for the
same decision, so they belong together.

- Facts printed once for the whole page apply to every option. A fare comparison usually states the
  flight's times, route, carrier and duration once at the top and then lists prices — copy those
  shared values into every option rather than leaving them null.
- Never report an attribute the source does not show for that option. If one row says "free
  cancellation" and another says nothing, the second one is null, not false. Absent is not the same
  as no.
- If a row is cut off by the edge of the image, either leave it out or report it with low confidence
  and say so in its warnings. Do not complete it from the rows above.

Use null for anything the source does not state. Do not guess a price or a time that is not there.
`.trim();
