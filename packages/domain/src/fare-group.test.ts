import { describe, expect, it } from 'vitest';
import { computeBudget } from './budget.js';
import { detectCompatibilityConflicts } from './compatibility.js';
import { linkReturnLeg, syncConnections } from './edit.js';
import { applyOption, diffTrips } from './evaluate.js';
import { fareGroupPartners, nextFareGroupId, splitFare } from './fare-group.js';
import { schedule } from './scheduler.js';
import { selectOptionInTrip, transitionCardInTrip } from './state.js';
import { card, connection, journeyOption, segment, trip } from './test-support.js';
import type { Option, PlanningState, Trip } from './types.js';

/**
 * A return fare is one purchase filling two slots. These tests pin the two things that go wrong
 * without it: the budget counting the fare twice, and one leg being booked while the other is not.
 */

const leg = (id: string, opts: { date: string; cost: number; group?: string }): Option => ({
  ...journeyOption(id, { departDate: opts.date, cost: opts.cost }),
  ...(opts.group === undefined ? {} : { fareGroupId: opts.group }),
});

/** Boston → Lisbon → home, with a $1,304 return fare split across the two legs. */
function roundTrip(
  opts: { outState?: PlanningState; backState?: PlanningState; rival?: boolean } = {},
): Trip {
  const [outFare, backFare] = splitFare(1304, 2) as [number, number];
  const outbound = leg('out-fare', { date: '2026-09-23', cost: outFare, group: 'fare-1' });
  const rival = leg('out-oneway', { date: '2026-09-23', cost: 700 });

  return trip({
    anchorDate: '2026-09-23',
    length: { min: 5, max: 5 },
    segments: [segment('lis', 'Lisbon', { min: 5, ideal: 5, max: 5 })],
    connections: [connection('leg-1', null, 'lis'), connection('leg-2', 'lis', null)],
    cards: [
      card(
        'card-out',
        'flight',
        { kind: 'connection', connectionId: 'leg-1' },
        opts.rival ? [outbound, rival] : [outbound],
        { state: opts.outState ?? 'selected', selected: 'out-fare' },
      ),
      card(
        'card-back',
        'flight',
        { kind: 'connection', connectionId: 'leg-2' },
        [leg('back-fare', { date: '2026-09-28', cost: backFare, group: 'fare-1' })],
        { state: opts.backState ?? 'selected', selected: 'back-fare' },
      ),
    ],
  });
}

describe('splitting a fare', () => {
  it('divides evenly', () => {
    expect(splitFare(1304, 2)).toEqual([652, 652]);
  });

  // A budget a cent out is a budget the user stops trusting.
  it('adds back up to the fare exactly when it does not divide', () => {
    const parts = splitFare(1304.05, 2);
    expect(parts).toEqual([652.03, 652.02]);
    expect(parts[0]! + parts[1]!).toBeCloseTo(1304.05, 10);
  });
});

describe('fare group ids', () => {
  it('derives from the trip rather than a generator', () => {
    expect(nextFareGroupId(roundTrip())).toBe('fare-2');
    expect(nextFareGroupId(trip())).toBe('fare-1');
  });

  it('finds the other leg, and nothing for an ordinary option', () => {
    const t = roundTrip({ rival: true });
    expect(fareGroupPartners(t, 'card-out', 'out-fare')).toEqual([
      { cardId: 'card-back', optionId: 'back-fare' },
    ]);
    expect(fareGroupPartners(t, 'card-out', 'out-oneway')).toEqual([]);
  });
});

describe('the budget counts the fare once', () => {
  it('totals $1,304 across two legs, not $2,608', () => {
    const t = roundTrip();
    expect(computeBudget(t, schedule(t)).total).toBe(1304);
  });
});

describe('selecting one leg selects its partner', () => {
  it('moves both legs when the grouped option is chosen', () => {
    const t = roundTrip({ rival: true });
    const oneWay = selectOptionInTrip(t, 'card-out', 'out-oneway');
    expect(oneWay.ok).toBe(true);

    const back = oneWay.ok ? selectOptionInTrip(oneWay.trip, 'card-out', 'out-fare') : undefined;
    expect(back?.ok).toBe(true);
    if (!back?.ok) return;
    expect(back.trip.cards.find((c) => c.id === 'card-back')?.selectedOptionId).toBe('back-fare');
  });

  // Abandoning a fare has to free both legs. Left selected, the far half goes on charging $652 for a
  // purchase that no longer exists — and the trip reports the cheaper one-way as costing *more*.
  it('releases the other leg when the fare is abandoned', () => {
    const t = roundTrip({ rival: true });
    const result = selectOptionInTrip(t, 'card-out', 'out-oneway');
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const back = result.trip.cards.find((c) => c.id === 'card-back');
    expect(back?.selectedOptionId).toBeUndefined();
    expect(back?.state).toBe('exploring');
    // The leg is now unflown, and the trip says so rather than hiding it.
    expect(
      detectCompatibilityConflicts(result.trip, schedule(result.trip)).map((c) => c.code),
    ).toContain('MISSING_CONNECTION');
  });

  // One purchase: a committed return leg has to protect the outbound too, or the user unpicks half
  // of something they have already paid for.
  it('refuses when the partner leg is booked', () => {
    const t = roundTrip({ backState: 'booked', rival: true });
    const result = selectOptionInTrip(t, 'card-out', 'out-fare');
    expect(result.ok).toBe(false);
    expect(applyOption(t, 'card-out', 'out-fare')).toBeUndefined();
  });
});

