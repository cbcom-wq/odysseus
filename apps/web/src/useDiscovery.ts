import type { Card, Option, Trip } from '@odysseus/domain';
import { buildSearchResultSchema } from '@odysseus/extraction';
import { findDesktopBridge } from '@odysseus/persistence';
import { ClaudeSearchProvider } from '@odysseus/providers';
import type { SearchQuery } from '@odysseus/providers';
import { useMemo, useState } from 'react';

/**
 * Where a search runs.
 *
 * Only the desktop shell can run one — a search means starting the Claude Code CLI, and a browser
 * tab cannot start a process. No bridge means no button: unlike a paste, there is no API fallback
 * yet, so the browser build simply does not offer the feature rather than offering it broken.
 *
 * There is deliberately no cancel. The IPC call cannot be recalled (the same gap `useExtractor`
 * documents), so a cancel here would only abandon minutes of nearly finished work and then drop
 * its answer. The button disables instead, and says how long it may take.
 */

export interface Discovery {
  /** False in the browser build, where the button should not exist. */
  readonly available: boolean;
  /**
   * What is being searched right now, or null. One search at a time.
   *
   * A key rather than a card id: a slot with nothing on it can start a search, and there is no card
   * to name it by until the results come back.
   */
  readonly searchingSlotId: string | null;
  readonly find: (trip: Trip, card: Card, key: string) => Promise<readonly Option[]>;
}

/** Nulls become absences at the bridge: the request travels as plain optional fields. */
function toBridgeRequest(query: SearchQuery) {
  return {
    cardKind: query.cardKind,
    travelers: query.travelers,
    currency: query.currency,
    hints: [...query.hints],
    ...(query.destination === null ? {} : { destination: query.destination }),
    ...(query.destinationCode === null ? {} : { destinationCode: query.destinationCode }),
    ...(query.origin === null ? {} : { origin: query.origin }),
    ...(query.startDate === null ? {} : { startDate: query.startDate }),
    ...(query.endDate === null ? {} : { endDate: query.endDate }),
    ...(query.nights === null ? {} : { nights: query.nights }),
    ...(query.windowEarliest === null ? {} : { windowEarliest: query.windowEarliest }),
    ...(query.windowLatest === null ? {} : { windowLatest: query.windowLatest }),
    ...(query.lengthMin === null ? {} : { lengthMin: query.lengthMin }),
    ...(query.lengthMax === null ? {} : { lengthMax: query.lengthMax }),
  };
}

export function useDiscovery(): Discovery {
  const [searchingSlotId, setSearchingSlotId] = useState<string | null>(null);

  const provider = useMemo(() => {
    const bridge = findDesktopBridge();
    if (!bridge) return null;
    return new ClaudeSearchProvider(async (query) => {
      const raw = await bridge.searchOptions(toBridgeRequest(query));
      // The shell already validated this against the schema it sent the CLI. Checking again here
      // is cheap and means the interface never trusts a shape it did not verify itself.
      return buildSearchResultSchema(query.cardKind).parse(raw).options;
    });
  }, []);

  const find = async (trip: Trip, card: Card, key: string): Promise<readonly Option[]> => {
    if (!provider) throw new Error('Searching needs the desktop app.');
    setSearchingSlotId(key);
    try {
      return await provider.fetch(trip, card);
    } finally {
      setSearchingSlotId(null);
    }
  };

  return { available: provider !== null, searchingSlotId, find };
}
