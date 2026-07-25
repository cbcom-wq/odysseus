import { describe, expect, it } from 'vitest';
import { addDays, daysBetween, fromDayNumber, fromMinutes, toDayNumber, toMinutes } from './dates.js';

describe('day numbers', () => {
  it('round-trips dates', () => {
    for (const date of ['1970-01-01', '2026-09-23', '2026-12-31', '2028-02-29']) {
      expect(fromDayNumber(toDayNumber(date))).toBe(date);
    }
  });

  it('does not depend on the local timezone', () => {
    // Whatever TZ the test machine is in, these must hold. A trip planned in Chicago and the same
    // trip planned in Amsterdam have to produce identical days.
    expect(daysBetween('2026-09-23', '2026-09-25')).toBe(2);
    expect(addDays('2026-09-23', 2)).toBe('2026-09-25');
  });

  it('crosses month and year boundaries', () => {
    expect(addDays('2026-09-30', 1)).toBe('2026-10-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(daysBetween('2026-09-27', '2026-10-02')).toBe(5);
  });

  it('handles leap days', () => {
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2027-02-28', 1)).toBe('2027-03-01');
  });

  it('returns negative spans when the order is reversed', () => {
    expect(daysBetween('2026-09-25', '2026-09-23')).toBe(-2);
  });

  it('rejects dates that do not exist rather than silently rolling over', () => {
    // Date.UTC turns Feb 30 into Mar 2. Scheduling a trip around a date the user never meant is
    // worse than failing.
    expect(() => toDayNumber('2026-02-30')).toThrow(/Invalid ISO date/);
    expect(() => toDayNumber('2026-13-01')).toThrow(/Invalid ISO date/);
    expect(() => toDayNumber('2026-9-3')).toThrow(/Invalid ISO date/);
    expect(() => toDayNumber('not a date')).toThrow(/Invalid ISO date/);
  });
});

describe('wall times', () => {
  it('round-trips', () => {
    for (const time of ['00:00', '08:41', '19:45', '23:59']) {
      expect(fromMinutes(toMinutes(time))).toBe(time);
    }
  });

  it('converts to minutes since midnight', () => {
    expect(toMinutes('00:00')).toBe(0);
    expect(toMinutes('08:41')).toBe(521);
    expect(toMinutes('23:59')).toBe(1439);
  });

  it('rejects malformed and out-of-range times', () => {
    expect(() => toMinutes('24:00')).toThrow(/Invalid wall time/);
    expect(() => toMinutes('12:60')).toThrow(/Invalid wall time/);
    expect(() => toMinutes('8:41')).toThrow(/Invalid wall time/);
  });
});
