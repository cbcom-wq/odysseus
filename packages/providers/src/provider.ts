import type { Card, Option, Trip } from '@odysseus/domain';

/**
 * A source of candidate options for a card.
 *
 * Providers supply candidates and nothing more. Ranking belongs to the domain, because ranking here
 * means "what does this do to the trip" — a question a provider cannot see the answer to. A provider
 * that sorted its own results would be sorting by price, which is the thing this app exists not to
 * do.
 */
export interface OptionProvider {
  readonly id: string;
  /** Whether this provider has anything to say about a given card. */
  supports(card: Card): boolean;
  /** Candidates for the card, in no meaningful order. */
  fetch(trip: Trip, card: Card): Promise<readonly Option[]>;
}

/**
 * Merge freshly fetched options into a card.
 *
 * User-authored options are a peer source and always survive: someone who typed in the small hotel
 * their friend recommended should never lose it because a search refreshed. Fetched options replace
 * fetched options; user options are left exactly where they are, and the current selection is
 * preserved if it still exists.
 */
export function mergeOptions(card: Card, fetched: readonly Option[]): Card {
  const userAuthored = card.options.filter((o) => o.source === 'user');
  const merged = [...userAuthored, ...fetched];

  const stillThere = merged.some((o) => o.id === card.selectedOptionId);
  if (stillThere) return { ...card, options: merged };

  // The chosen option is gone from the refreshed results. Drop the selection rather than leave the
  // card pointing at something that no longer exists.
  const { selectedOptionId: _dropped, ...rest } = card;
  return { ...rest, options: merged };
}
