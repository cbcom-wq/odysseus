import Anthropic from '@anthropic-ai/sdk';
import { MissingKeyError } from './errors.js';

/**
 * The Anthropic client, built for a browser with no server behind it.
 *
 * This app has no backend, so the request goes straight from the page to the API. Two things follow
 * from that, and both look alarming until you know why they are here.
 */

/**
 * The model. Extraction is short and structured, so effort stays low — but thinking is left at its
 * adaptive default rather than disabled, because disabling it on this model risks tool calls
 * arriving as plain prose and internal tags leaking into the answer. Neither is worth the
 * milliseconds.
 */
export const EXTRACTION_MODEL = 'claude-opus-5';
export const EXTRACTION_EFFORT = 'low';

export function createExtractionClient(apiKey: string | undefined): Anthropic {
  if (apiKey === undefined || apiKey.trim() === '') throw new MissingKeyError();

  return new Anthropic({
    apiKey: apiKey.trim(),

    // The flag guards against shipping *your* key inside a page served to other people. Here the key
    // is the user's own, typed into their own copy of the app, and never leaves their machine — that
    // is the case this escape hatch exists for.
    dangerouslyAllowBrowser: true,

    // And the API only sets CORS headers for browser callers that ask for it explicitly.
    defaultHeaders: { 'anthropic-dangerous-direct-browser-access': 'true' },
  });
}
