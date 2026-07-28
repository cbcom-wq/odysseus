import { describe, expect, it } from 'vitest';
import {
  CliFailedError,
  buildCliArgs,
  buildJsonSchema,
  buildPrompt,
  parseCliOutput,
} from './cli-invocation.js';

/** Read an option's value out of the flat argument list. */
function valueOf(args: string[], flag: string): string | undefined {
  const at = args.indexOf(flag);
  return at === -1 ? undefined : args[at + 1];
}

describe('buildCliArgs', () => {
  it('asks for a validated JSON answer', () => {
    const args = buildCliArgs({ kind: 'text', subject: 'anything', allowedKinds: ['flight'] });

    expect(args).toContain('--print');
    expect(valueOf(args, '--output-format')).toBe('json');
    expect(JSON.parse(valueOf(args, '--json-schema')!)).toMatchObject({ type: 'object' });
  });

  it('grants no tools for text', () => {
    // The expensive mistake. Every tool definition rides along in the prompt, and a text
    // extraction with the full toolset measured about seventeen times the cost of one without.
    const args = buildCliArgs({ kind: 'text', subject: 'KLM 602', allowedKinds: ['flight'] });
    expect(valueOf(args, '--allowedTools')).toBe('');
  });

  it('grants exactly one tool for a link, and one for an image', () => {
    expect(
      valueOf(buildCliArgs({ kind: 'url', subject: 'https://x', allowedKinds: ['flight'] }), '--allowedTools'),
    ).toBe('WebFetch');

    expect(
      valueOf(buildCliArgs({ kind: 'image', subject: '/tmp/a.png', allowedKinds: ['flight'] }), '--allowedTools'),
    ).toBe('Read');
  });

  it('does not leave a tool run waiting on a permission prompt', () => {
    // There is nobody at the terminal to answer one.
    const args = buildCliArgs({ kind: 'image', subject: '/tmp/a.png', allowedKinds: ['flight'] });
    expect(valueOf(args, '--permission-mode')).toBe('acceptEdits');
  });
});

/** The schema wraps the option shape in an array, so the assertions below are about an item. */
function itemOf(schema: unknown): {
  properties: Record<string, { type: string[]; pattern?: string; enum?: unknown[] }>;
  required: string[];
} {
  return (schema as { properties: { options: { items: never } } }).properties.options.items;
}

describe('buildJsonSchema', () => {
  it('offers only the kinds the slot accepts', () => {
    const item = itemOf(buildJsonSchema(['flight', 'transport']));
    expect(item.properties['kind']!.enum).toEqual(['flight', 'transport', null]);
  });

  it('pins times to HH:mm', () => {
    // Asked for a time, the CLI returned "2026-09-23T19:45:00" in testing. The form binds these to
    // a time input, which shows nothing at all for a full timestamp.
    const item = itemOf(buildJsonSchema(['flight']));

    for (const field of ['departTime', 'arriveTime', 'startTime', 'endTime']) {
      expect(item.properties[field]!.pattern).toBe('^\\d{2}:\\d{2}$');
    }
    expect(item.properties['departDate']!.pattern).toBe('^\\d{4}-\\d{2}-\\d{2}$');
  });

  it('requires every field, so absence is stated rather than omitted', () => {
    const item = itemOf(buildJsonSchema(['flight']));
    expect(item.required.sort()).toEqual(Object.keys(item.properties).sort());
  });

  it('allows null everywhere a source might be silent', () => {
    for (const [name, spec] of Object.entries(itemOf(buildJsonSchema(['flight'])).properties)) {
      expect(spec.type, `${name} should accept null`).toContain('null');
    }
  });
});

describe('buildPrompt', () => {
  it('carries the field guide, whatever was pasted', () => {
    for (const kind of ['url', 'image', 'text'] as const) {
      expect(buildPrompt({ kind, subject: 'x', allowedKinds: ['flight'] })).toContain(
        'overnight: true only when arrival falls on the calendar day after departure',
      );
    }
  });

  it('names the file for an image and the link for a link', () => {
    expect(buildPrompt({ kind: 'image', subject: '/tmp/shot.png', allowedKinds: ['flight'] })).toContain(
      '/tmp/shot.png',
    );
    expect(buildPrompt({ kind: 'url', subject: 'https://example.com/f', allowedKinds: ['flight'] })).toContain(
      'https://example.com/f',
    );
  });
});

describe('parseCliOutput', () => {
  const ok = JSON.stringify({
    is_error: false,
    result: '{"kind":"flight"}',
    structured_output: { kind: 'flight', title: 'KLM 602' },
  });

  it('takes the validated answer, not the printed text', () => {
    // `result` is the same JSON as a string. `structured_output` is the one the CLI checked.
    expect(parseCliOutput(ok)).toEqual({ kind: 'flight', title: 'KLM 602' });
  });

  it('reports what the CLI said when it failed', () => {
    const failed = JSON.stringify({ is_error: true, result: 'Credit balance too low' });
    expect(() => parseCliOutput(failed)).toThrow(/Credit balance too low/);
  });

  it('complains when there is no answer attached', () => {
    const empty = JSON.stringify({ is_error: false, result: 'I could not read that.' });
    expect(() => parseCliOutput(empty)).toThrow(CliFailedError);
  });

  it('survives output that is not JSON at all', () => {
    // An install problem or a stray banner on stdout should not surface as a parser crash.
    expect(() => parseCliOutput('command not found: claude')).toThrow(CliFailedError);
    expect(() => parseCliOutput('')).toThrow(CliFailedError);
    expect(() => parseCliOutput('null')).toThrow(CliFailedError);
  });
});