describe('planning state moves as one', () => {
  it('books both legs together', () => {
    const t = roundTrip();
    const result = transitionCardInTrip(t, 'card-out', 'booked');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.trip.cards.map((c) => c.state)).toEqual(['booked', 'booked']);
  });

  it('changes nothing when the partner refuses the transition', () => {
    const t = roundTrip({ backState: 'booked' });
    const result = transitionCardInTrip(t, 'card-out', 'exploring');
    expect(result.ok).toBe(false);
  });

  it('leaves unlinked cards alone', () => {
    const t = roundTrip({ rival: true });
    const picked = selectOptionInTrip(t, 'card-out', 'out-oneway');
    if (!picked.ok) throw new Error('setup failed');
    const result = transitionCardInTrip(picked.trip, 'card-out', 'locked');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Released by the swap above, and locking the one-way must not drag it anywhere.
    expect(result.trip.cards.find((c) => c.id === 'card-back')?.state).toBe('exploring');
  });
});

describe('evaluation swaps both legs', () => {
  // The whole point of speculative apply: a preview that only swapped one leg would report half the
  // fare and rank the one-way as a saving it is not.
  it('reports the whole fare in costDelta, not half', () => {
    const t = roundTrip({ rival: true });
    const oneWay = applyOption(t, 'card-out', 'out-oneway');
    expect(oneWay).toBeDefined();
    if (!oneWay) return;

    // $1,304 return becomes a $700 one-way plus a return leg that is no longer paid for.
    expect(diffTrips(t, oneWay).costDelta).toBe(700 - 1304);
  });
});

describe('a leg with no timing', () => {
  function withPlaceholder(): Trip {
    const t = roundTrip();
    return {
      ...t,
      cards: t.cards.map((c) =>
        c.id === 'card-back'
          ? {
              ...c,
              options: [
                {
                  id: 'back-fare',
                  source: 'user' as const,
                  title: 'Return flight — details unknown',
                  cost: { kind: 'fixed' as const, amount: 652 },
                  fareGroupId: 'fare-1',
                },
              ],
            }
          : c,
      ),
    };
  }

  it('is reported, because MISSING_CONNECTION no longer is', () => {
    const t = withPlaceholder();
    const conflicts = detectCompatibilityConflicts(t, schedule(t));
    expect(conflicts.map((c) => c.code)).toContain('INCOMPLETE_LEG');
    expect(conflicts.map((c) => c.code)).not.toContain('MISSING_CONNECTION');

    const incomplete = conflicts.find((c) => c.code === 'INCOMPLETE_LEG')!;
    expect(incomplete.severity).toBe('warning');
    expect(incomplete.cardIds).toEqual(['card-back']);
    expect(incomplete.flexible.cardIds).toEqual(['card-back']);
  });

  it('stays quiet when both legs are timed', () => {
    const t = roundTrip();
    const codes = detectCompatibilityConflicts(t, schedule(t)).map((c) => c.code);
    expect(codes).not.toContain('INCOMPLETE_LEG');
  });
});

