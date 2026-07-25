import type { IsoDate, WallTime } from './types.js';

/**
 * Date and time arithmetic.
 *
 * Everything runs on UTC internally so results never depend on the machine's timezone. A trip
 * scheduled in Chicago and the same trip scheduled in Amsterdam must produce identical days.
 */

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const WALL_TIME = /^(\d{2}):(\d{2})$/;
const MS_PER_DAY = 86_400_000;

/** Days since the Unix epoch. The scheduler works in these, not in dates. */
export function toDayNumber(date: IsoDate): number {
  const match = ISO_DATE.exec(date);
  if (!match) throw new Error(`Invalid ISO date: ${JSON.stringify(date)}`);

  const [, y, m, d] = match;
  const year = Number(y);
  const month = Number(m);
  const day = Number(d);

  const ms = Date.UTC(year, month - 1, day);
  const roundTrip = new Date(ms);

  // Date.UTC silently rolls invalid input over — Feb 30 becomes Mar 2. Catch that rather than
  // scheduling a trip around a date the user never meant.
  if (
    roundTrip.getUTCFullYear() !== year ||
    roundTrip.getUTCMonth() !== month - 1 ||
    roundTrip.getUTCDate() !== day
  ) {
    throw new Error(`Invalid ISO date: ${JSON.stringify(date)}`);
  }

  return ms / MS_PER_DAY;
}

export function fromDayNumber(dayNumber: number): IsoDate {
  if (!Number.isInteger(dayNumber)) {
    throw new Error(`Day number must be an integer, got ${dayNumber}`);
  }
  const date = new Date(dayNumber * MS_PER_DAY);
  const year = String(date.getUTCFullYear()).padStart(4, '0');
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function addDays(date: IsoDate, days: number): IsoDate {
  return fromDayNumber(toDayNumber(date) + days);
}

/** Nights from `from` to `to`. Negative when `to` precedes `from`. */
export function daysBetween(from: IsoDate, to: IsoDate): number {
  return toDayNumber(to) - toDayNumber(from);
}

/** Minutes since midnight. */
export function toMinutes(time: WallTime): number {
  const match = WALL_TIME.exec(time);
  if (!match) throw new Error(`Invalid wall time: ${JSON.stringify(time)}`);

  const [, h, m] = match;
  const hours = Number(h);
  const minutes = Number(m);
  if (hours > 23 || minutes > 59) {
    throw new Error(`Invalid wall time: ${JSON.stringify(time)}`);
  }
  return hours * 60 + minutes;
}

export function fromMinutes(minutes: number): WallTime {
  if (!Number.isInteger(minutes) || minutes < 0 || minutes > 1439) {
    throw new Error(`Minutes must be an integer in [0, 1439], got ${minutes}`);
  }
  const h = String(Math.floor(minutes / 60)).padStart(2, '0');
  const m = String(minutes % 60).padStart(2, '0');
  return `${h}:${m}`;
}
