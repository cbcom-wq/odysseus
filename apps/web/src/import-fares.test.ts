import type { Trip } from '@odysseus/domain';
import { SCHEMA_VERSION } from '@odysseus/domain';
import type { ExtractedFields } from '@odysseus/extraction';
import { describe, expect, it } from 'vitest';
import { linkImportedFares } from './import-fares.js';

/**
 * A return fare pasted onto a card that already holds one.
 *
 * The second flight a traveller compares arrives through "add an option", not through a new card,
 * and it is a round trip for the same reason the first one was. Without the leg home the trip says
 * nothing gets you back — while quietly carrying the whole return price on the outbound.
 */

const nothing: ExtractedFields = {
  kind: null,
  title: null,
  detail: null,
  amount: null,
  perNight: null,
  perTraveler: null,
  departDate: null,
  departTime: null,
  arriveTime: null,
  overnight: null,
  durationMinutes: null,
  startTime: null,
  endTime: null,
  roundTrip: null,
  returnDate: null,
  returnDepartTime: null,
  returnArriveTime: null,
  returnOvernight: null,
  returnDurationMinutes: null,
  confidence: null,
  warnings: null,
};

const listing = (overrides: Partial<ExtractedFields>): ExtractedFields => ({
  ...nothing,
  kind: 'flight',
  roundTrip: true,
  ...overrides,
});

const flight = (id: string, departDate: string, amount: number, group?: string) => ({
  id,
  source: 'user' as const,
  title: id,
  cost: { kind: 'fixed' as const, amount },
  timing: {
    kind: 'journey' as const,
    departDate,
    departTime: '17:26',
    arriveTime: '09:35',
    nightsInTransit: 1 as const,
    durationMinutes: 789,
  },
  ...(group === undefined ? {} : { fareGroupId: group }),
});

/** Kansas City → São Paulo and home, with one round-trip fare already chosen and split. */
function tripWithChosenRoundTrip(): Trip {
  return {
    id: 'trip-1',
    name: 'Brazil',
    travelers: 1,
    anchorDate: '2026-09-23',
    length: { min: 7, max: 7 },
    currency: 'USD',
    segments: [{ id: 'sao', location: { name: 'São Paulo' }, duration: { min: 7, ideal: 7, max: 7 } }],
    connections: [
      { id: 'leg-1', fromSegmentId: null, toSegmentId: 'sao' },
      { id: 'leg-2', fromSegmentId: 'sao', toSegmentId: null },
    ],
    cards: [
      {
        id: 'card-1',
        kind: 'flight',
        state: 'exploring',
        anchor: { kind: 'connection', connectionId: 'leg-1' },
        options: [flight('card-1-opt-1', '2026-09-23', 729, 'fare-1')],
        selectedOptionId: 'card-1-opt-1',
      },
      {
        id: 'card-2',
        kind: 'flight',
        state: 'exploring',
        anchor: { kind: 'connection', connectionId: 'leg-2' },
        options: [flight('card-2-opt-1', '2026-09-30', 729, 'fare-1')],
        selectedOptionId: 'card-2-opt-1',
      },
    ],
    preferences: { ranking: 'balanced', dayStart: '08:00', dayEnd: '22:00' },
    schemaVersion: SCHEMA_VERSION,
  };
}

