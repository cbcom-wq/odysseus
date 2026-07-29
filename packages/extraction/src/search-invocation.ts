import type { CardKind } from '@odysseus/domain';
import { buildJsonSchema } from './cli-invocation.js';
import { FIELD_GUIDE } from './schema.js';

/**
 * How to ask the Claude Code CLI to go and *find* options, and what to hold its answer to.
 *
 * The extraction siblings in `cli-invocation.ts` read a source the user already chose; these send
 * the model out to choose sources itself. Same discipline for the same reasons: pure builders here,
 * the process spawn in the shell. The cost note there applies double — a search runs the web tools
 * many times, so the prompt states the job tightly rather than hoping the model keeps it short.
 */

export interface CliSearchRequest {
  readonly cardKind: CardKind;
  /** Null only on the homeward leg — the trip knows where it ends, but home is not modelled. */
  readonly destination: string | null;
  readonly destinationCode: string | null;
  /** Where a journey starts. Null when the trip never recorded one — the hints carry it instead. */
  readonly origin: string | null;
  readonly startDate: string | null;
  readonly endDate: string | null;
  readonly nights: number | null;
  /** The trip may start anywhere inside this window. Set only while the trip has no dates. */
  readonly windowEarliest: string | null;
  readonly windowLatest: string | null;
  /** Total nights the whole trip may run, from `Trip.length`. */
  readonly lengthMin: number | null;
  readonly lengthMax: number | null;
  readonly travelers: number;
  readonly currency: string;
  /** Titles and details of options already on the card — context the trip model cannot state. */
  readonly hints: readonly string[];
}

/**
 * The JSON Schema for a search answer: the extraction schema for this one kind, plus attribution,
 * minus the at-least-one rule. A search that finds nothing must be able to say so.
 */
export function buildSearchJsonSchema(kind: CardKind): unknown {
  const schema = buildJsonSchema([kind]) as {
    properties: {
      options: {
        minItems?: number;
        items: { properties: Record<string, unknown>; required: string[] };
      };
    };
  };

  delete schema.properties.options.minItems;

  const item = schema.properties.options.items;
  item.properties['sourceUrl'] = { type: 'string', pattern: '^https?://' };
  item.properties['sourceName'] = { type: ['string', 'null'] };
  item.required.push('sourceUrl', 'sourceName');

  return schema;
}

const KIND_TASK: Record<CardKind, string> = {
  flight: 'flights',
  transport: 'trains, buses, ferries, or other ground transport',
  lodging: 'places to stay',
  activity: 'activities or tours worth booking',
  dining: 'restaurants worth reserving',
  note: 'options',
};

function journeyLine(request: CliSearchRequest): string {
  if (request.destination === null) {
    // The homeward leg. The trip knows where it ends; it has no model of home.
    return (
      `from ${request.origin ?? 'the last stop'} back to the traveller's home. Where home is was ` +
      'never recorded — infer it from the existing options listed below, and say what you ' +
      "assumed in each option's warnings"
    );
  }
  const to = `to ${request.destination}${request.destinationCode ? ` (${request.destinationCode})` : ''}`;
  if (request.origin !== null) return `from ${request.origin} ${to}`;
  return (
    `${to}. The traveller's origin was never recorded — infer it from the existing options ` +
    'listed below. If they do not settle it, search major routes into the destination and say ' +
    "what you assumed in each option's warnings"
  );
}

function whenLines(request: CliSearchRequest): string[] {
  const flexible =
    request.startDate === null && request.windowEarliest !== null && request.windowLatest !== null;

  if (flexible) {
    const nights =
      request.lengthMin !== null && request.lengthMax !== null
        ? request.lengthMin === request.lengthMax
          ? `${request.lengthMin} nights`
          : `between ${request.lengthMin} and ${request.lengthMax} nights`
        : 'an unstated number of nights';
    return [
      `The trip has no fixed dates yet. It should run ${nights}, starting somewhere between ` +
        `${request.windowEarliest} and ${request.windowLatest}.`,
      'Hunt across that window for the dates with the best value, not just any dates that fit. ' +
        'Every option you return must carry concrete, specific dates, and its detail or warnings ' +
        'must say why those dates won — for example, "cheapest midweek departures in late March".',
    ];
  }

  if (request.startDate === null) {
    return [
      'The trip has no dates yet and no window was given. Find representative current options ' +
        'and note in each warnings that prices depend on dates.',
    ];
  }

  if (request.cardKind === 'lodging') {
    const out = request.endDate === null ? '' : `, out ${request.endDate}`;
    const nights = request.nights === null ? '' : ` (${request.nights} nights)`;
    return [`Check-in ${request.startDate}${out}${nights}.`];
  }
  if (request.endDate !== null && request.endDate !== request.startDate) {
    return [`During a stay from ${request.startDate} to ${request.endDate}.`];
  }
  return [`On ${request.startDate}.`];
}

export function buildSearchPrompt(request: CliSearchRequest): string {
  const parts: string[] = [];

  parts.push(
    'You research travel options for a trip planner. Search the live web and bring back real, ' +
      'currently available candidates for the slot described below. The traveller will compare ' +
      'them against options from other sources, so being wrong is worse than coming back ' +
      'empty-handed: if you cannot find anything you can stand behind, return an empty options ' +
      'list rather than inventing or padding.',
  );

  parts.push(
    `Rules for searching:
- Use WebSearch to find candidates and WebFetch to confirm each one on its actual listing page.
- Report only options from a page you actually visited. Put that page's address in sourceUrl and
  the site's name (as a traveller would say it, e.g. "Booking.com") in sourceName.
- Bring back 3 to 5 options. Prefer distinct carriers, properties, or providers over five fares
  from one results page.
- Give each page one attempt. Many travel sites refuse anything that is not a browser; when one
  will not load, drop that candidate and move on rather than retrying it or working around it.
  Returning three options quickly is worth more than five slowly, so return what you have — even
  if that is fewer than three — rather than pushing on for the sake of the count.
- Report prices in ${request.currency} when the source offers it; otherwise report the listed
  price and name its currency in that option's warnings.
- Booking caveats — resale sites, member-only rates, long layovers — belong in warnings, not
  silently dropped.`,
  );

  const task = KIND_TASK[request.cardKind];
  const where =
    request.cardKind === 'flight' || request.cardKind === 'transport'
      ? journeyLine(request)
      : `in ${request.destination ?? 'the destination'}`;
  parts.push(`The slot: find ${task} ${where}, for ${request.travelers} traveller(s).`);

  parts.push(...whenLines(request));

  if (request.hints.length > 0) {
    parts.push(
      `Options already on this card, for context (match their route and spirit, do not repeat them):
${request.hints.map((h) => `- ${h}`).join('\n')}`,
    );
  }

  parts.push(FIELD_GUIDE);

  parts.push(
    `Two fields beyond the guide above:
- sourceUrl: the address of the page you read this option on. Required — no page, no option.
- sourceName: the site's name as a traveller would recognise it. Null only if genuinely unclear.`,
  );

  return parts.join('\n\n');
}

/** Arguments for `claude`, in order. The prompt is passed separately, over stdin. */
export function buildSearchCliArgs(request: CliSearchRequest): string[] {
  return [
    '--print',
    '--output-format',
    'json',
    '--json-schema',
    JSON.stringify(buildSearchJsonSchema(request.cardKind)),
    // Retrieval and transcription, like extraction — just more of it. The cheap model holds up.
    '--model',
    'sonnet',
    '--allowedTools',
    'WebSearch,WebFetch',
    // Nobody is at the terminal to answer a permission prompt.
    '--permission-mode',
    'acceptEdits',
  ];
}
