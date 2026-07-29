import type { Card, Option, Trip } from '@odysseus/domain';
import { discoveredOptions } from './discovered.js';
import type { DiscoveredOptionFields } from './discovered.js';
import type { OptionProvider } from './provider.js';
import { buildSearchQuery } from './search-context.js';
import type { SearchQuery } from './search-context.js';

/** The one impure step, injected: this package must stay free of I/O, per the architecture rule. */
export type SearchTransport = (query: SearchQuery) => Promise<readonly DiscoveredOptionFields[]>;

/**
 * Options found by asking Claude to search the live web.
 *
 * The first real consumer of `OptionProvider`: the query is built from the trip, the transport
 * carries it to whatever can actually run a search (the desktop shell's CLI bridge today, an API
 * backend later), and the results come back as ordinary options marked `discovered`. Ranking stays
 * with the domain, and the merge policy in `mergeOptions` stays the caller's job — a provider
 * supplies candidates and nothing more.
 */
export class ClaudeSearchProvider implements OptionProvider {
  readonly id = 'claude-search';

  constructor(private readonly transport: SearchTransport) {}

  supports(card: Card): boolean {
    return card.kind !== 'note';
  }

  async fetch(trip: Trip, card: Card): Promise<readonly Option[]> {
    const query = buildSearchQuery(trip, card);
    if (query === undefined) return [];
    return discoveredOptions(card, await this.transport(query), trip.travelers);
  }
}