describe('linking an imported return fare', () => {
  it('gives a rival round trip its own leg home on the card that already has one', () => {
    const before = tripWithChosenRoundTrip();
    const withRival: Trip = {
      ...before,
      cards: before.cards.map((c) =>
        c.id !== 'card-1'
          ? c
          : { ...c, options: [...c.options, flight('card-1-opt-2', '2026-09-23', 2895)] },
      ),
    };

    const result = linkImportedFares(withRival, 'card-1', [
      { optionId: 'card-1-opt-2', source: listing({ returnDate: '2026-09-30' }) },
    ]);

    const outbound = result.trip.cards.find((c) => c.id === 'card-1');
    const homeward = result.trip.cards.find((c) => c.id === 'card-2');
    const rival = outbound?.options.find((o) => o.id === 'card-1-opt-2');
    const back = homeward?.options.find((o) => o.fareGroupId === rival?.fareGroupId);

    expect(back).toBeDefined();
    // Half the fare each, and the pair moves as one purchase.
    expect(rival?.cost.amount).toBe(1447.5);
    expect(back?.cost.amount).toBe(1447.5);
    expect(rival?.fareGroupId).not.toBe('fare-1');
    // The traveller's existing choice stands: a rival arriving is not a decision.
    expect(homeward?.selectedOptionId).toBe('card-2-opt-1');
    expect(result.occupied).toBe(false);
    expect(result.promptCardId).toBe('card-2');
  });

  it('keeps the return times the listing gave, so nothing is asked for twice', () => {
    const before = tripWithChosenRoundTrip();
    const withRival: Trip = {
      ...before,
      cards: before.cards.map((c) =>
        c.id !== 'card-1'
          ? c
          : { ...c, options: [...c.options, flight('card-1-opt-2', '2026-09-23', 2895)] },
      ),
    };

    const result = linkImportedFares(withRival, 'card-1', [
      {
        optionId: 'card-1-opt-2',
        source: listing({
          returnDate: '2026-09-30',
          returnDepartTime: '21:40',
          returnArriveTime: '06:15',
          returnOvernight: true,
          returnDurationMinutes: 515,
        }),
      },
    ]);

    const back = result.trip.cards
      .find((c) => c.id === 'card-2')
      ?.options.find((o) => o.id !== 'card-2-opt-1');

    expect(back?.timing).toEqual({
      kind: 'journey',
      departDate: '2026-09-30',
      departTime: '21:40',
      arriveTime: '06:15',
      nightsInTransit: 1,
      durationMinutes: 515,
    });
    expect(result.promptCardId).toBeNull();
  });

  it('leaves a one-way alone', () => {
    const before = tripWithChosenRoundTrip();
    const withRival: Trip = {
      ...before,
      cards: before.cards.map((c) =>
        c.id !== 'card-1'
          ? c
          : { ...c, options: [...c.options, flight('card-1-opt-2', '2026-09-23', 700)] },
      ),
    };

    const result = linkImportedFares(withRival, 'card-1', [
      { optionId: 'card-1-opt-2', source: listing({ roundTrip: false }) },
    ]);

    expect(result.trip).toEqual(withRival);
    expect(result.promptCardId).toBeNull();
    expect(result.occupied).toBe(false);
  });

  it('leaves a card that is not about flying alone', () => {
    const before = tripWithChosenRoundTrip();
    const train: Trip = {
      ...before,
      cards: before.cards.map((c) =>
        c.id !== 'card-1' ? c : { ...c, kind: 'transport' as const },
      ),
    };

    const result = linkImportedFares(train, 'card-1', [
      { optionId: 'card-1-opt-1', source: listing({ returnDate: '2026-09-30' }) },
    ]);

    expect(result.trip).toEqual(train);
  });

  it('says the leg home is taken when it holds a flight of its own', () => {
    const before = tripWithChosenRoundTrip();
    const soloReturn: Trip = {
      ...before,
      cards: before.cards.map((c) => {
        if (c.id === 'card-1') {
          return {
            ...c,
            options: [flight('card-1-opt-1', '2026-09-23', 2895)],
            selectedOptionId: 'card-1-opt-1',
          };
        }
        // A leg home the traveller chose themselves, not half of anything.
        return { ...c, options: [flight('card-2-opt-1', '2026-09-30', 500)] };
      }),
    };

    const result = linkImportedFares(soloReturn, 'card-1', [
      { optionId: 'card-1-opt-1', source: listing({ returnDate: '2026-09-30' }) },
    ]);

    expect(result.occupied).toBe(true);
    expect(result.trip).toEqual(soloReturn);
  });
});
