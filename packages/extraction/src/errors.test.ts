import Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it } from 'vitest';
import { MissingKeyError, RefusalError, describeExtractionError } from './errors.js';

/**
 * An APIError carrying a given status, built the way the SDK builds one from a response.
 *
 * Real headers matter: `generate` treats a missing set as "the request never landed" and hands back
 * a connection error whatever the status says.
 */
function apiError(status: number): Anthropic.APIError {
  return Anthropic.APIError.generate(
    status,
    { error: { type: 'error', message: 'nope' } },
    'nope',
    new Headers(),
  );
}

describe('describeExtractionError', () => {
  it('points at Settings when the key is missing', () => {
    const { failure, message } = describeExtractionError(new MissingKeyError());
    expect(failure).toBe('no-key');
    expect(message).toMatch(/Settings/);
  });

  it('points at Settings when the key is rejected', () => {
    expect(describeExtractionError(apiError(401)).failure).toBe('bad-key');
    expect(describeExtractionError(apiError(403)).failure).toBe('bad-key');
    expect(describeExtractionError(apiError(401)).message).toMatch(/Settings/);
  });

  it('says to wait when rate limited', () => {
    expect(describeExtractionError(apiError(429)).failure).toBe('rate-limited');
  });

  it('blames the connection when the request never landed', () => {
    const failure = describeExtractionError(new Anthropic.APIConnectionError({})).failure;
    expect(failure).toBe('offline');
  });

  it('treats a cancel as a cancel, not a failure', () => {
    // Pressing Cancel should not read like something broke.
    const aborted = new Error('The operation was aborted.');
    aborted.name = 'AbortError';
    expect(describeExtractionError(aborted).failure).toBe('cancelled');
    expect(describeExtractionError(new Anthropic.APIUserAbortError()).failure).toBe('cancelled');
  });

  it('handles a refusal as its own case', () => {
    expect(describeExtractionError(new RefusalError('cyber')).failure).toBe('refused');
  });

  it('falls back to the by-hand message for a server error', () => {
    expect(describeExtractionError(apiError(500)).failure).toBe('unreadable');
  });

  it('falls back for anything it has never seen', () => {
    expect(describeExtractionError(new Error('boom')).failure).toBe('unreadable');
    expect(describeExtractionError('a string').failure).toBe('unreadable');
    expect(describeExtractionError(undefined).failure).toBe('unreadable');
  });

  it('never leaves the user without a way forward', () => {
    // Every message either says what to do, or says to fill it in by hand.
    for (const error of [apiError(500), new Error('boom'), new RefusalError(null), apiError(429)]) {
      expect(describeExtractionError(error).message).toMatch(/by hand|Settings|Wait/i);
    }
  });
});
