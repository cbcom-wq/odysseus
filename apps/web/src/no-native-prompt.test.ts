import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * `window.prompt` does not exist in the shell we ship in.
 *
 * Electron's renderer replaces it with a throw ("prompt() is not supported"), so a button that
 * called it did nothing at all — no dialog, no error the traveller could see, the click just died.
 * Asking the question in the page is the only thing that works, so nothing here may call it.
 */
const sourceDirectory = fileURLToPath(new URL('.', import.meta.url));

const sources = readdirSync(sourceDirectory).filter(
  (file) => /\.tsx?$/.test(file) && !file.endsWith('.test.ts'),
);

describe('native dialogs', () => {
  it.each(sources)('%s does not call prompt()', (file) => {
    const text = readFileSync(join(sourceDirectory, file), 'utf8');
    expect(text).not.toMatch(/\bwindow\.prompt\s*\(/);
    expect(text).not.toMatch(/(?<![.\w])prompt\s*\(/);
  });
});
