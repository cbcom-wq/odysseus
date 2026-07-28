import type Anthropic from '@anthropic-ai/sdk';
import { EXTRACTION_MODEL } from './client.js';
import { RefusalError, UnreachablePageError } from './errors.js';
import type { ExtractOptions } from './extract-text.js';
import { extractFromText } from './extract-text.js';
import type { ExtractedBatch } from './schema.js';

/**
 * Reading a link.
 *
 * Two calls rather than one. The first fetches the page; the second runs the same extraction used
 * for pasted text over what came back.
 *
 * Doing it in one call would mean asking for a forced output shape and a server-side fetch in the
 * same turn, which is a combination worth avoiding when splitting it costs a round trip and buys
 * the guarantee that a link and a paste of the same page produce the same fields.
 */

const FETCH_PROMPT = `
Fetch this page and reproduce the part of it that describes the travel option — the name, the price,
any dates and times, the route or address, and any conditions like cancellation terms.

Quote the visible text. Do not summarise it, do not convert anything, and do not add commentary. If
the page cannot be fetched or shows no listing, reply with exactly: NO CONTENT
`.trim();

/** Enough hops for a fetch that pauses mid-turn, without letting a loop run away. */
const MAX_CONTINUATIONS = 3;

async function fetchPageText(
  client: Anthropic,
  url: string,
  signal: AbortSignal | undefined,
): Promise<string> {
  const messages: Anthropic.MessageParam[] = [
    { role: 'user', content: `${FETCH_PROMPT}\n\n${url}` },
  ];

  for (let hop = 0; hop <= MAX_CONTINUATIONS; hop++) {
    const response: Anthropic.Message = await client.messages.create(
      {
        model: EXTRACTION_MODEL,
        max_tokens: 4096,
        tools: [{ type: 'web_fetch_20260209', name: 'web_fetch', max_uses: 2 }],
        messages,
      },
      signal ? { signal } : {},
    );

    if (response.stop_reason === 'refusal') {
      throw new RefusalError(response.stop_details?.category ?? null);
    }

    // The server-side fetch loop hit its own iteration limit. Hand the turn back and let it finish.
    if (response.stop_reason === 'pause_turn') {
      messages.push({ role: 'assistant', content: response.content });
      continue;
    }

    return response.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('\n')
      .trim();
  }

  throw new UnreachablePageError();
}

export async function extractFromUrl(
  client: Anthropic,
  url: string,
  options: ExtractOptions,
): Promise<ExtractedBatch> {
  const page = await fetchPageText(client, url, options.signal);

  // Plenty of booking sites render their prices in JavaScript or turn away anything that is not a
  // browser. Saying so is more useful than extracting an empty card, because the fallback — paste
  // the page text instead — actually works.
  if (page === '' || page.includes('NO CONTENT')) throw new UnreachablePageError();

  return extractFromText(client, page, options);
}
