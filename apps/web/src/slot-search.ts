import { addCard, nextCardId } from '@odysseus/domain';
import type { Card, CardAnchor, CardKind, Option, Trip } from '@odysseus/domain';
import type { DiscoveryOutcome } from './discover.js';
import { applyDiscovery } from './discover.js';

/**
 * Searching a slot the trip has no card for.
 *
 * A search runs for minutes and cannot be recalled, so creating the card up front would leave an
 * option-less card behind every time one came back empty, errored, or hit the ten-minute ceiling —
 * and an option-less card shows nowhere but the panel, because `placeCards` skips anything with
 * nothing chosen. So the search runs against a card that never enters the trip, and the real one is
 * created only if there is something to put on it.
 *
 * `buildSearchQuery` reads only a card's kind, anchor and options, which is what makes this safe.
 */

/** The id the throwaway card carries. It is never written to a trip. */
const PENDING_CARD_ID = 'pending';

export interface SlotSearchRequest {
  /** The card of the right kind already on this slot, when there is one. */
  readonly existing: Card | undefined;
  readonly anchor: CardAnchor;
  readonly kind: CardKind;
  /** Identity for the busy indicator while the slot has no card to be identified by. */
  readonly slotKey: string;
}

export interface SlotSearchTarget {
  readonly card: Card;
  readonly key: string;
  readonly ephemeral: boolean;
}

export function slotSearchTarget(request: SlotSearchRequest): SlotSearchTarget {
  // A slot that already holds a card searches *that* card: it is the only way a re-search can clean
  // up the options it is replacing, fare partners and all.
  if (request.existing !== undefined) {
    return { card: request.existing, key: request.existing.id, ephemeral: false };
  }
  return {
    card: {
      id: PENDING_CARD_ID,
      kind: request.kind,
      state: 'unplanned',
      anchor: request.anchor,
      options: [],
    },
    key: request.slotKey,
    ephemeral: true,
  };
}

/** Whether the thing a card is pinned to is still part of the trip. */
function anchorExists(trip: Trip, anchor: CardAnchor): boolean {
  if (anchor.kind === 'connection') {
    return trip.connections.some((c) => c.id === anchor.connectionId);
  }
  return trip.segments.some((s) => s.id === anchor.segmentId);
}

/**
 * Put a search's results on the trip, creating the card first when the slot was empty.
 *
 * Null when the slot no longer exists. Minutes have passed and the app stayed live: the leg may
 * have been deleted, or the card removed, and silently re-creating it would put back something the
 * traveller took away.
 */
export function landSearchResults(
  trip: Trip,
  target: SlotSearchTarget,
  found: readonly Option[],
): DiscoveryOutcome | null {
  if (!target.ephemeral) {
    if (!trip.cards.some((c) => c.id === target.card.id)) return null;
    return applyDiscovery(trip, target.card.id, found);
  }

  if (!anchorExists(trip, target.card.anchor)) return null;

  const id = nextCardId(trip);
  const created: Card = {
    id,
    kind: target.card.kind,
    state: 'unplanned',
    anchor: target.card.anchor,
    options: [],
  };
  // `applyDiscovery` promotes unplanned to exploring once options land, which is exactly what a
  // card born this way should be: candidates gathered, nothing decided.
  return applyDiscovery(addCard(trip, created), id, found);
}
