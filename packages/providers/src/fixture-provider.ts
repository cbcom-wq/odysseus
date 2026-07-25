import type { Card, Option, Trip } from '@odysseus/domain';
import type { OptionProvider } from './provider.js';
import { buildFixtureTrip } from './fixture-trip.js';

/**
 * Serves the alternatives already baked into the fixture trip.
 *
 * Real providers will hit a network and return something different every time. This one is
 * deliberately boring: it exists so the Workspace can be built and judged against the interface a
 * live source will eventually implement, without waiting on API access.
 */
export class FixtureProvider implements OptionProvider {
  readonly id = 'fixture';

  private readonly byCard = new Map<string, readonly Option[]>();

  constructor() {
    for (const card of buildFixtureTrip().cards) {
      this.byCard.set(card.id, card.options);
    }
  }

  supports(card: Card): boolean {
    return this.byCard.has(card.id);
  }

  fetch(_trip: Trip, card: Card): Promise<readonly Option[]> {
    return Promise.resolve(this.byCard.get(card.id) ?? []);
  }
}
