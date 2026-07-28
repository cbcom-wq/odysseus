import type { CardKind } from '@odysseus/domain';
import type { ExtractedFields } from './schema.js';

/**
 * Turning an extraction result into something the card editor can be filled with.
 *
 * The editor binds to strings because it is a form, so numbers come back across as text here. This
 * package deliberately does not import the editor's own draft type — packages should not reach into
 * apps — but the field names and types line up, and the app asserts that at compile time.
 */

export interface DraftPatch {
  readonly kind: CardKind;
  readonly title: string;
  readonly detail: string;
  readonly amount: string;
  readonly perNight: boolean;
  readonly perTraveler: boolean;
  readonly departDate: string;
  readonly departTime: string;
  readonly arriveTime: string;
  readonly overnight: boolean;
  readonly durationMinutes: string;
  readonly startTime: string;
  readonly endTime: string;
  readonly sourceUrl: string;
}

/**
 * The fields worth writing into the form.
 *
 * Only what the extractor actually found: a null means the source did not say, and the form keeps
 * whatever was already in it. Where the extractor did find something it wins, because the user
 * pasted the source on purpose — a paste that left half the form showing older, staler values
 * would be worse than one that overwrites.
 */
export function toDraftPatch(
  extracted: ExtractedFields,
  sourceUrl?: string,
): Partial<DraftPatch> {
  const patch: Record<string, unknown> = {};

  const put = (key: keyof DraftPatch, value: string | number | boolean | null): void => {
    if (value === null) return;
    patch[key] = typeof value === 'number' ? String(value) : value;
  };

  put('kind', extracted.kind);
  put('title', extracted.title);
  put('detail', extracted.detail);
  put('amount', extracted.amount);
  put('perNight', extracted.perNight);
  put('perTraveler', extracted.perTraveler);
  put('departDate', extracted.departDate);
  put('departTime', extracted.departTime);
  put('arriveTime', extracted.arriveTime);
  put('overnight', extracted.overnight);
  put('durationMinutes', extracted.durationMinutes);
  put('startTime', extracted.startTime);
  put('endTime', extracted.endTime);

  // Where it came from is known before the model ever runs, so it is not the model's to report.
  if (sourceUrl !== undefined && sourceUrl !== '') patch['sourceUrl'] = sourceUrl;

  return patch as Partial<DraftPatch>;
}

/**
 * Whether the result is worth warning the user about before they save it.
 *
 * They review every field in the form regardless, so this is not a gate — it is the difference
 * between "we filled this in" and "we filled this in, look twice at the dates".
 */
export function needsReviewNote(extracted: ExtractedFields): boolean {
  if (extracted.confidence !== null && extracted.confidence !== 'high') return true;
  return extracted.warnings !== null && extracted.warnings.length > 0;
}
