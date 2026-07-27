import type { Option, Trip } from '@odysseus/domain';

const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function parts(iso: string): { y: number; m: number; d: number; dow: number } {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  // UTC throughout, so a date never shifts because of where the machine is.
  return { y, m, d, dow: new Date(Date.UTC(y, m - 1, d)).getUTCDay() };
}

export function weekday(iso: string): string {
  return WEEKDAY[parts(iso).dow]!;
}

export function shortDate(iso: string): string {
  const { m, d } = parts(iso);
  return `${MONTH[m - 1]} ${d}`;
}

export function dateRange(from: string, to: string): string {
  const a = parts(from);
  const b = parts(to);
  const left = `${MONTH[a.m - 1]} ${a.d}`;
  const right = a.m === b.m ? `${b.d}` : `${MONTH[b.m - 1]} ${b.d}`;
  return `${left} – ${right}, ${b.y}`;
}

/**
 * Currencies worth a symbol. Everything else prints its code.
 *
 * The alternative — rendering an unknown currency as a bare number — is how a trip priced in euros
 * came to read as though it were priced in nothing at all.
 */
const SYMBOL: Readonly<Record<string, string>> = {
  USD: '$',
  EUR: '€',
  GBP: '£',
  JPY: '¥',
  CAD: 'CA$',
  AUD: 'A$',
  CHF: 'CHF ',
};

function withCurrency(magnitude: number, currency: string): string {
  const digits = magnitude.toLocaleString('en-US');
  const symbol = SYMBOL[currency];
  return symbol === undefined ? `${digits} ${currency}` : `${symbol}${digits}`;
}

export function money(amount: number, currency = 'USD'): string {
  const rounded = Math.round(amount);
  return `${rounded < 0 ? '−' : ''}${withCurrency(Math.abs(rounded), currency)}`;
}

/** Signed money, for deltas. The sign is doing the work colour would otherwise do. */
export function moneyDelta(amount: number, currency = 'USD'): string {
  const rounded = Math.round(amount);
  if (rounded === 0) return 'same cost';
  return `${rounded > 0 ? '+' : '−'}${withCurrency(Math.abs(rounded), currency)}`;
}

export function duration(minutes: number): string {
  const h = Math.floor(Math.abs(minutes) / 60);
  const m = Math.abs(minutes) % 60;
  return h === 0 ? `${m}m` : m === 0 ? `${h}h` : `${h}h ${m}m`;
}

/**
 * What the time figure means, spelled out.
 *
 * "−5h 35m" next to a price reads as a second price, and a tester had to solve for the day window
 * across two rows to work out whether it meant more transit or less of the trip. Say which.
 */
export function hoursDelta(hours: number): string {
  const minutes = Math.round(hours * 60);
  if (minutes === 0) return 'same time on the ground';
  return `${duration(minutes)} ${minutes > 0 ? 'more' : 'less'} on the ground`;
}

/** The assumption behind every usable-hours figure, said once where the numbers are. */
export function groundTimeBasis(trip: Trip): string {
  return (
    `“On the ground” counts waking hours at a destination, between ${trip.preferences.dayStart} ` +
    `and ${trip.preferences.dayEnd}, after travel, getting to and from the terminal, time checked ` +
    `out of a hotel, and sleep lost to travelling overnight.`
  );
}

/** The line of times under an option: what a timetable would print. */
export function optionTiming(option: Option): string | undefined {
  const t = option.timing;
  if (!t) return undefined;
  if (t.kind === 'slot') return `${t.startTime} – ${t.endTime}`;
  if (t.kind === 'stay') return `${shortDate(t.checkIn)} → ${shortDate(t.checkOut)}`;
  const overnight = t.nightsInTransit > 0 ? ' +1' : '';
  return `${t.departTime} → ${t.arriveTime}${overnight} · ${duration(t.durationMinutes)}`;
}

export function optionCost(option: Option, currency: string): string {
  return option.cost.kind === 'per-night'
    ? `${money(option.cost.amount, currency)}/night`
    : money(option.cost.amount, currency);
}

export function tripSubtitle(trip: Trip, nights: number, days: number): string {
  const travelers = `${trip.travelers} ${trip.travelers === 1 ? 'traveller' : 'travellers'}`;
  return `${days} days · ${nights} nights · ${travelers}`;
}
