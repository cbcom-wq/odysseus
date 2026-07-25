import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * `packages/domain` must stay free of I/O and framework dependencies.
 *
 * This is not a style preference. Option evaluation works by applying a candidate to a copy of the
 * trip, re-running the real scheduler, and diffing the result — so preview and reality cannot drift.
 * That trick only holds if scheduling is pure and deterministic. The moment something in here reads
 * a clock, a file, or the network, evaluation starts lying.
 *
 * Enforced as a test because a constraint everyone has to remember is a constraint that erodes.
 */

const SRC = new URL('.', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

const FORBIDDEN_IMPORTS = [
  'node:fs',
  'node:path',
  'node:http',
  'node:crypto',
  'node:os',
  'node:child_process',
  'fs',
  'path',
  'react',
  'vitest',
];

/** Non-determinism: same input must always give the same output. */
const FORBIDDEN_CALLS = [
  { pattern: /\bMath\.random\b/, why: 'Math.random makes scheduling non-reproducible' },
  { pattern: /\bDate\.now\b/, why: 'Date.now makes output depend on when it ran' },
  { pattern: /\bnew Date\(\s*\)/, why: 'new Date() reads the wall clock' },
  { pattern: /\bfetch\s*\(/, why: 'fetch is I/O' },
  { pattern: /\bprocess\.(env|argv|cwd)\b/, why: 'process state is ambient input' },
];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    if (!entry.name.endsWith('.ts')) return [];
    // Test files may use vitest and read the filesystem; they do not ship.
    if (entry.name.endsWith('.test.ts')) return [];
    return [full];
  });
}

describe('domain purity', () => {
  const files = sourceFiles(SRC);

  it('finds source files to check', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files.map((f) => [f.slice(SRC.length), f]))('%s imports nothing impure', (_name, file) => {
    const source = readFileSync(file, 'utf8');
    const imports = [...source.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((m) => m[1]!);

    for (const specifier of imports) {
      expect(
        FORBIDDEN_IMPORTS.includes(specifier),
        `${specifier} is not allowed in packages/domain`,
      ).toBe(false);
      // Only relative imports and nothing else: no cross-package or npm dependencies.
      expect(specifier.startsWith('.'), `${specifier} must be a relative import`).toBe(true);
    }
  });

  it.each(files.map((f) => [f.slice(SRC.length), f]))('%s stays deterministic', (_name, file) => {
    const source = readFileSync(file, 'utf8');
    for (const { pattern, why } of FORBIDDEN_CALLS) {
      expect(pattern.test(source), `${why}`).toBe(false);
    }
  });
});
