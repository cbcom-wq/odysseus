import { computeBudget, rankOptions, schedule } from '@odysseus/domain';
import { describe, expect, it } from 'vitest';
import { buildFixtureTrip } from './fixture-trip.js';
import { buildNewTrip } from './new-trip.js';

describe('the fixture reproduces the mockup', () => {
  const trip = buildFixtureTrip();
  const result = schedule(trip);
  const dates = Object.fromEntries(result.segments.map((s) => [s.segmentId, s.startDate]));

  it('starts each city on the day the design shows', () => {
    expect(dates).toEqual({
      ams: '2026-09-23',
      bru: '2026-09-25',
      par: '2026-09-27',
    });
  });

  it('begins when you leave home, not when you land', () => {
    // The inbound red-eye departs Sep 22 and lands the morning of Sep 23, so day 0 is the 22nd and
    // Amsterdam's first night is the 23rd. Ten nights away, nine of them in a hotel.
    expect(result.startDate).toBe('2026-09-22');
    expect(result.totalNights).toBe(10);
    expect(result.totalDays).toBe(11);
  });

  it('resolves without conflicts as shipped', () => {
    // The demo has to open clean. Conflicts should appear because of something the user did, not
    // because the seed data was wrong.
    expect(result.conflicts).toEqual([]);
  });

  it('bills the first day in Amsterdam at $190', () => {
    // taxi $38 + hotel $110 + canal cruise $42. The mockup shows $832 on this day by also counting
    // the $642 airfare here, but that flight departs the night before, so its fare sits on Sep 22.
    const budget = computeBudget(trip, result);
    expect(budget.byDay[0]!.amount).toBe(642); // Sep 22 — the flight
    expect(budget.byDay[1]!.amount).toBe(190); // Sep 23 — first day on the ground
    expect(budget.byDay[0]!.amount + budget.byDay[1]!.amount).toBe(832);
  });
});

describe('the alternatives genuinely trade off', () => {
  // If every option differed only in price, the Workspace would have nothing to demonstrate. These
  // assertions are really about the demo being worth looking at.
  const trip = buildFixtureTrip();
  const flights = rankOptions(trip, 'c-inbound');
  const byId = Object.fromEntries(flights.map((f) => [f.option.id, f]));

  it('offers a cheaper flight that costs most of the first day', () => {
    const klm = byId.kl602!;
    expect(klm.impact.costDelta).toBe(-96);
    expect(klm.impact.usableHoursDelta).toBeLessThan(-8);
  });

  it('demotes that flight below the current one and says what breaks', () => {
    // It lands at 21:55, after the 19:30 canal cruise has already sailed.
    expect(klmRank()).toBeGreaterThan(currentRank());
    expect(byId.kl602!.warning).toBeDefined();

    function klmRank() {
      return flights.findIndex((f) => f.option.id === 'kl602');
    }
    function currentRank() {
      return flights.findIndex((f) => f.isCurrent);
    }
  });

  it('offers a dearer flight that buys back real time', () => {
    const af = byId.af1243!;
    expect(af.impact.costDelta).toBe(46);
    expect(af.impact.usableHoursDelta).toBeCloseTo(1.75, 2);
  });

  it('keeps every alternative visible, including the conflicting one', () => {
    expect(flights).toHaveLength(5);
  });

  it('offers a hotel that trades nightly rate against location', () => {
    const hotels = rankOptions(trip, 'c-ams-hotel');
    const cheaper = hotels.find((h) => h.option.id === 'zaan')!;
    const dearer = hotels.find((h) => h.option.id === 'canal')!;

    expect(cheaper.impact.costDelta).toBeLessThan(0);
    expect(dearer.impact.costDelta).toBeGreaterThan(0);
  });

  it('offers train and plane for the same leg', () => {
    const legs = rankOptions(trip, 'c-bru-par');
    expect(legs.map((l) => l.option.id).sort()).toEqual(['af-par', 'tgv-par']);
    expect(legs.find((l) => l.option.id === 'tgv-par')!.impact.costDelta).toBe(-46);
  });
});

describe('a new trip', () => {
  it('is usable with nothing but destination names', () => {
    const trip = buildNewTrip({
      name: 'Japan in spring',
      travelers: 2,
      nights: { min: 10, max: 14 },
      destinations: ['Tokyo', 'Kyoto'],
    });
    const result = schedule(trip);

    expect(result.segments.map((s) => s.segmentId)).toEqual(['tokyo', 'kyoto']);
    expect(result.totalNights).toBe(6);
    expect(result.startDate).toBeUndefined(); // undated, and that is fine
  });

  it('does not collide when a destination repeats', () => {
    const trip = buildNewTrip({
      name: 'Round trip',
      travelers: 1,
      nights: { min: 4, max: 8 },
      destinations: ['Tokyo', 'Kyoto', 'Tokyo'],
    });
    expect(trip.segments.map((s) => s.id)).toEqual(['tokyo', 'kyoto', 'tokyo-2']);
  });
});
