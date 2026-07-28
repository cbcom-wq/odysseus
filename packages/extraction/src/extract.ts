import { createExtractionClient } from './client.js';
import { extractFromImage } from './extract-image.js';
import { extractFromText } from './extract-text.js';
import { extractFromUrl } from './extract-url.js';
import type { ScreenshotMediaType } from './extract-image.js';
import type { ExtractRequestOptions, OptionExtractor } from './extractor.js';
import type { ExtractedBatch } from './schema.js';

/**
 * Reaching Claude over the API, with a key the user supplied.
 *
 * The browser build's only option: a tab cannot start a process, so it cannot borrow the Claude
 * Code login the way the desktop shell does. In the desktop build this is the fallback for anyone
 * who would rather spend API credits than have the shell run a CLI.
 */

export type PasteInput =
  | { readonly kind: 'url'; readonly url: string }
  | { readonly kind: 'image'; readonly base64: string; readonly mediaType: ScreenshotMediaType }
  | { readonly kind: 'text'; readonly text: string };

export function createApiExtractor(apiKey: string | undefined): OptionExtractor {
  return {
    id: 'api',
    ready: apiKey !== undefined && apiKey.trim() !== '',

    extract(input: PasteInput, options: ExtractRequestOptions): Promise<ExtractedBatch> {
      // Built per call rather than held: the key can change in Settings between one paste and the
      // next, and a stale client would keep using the old one.
      const client = createExtractionClient(apiKey);

      switch (input.kind) {
        case 'url':
          return extractFromUrl(client, input.url, options);
        case 'image':
          return extractFromImage(
            client,
            { base64: input.base64, mediaType: input.mediaType },
            options,
          );
        case 'text':
          return extractFromText(client, input.text, options);
      }
    },
  };
}