describe('importing a return fare that only showed the outbound', () => {
  /** What the paste flow has just built: one flight card holding the whole $1,304 fare. */
  function outboundOnly(): Trip {
    return trip({
      anchorDate: '2026-09-23',
      length: { min: 5, max: 5 },
      segments: [segment('lis', 'Lisbon', { min: 5, ideal: 5, max: 5 })],
      connections: [connection('leg-1', null, 'lis'), connection('leg-2', 'lis', null)],
      cards: [
        card('card-out', 'flight', { kind: 'connection', connectionId: 'leg-1' }, [
          leg('out-fare', { date: '2026-09-23', cost: 1304 }),
        ]),
      ],
    });
  }

  it('builds a linked, timing-less second leg with half the fare', () => {
    const result = linkReturnLeg(outboundOnly(), 'card-out', 'out-fare', { returnDate: '2026-09-28' });
    expect(result.kind).toBe('linked');
    if (result.kind !== 'linked') return;
    expect(result.complete).toBe(false);

    const back = result.trip.cards.find((c) => c.id === result.returnCardId)!;
    expect(back.anchor).toEqual({ kind: 'connection', connectionId: 'leg-2' });

    const placeholder = back.options[0]!;
    // No timing: the scheduler must float rather than invent a return date it was never told.
    expect(placeholder.timing).toBeUndefined();
    expect(placeholder.detail).toContain('2026-09-28');
    expect(placeholder.cost.amount).toBe(652);

    const outbound = result.trip.cards.find((c) => c.id === 'card-out')!;
    expect(outbound.options[0]!.cost.amount).toBe(652);
    expect(outbound.options[0]!.fareGroupId).toBe(placeholder.fareGroupId);

    // The fare is counted once, and the blank leg says so.
    expect(computeBudget(result.trip, schedule(result.trip)).total).toBe(1304);
    expect(
      detectCompatibilityConflicts(result.trip, schedule(result.trip)).map((c) => c.code),
    ).toContain('INCOMPLETE_LEG');
  });

  // A checkout page states both legs. Building a blank from that throws away what the traveller can
  // already see and then asks them to type it back in.
  it('uses the return leg times the source actually gave', () => {
    const result = linkReturnLeg(outboundOnly(), 'card-out', 'out-fare', {
      returnDate: '2026-09-28',
      returnTiming: {
        kind: 'journey',
        departDate: '2026-09-28',
        departTime: '21:30',
        arriveTime: '09:35',
        nightsInTransit: 1,
        durationMinutes: 845,
      },
    });
    expect(result.kind).toBe('linked');
    if (result.kind !== 'linked') return;

    expect(result.complete).toBe(true);
    const back = result.trip.cards.find((c) => c.id === result.returnCardId)!;
    expect(back.options[0]!.timing).toMatchObject({ departTime: '21:30', nightsInTransit: 1 });

    // A real leg, so nothing is incomplete about it.
    expect(
      detectCompatibilityConflicts(result.trip, schedule(result.trip)).map((c) => c.code),
    ).not.toContain('INCOMPLETE_LEG');
  });

  // Halving the fare here would understate the trip by $652, and selecting the placeholder over the
  // flight they already chose would throw that decision away.
  it('leaves the fare whole when the homeward leg already has a chosen flight', () => {
    const t = outboundOnly();
    const chosen: Trip = {
      ...t,
      cards: [
        ...t.cards,
        card('card-home', 'flight', { kind: 'connection', connectionId: 'leg-2' }, [
          leg('home-1', { date: '2026-09-28', cost: 500 }),
        ]),
      ],
    };
    expect(linkReturnLeg(chosen, 'card-out', 'out-fare', {}).kind).toBe('occupied');
  });

  /**
   * A results list is several return fares at once. Each needs its own group and its own placeholder,
   * so that choosing outbound #2 chooses return #2 — the reason the link lives on the option.
   */
  it('gives every round-trip option its own fare group and placeholder', () => {
    const base = outboundOnly();
    const many: Trip = {
      ...base,
      cards: base.cards.map((c) => {
        if (c.id !== 'card-out') return c;
        // Nothing chosen: three candidates for one slot, none decided.
        const { selectedOptionId: _none, ...rest } = c;
        return {
          ...rest,
          options: [
            c.options[0]!,
            leg('out-2', { date: '2026-09-23', cost: 1301 }),
            leg('out-3', { date: '2026-09-23', cost: 1311 }),
          ],
        };
      }),
    };

    let next = many;
    for (const id of ['out-fare', 'out-2', 'out-3']) {
      const result = linkReturnLeg(next, 'card-out', id, {});
      expect(result.kind).toBe('linked');
      if (result.kind !== 'linked') return;
      next = result.trip;
    }

    // One homeward card, three placeholders, three distinct groups.
    const back = next.cards.filter((c) => c.id !== 'card-out');
    expect(back).toHaveLength(1);
    expect(back[0]!.options).toHaveLength(3);
    expect(new Set(back[0]!.options.map((o) => o.fareGroupId)).size).toBe(3);

    // Nothing was chosen on either leg, so nothing is being paid for yet.
    expect(back[0]!.selectedOptionId).toBeUndefined();
    expect(computeBudget(next, schedule(next)).total).toBe(0);

    // Choosing the second outbound fare brings exactly its own partner with it.
    const picked = selectOptionInTrip(next, 'card-out', 'out-2');
    expect(picked.ok).toBe(true);
    if (!picked.ok) return;
    expect(computeBudget(picked.trip, schedule(picked.trip)).total).toBe(1301);
  });
});

describe('a group that loses a leg', () => {
  it('is unpicked and reported rather than left holding half a price', () => {
    const t = roundTrip();
    // Dropping the stop takes its legs with it, and one half of the fare goes with them.
    const result = syncConnections({ ...t, segments: [] });

    expect(result.removedCardIds).toContain('card-back');
    expect(result.unpairedCardIds).toEqual([]);
  });

  it('strips the id from a survivor when its partner card is gone', () => {
    const t = roundTrip();
    const orphaned = { ...t, cards: t.cards.filter((c) => c.id !== 'card-back') };
    const result = syncConnections(orphaned);

    expect(result.unpairedCardIds).toEqual(['card-out']);
    const survivor = result.trip.cards.find((c) => c.id === 'card-out');
    expect(survivor?.options[0]?.fareGroupId).toBeUndefined();
  });
});
