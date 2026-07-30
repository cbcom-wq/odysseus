import { kindsForAnchor } from '@odysseus/domain';
import type { CardAnchor, CardKind } from '@odysseus/domain';
import { describe, expect, it } from 'vitest';
import { orderedKinds, tabForKind } from './SlotList.js';

describe('tabForKind', () => {
  // One card, one home: every kind the domain can produce must land on exactly the tab a
  // traveller would look for it under. `dining` and `note` have no tab of their own and share
  // Activities, the same place they already sit in the day grid's third column.
  const cases: readonly [CardKind, string][] = [
    ['flight', 'flights'],
    ['lodging', 'lodging'],
    ['transport', 'transport'],
    ['activity', 'activities'],
    ['dining', 'activities'],
    ['note', 'activities'],
  ];

  it.each(cases)('routes a %s card to the %s tab', (kind, tab) => {
    expect(tabForKind(kind)).toBe(tab);
  });
});

describe('orderedKinds', () => {
  const connection: CardAnchor = { kind: 'connection', connectionId: 'leg-1' };
  const segment: CardAnchor = { kind: 'segment', segmentId: 'lis' };
  const segmentDay: CardAnchor = { kind: 'segment-day', segmentId: 'lis', dayOffset: 0 };

  it("puts the Flights tab's own kind first for a connection", () => {
    expect(orderedKinds(connection, 'flight')).toEqual(['flight', 'transport']);
  });

  it("puts the Transport tab's own kind first for the same connection", () => {
    expect(orderedKinds(connection, 'transport')).toEqual(['transport', 'flight']);
  });

  // Reordered, never filtered: the legal set for each anchor kind must survive untouched, just
  // resorted, or adding a train from the Flights tab would quietly stop being offered.
  it.each([
    ['connection', connection, 'flight'],
    ['segment', segment, 'lodging'],
    ['segment-day', segmentDay, 'activity'],
  ] as const)('never drops a legal kind for a %s anchor', (_label, anchor, preferred) => {
    const legal = kindsForAnchor(anchor.kind);
    expect(new Set(orderedKinds(anchor, preferred))).toEqual(new Set(legal));
    expect(orderedKinds(anchor, preferred)).toHaveLength(legal.length);
  });

  it('returns the legal set unchanged when the preferred kind is not legal for the anchor', () => {
    // A lodging tab's kind has no business on a connection — `orderedKinds` must not silently
    // invent a slot for it, just hand back the connection's own legal kinds untouched.
    expect(orderedKinds(connection, 'lodging')).toEqual(kindsForAnchor('connection'));
  });
});
