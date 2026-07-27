import type Anthropic from '@anthropic-ai/sdk';
import type { ExtractOptions } from './extract-text.js';
import { runStructuredCall } from './extract-text.js';
import type { ExtractedFields } from './schema.js';

/**
 * Reading a screenshot.
 *
 * The same extraction as pasted text, with the picture put in front of it. A screenshot of a search
 * result is often the fastest thing a traveller can produce — no page to load, no text to select —
 * so this route is worth having even though it is the least reliable of the three.
 */

export type ScreenshotMediaType = 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp';

export const SUPPORTED_IMAGE_TYPES: readonly ScreenshotMediaType[] = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
];

export function isSupportedImageType(candidate: string): candidate is ScreenshotMediaType {
  return (SUPPORTED_IMAGE_TYPES as readonly string[]).includes(candidate);
}

export function extractFromImage(
  client: Anthropic,
  image: { readonly base64: string; readonly mediaType: ScreenshotMediaType },
  options: ExtractOptions,
): Promise<ExtractedFields> {
  return runStructuredCall(
    client,
    [
      {
        type: 'image',
        source: { type: 'base64', media_type: image.mediaType, data: image.base64 },
      },
      {
        type: 'text',
        text:
          'This is a screenshot of a travel listing. Read the visible text and fill in what it ' +
          'states. If part of it is cut off or unreadable, leave those fields null and say so in ' +
          'warnings.',
      },
    ],
    options,
  );
}
