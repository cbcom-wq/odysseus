import { describe, expect, it } from 'vitest';
import type { CliSearchRequest } from './search-invocation.js';
import {
  buildSearchCliArgs,
  buildSearchJsonSchema,
  buildSearchPrompt,
} from './search-invocation.js';

/** Read an option's value out of the flat argument list. */
function valueOf(args: string[], flag: string): string | undefined {
  const at = args.indexOf(flag);
  return at === -1 ? undefined : args[at + 1];
}

/** A dated lodging search, the simplest complete request. */
function request(overrides: Partial<CliSearchRequest> = {}): CliSearchRequest {
  return {
    cardKind: 'lodging',
    destination: 'Paris',
    destinationCode: null,
    origin: null,
    startDate: '2027-03-10',
    endDate: '2027-03-14',
    nights: 4,
    windowEarliest: null,
    windowLatest: null,
    lengthMin: null,
    lengthMax: null,
    travelers: 2,
    currency: 'USD',
    hints: [],
    ...overrides,
  };
}

describe('buildSearchCliArgs', () => {
  it('grants exactly the web tools, and no permission stops', () => {
    const args = buildSearchCliArgs(request());
    expect(valueOf(args, '--allowedTools')).toBe('WebSearch,WebFetch');
    expect(valueOf(args, '--permission-mode')).toBe('acceptEdits');
  });

  it('asks for a validated JSON answer', () => {
    const args = buildSearchCliArgs(request());
    expect(args).toContain('--print');
    expect(valueOf(args, '--output-format')).toBe('json');
    expect(JSON.parse(valueOf(args, '--json-schema')!)).toMatchObject({ type: 'object' });
  });
});

/** The schema wraps the option shape in an array, so the assertions below are about an item. */
function itemOf(schema: unknown): {
  properties: Record<string, { type?: string[] | string; pattern?: string; enum?: unknown[] }>;
  required: string[];
} {
  return (schema as { properties: { options: { items: never } } }).properties.options.items;
}

describe('buildSearchJsonSchema', () => {
  it('requires a visited page for every option', () => {
    const item = itemOf(buildSearchJsonSchema('lodging'));
    expect(item.required).toContain('sourceUrl');
    expect(item.properties['sourceUrl']!.type).toBe('string');
    expect(item.properties['sourceUrl']!.pattern).toBe('^https?://');
  });

  it('lets a search come back empty-handed', () => {
    const schema = buildSearchJsonSchema('lodging') as {
      properties: { options: { minItems?: number } };
    };
    expect(schema.properties.options.minItems ?? 0).toBe(0);
  });

  it('pins kind to the slot being searched', () => {
    const item = itemOf(buildSearchJsonSchema('activity'));
    expect(item.properties['kind']!.enum).toEqual(['activity', null]);
  });
});

describe('buildSearchPrompt', () => {
  it('carries the field guide and the search rules', () => {
    const prompt = buildSearchPrompt(request());
    expect(prompt).toContain('overnight: true only when arrival falls on the calendar day after');
    expect(prompt).toContain('sourceUrl');
    // The two rules that make results trustworthy: visited pages only, and empty over invented.
    expect(prompt).toMatch(/page you (actually )?visited/i);
    expect(prompt).toMatch(/empty/i);
  });

  it('tells the model to give up on a page rather than keep trying it', () => {
    // Measured searches ranged from 144 seconds to over ten minutes on the same query. Travel
    // sites routinely refuse anything that is not a browser, and a model that keeps retrying them
    // is the difference — so the budget is stated rather than left to judgement.
    const prompt = buildSearchPrompt(request());
    expect(prompt).toMatch(/do not retry|move on|give up/i);
    expect(prompt).toMatch(/fewer|what you have|as many as you/i);
  });

  it('states the destination, dates, party, and currency', () => {
    const prompt = buildSearchPrompt(request());
    expect(prompt).toContain('Paris');
    expect(prompt).toContain('2027-03-10');
    expect(prompt).toContain('2 traveller');
    expect(prompt).toContain('USD');
  });

  it('names the route for a journey with a known origin', () => {
    const prompt = buildSearchPrompt(
      request({ cardKind: 'flight', origin: 'Chicago', startDate: '2027-03-10', nights: null }),
    );
    expect(prompt).toContain('Chicago');
    expect(prompt).toContain('Paris');
  });

  it('flies home from a known origin when the destination was never recorded', () => {
    // The homeward leg: the trip knows where it ends but has no model of home.
    const prompt = buildSearchPrompt(
      request({
        cardKind: 'flight',
        origin: 'Paris',
        destination: null,
        hints: ['KLM 602', 'AMS to ORD, nonstop'],
      }),
    );
    expect(prompt).toContain('Paris');
    expect(prompt).toMatch(/home/i);
    expect(prompt).toMatch(/infer/i);
  });

  it('leans on the card hints when the origin was never recorded', () => {
    const prompt = buildSearchPrompt(
      request({
        cardKind: 'flight',
        origin: null,
        hints: ['KLM 602', 'ORD to AMS, nonstop'],
      }),
    );
    expect(prompt).toContain('ORD to AMS, nonstop');
    expect(prompt).toMatch(/infer/i);
  });

  it('turns a window and a length range into a best-value date hunt', () => {
    const prompt = buildSearchPrompt(
      request({
        cardKind: 'flight',
        origin: 'Chicago',
        destination: 'Rio de Janeiro',
        startDate: null,
        endDate: null,
        windowEarliest: '2027-03-01',
        windowLatest: '2027-04-30',
        lengthMin: 10,
        lengthMax: 16,
      }),
    );
    expect(prompt).toContain('2027-03-01');
    expect(prompt).toContain('2027-04-30');
    expect(prompt).toContain('10');
    expect(prompt).toContain('16');
    // Concrete dates back, with the reasoning: flexible in, decided out.
    expect(prompt).toMatch(/concrete|specific|exact/i);
    expect(prompt).toMatch(/why th(o|e)se dates/i);
  });
});
