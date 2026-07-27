import Anthropic from '@anthropic-ai/sdk';
import { CliFailedError, CliUnavailableError } from './cli-invocation.js';

/**
 * Turning a failure into something worth reading.
 *
 * Nothing here is fatal. Extraction is a shortcut around typing the form in by hand, so when it
 * fails the form is still sitting right there — the message needs to say what happened without
 * suggesting the user is stuck. The only failure worth acting on is a bad key, so that is the only
 * one that gets specific advice.
 */

export type ExtractionFailure =
  | 'cancelled'
  | 'no-key'
  | 'bad-key'
  | 'rate-limited'
  | 'offline'
  | 'refused'
  | 'unreachable-page'
  | 'no-cli'
  | 'unreadable';

/** The model declined to answer. Rare here, but a 200 rather than an error, so it needs its own throw. */
export class RefusalError extends Error {
  constructor(readonly category: string | null) {
    super('The model declined to read that.');
    this.name = 'RefusalError';
  }
}

/** No key saved, or the field was left blank. Raised before any request is attempted. */
export class MissingKeyError extends Error {
  constructor() {
    super('No API key is set.');
    this.name = 'MissingKeyError';
  }
}

/**
 * The link was fetched but yielded nothing to read.
 *
 * Common and not really an error: plenty of booking sites render prices in JavaScript or turn away
 * anything that is not a browser. Worth its own case because the way out — paste the page text or a
 * screenshot instead — is specific and actually works.
 */
export class UnreachablePageError extends Error {
  constructor() {
    super('That page could not be read.');
    this.name = 'UnreachablePageError';
  }
}

const MESSAGES: Record<ExtractionFailure, string> = {
  cancelled: 'Stopped.',
  'no-key': 'Add an Anthropic API key in Settings to fill cards in automatically.',
  'bad-key': 'That API key was rejected — check it in Settings.',
  'rate-limited': 'Too many requests just now. Wait a moment, or fill it in by hand.',
  offline: "Couldn't reach Claude. Check your connection, or fill it in by hand.",
  refused: "Claude wouldn't read that one. Go ahead and fill it in by hand.",
  'unreachable-page': "That link didn't give up its details. Try a screenshot, or copy the page text and paste that instead.",
  'no-cli': 'Claude Code was not found. Install it, or add an API key in Settings.',
  unreadable: "Couldn't read that automatically — go ahead and fill it in by hand.",
};

function classify(error: unknown): ExtractionFailure {
  if (error instanceof MissingKeyError) return 'no-key';
  if (error instanceof RefusalError) return 'refused';
  if (error instanceof UnreachablePageError) return 'unreachable-page';

  if (error instanceof CliUnavailableError) return 'no-cli';
  if (error instanceof CliFailedError) return 'unreadable';

  /*
   * The desktop backend throws in the main process, and an error crossing Electron's IPC boundary
   * arrives as a plain Error with the original class name folded into its message. The class is
   * genuinely gone by then, so matching the name it left behind is the only thing left — which is
   * why the throwing side sets `name` explicitly and why these two strings must keep matching the
   * class names in cli-invocation.ts.
   */
  if (error instanceof Error) {
    if (error.message.includes('CliUnavailableError')) return 'no-cli';
    if (error.message.includes('CliFailedError')) return 'unreadable';
  }

  // An aborted request is the user pressing Cancel, not something going wrong.
  if (error instanceof Error && error.name === 'AbortError') return 'cancelled';
  if (error instanceof Anthropic.APIUserAbortError) return 'cancelled';

  if (error instanceof Anthropic.APIConnectionError) return 'offline';

  if (error instanceof Anthropic.APIError) {
    // `status` is the documented field on APIError; branch on it rather than on the message text,
    // which is not part of the contract and changes between releases.
    switch (error.status) {
      case 401:
      case 403:
        return 'bad-key';
      case 429:
        return 'rate-limited';
      default:
        return 'unreadable';
    }
  }

  return 'unreadable';
}

export interface DescribedError {
  readonly failure: ExtractionFailure;
  readonly message: string;
}

export function describeExtractionError(error: unknown): DescribedError {
  const failure = classify(error);
  return { failure, message: MESSAGES[failure] };
}
