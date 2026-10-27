// Timezone-aware helpers. All instants are stored as UTC epoch milliseconds;
// opening hours, day boundaries and weeks are evaluated in the campus timezone.
import { config } from '../config.js';

export const MINUTE = 60_000;
export const DAY = 86_400_000;

const formatters = new Map();
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function partsFormatter(tz) {
  if (!formatters.has(tz)) {
    formatters.set(
      tz,
      new Intl.DateTimeFormat('en-US', {
        timeZone: tz,
        hourCycle: 'h23',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        weekday: 'short',
      }),
    );
  }
  return formatters.get(tz);
}

export function zonedParts(ms, tz = config.timezone) {
  const p = {};
  for (const { type, value } of partsFormatter(tz).formatToParts(new Date(ms))) p[type] = value;
  return {
    year: Number(p.year),
    month: Number(p.month),
    day: Number(p.day),
    hour: Number(p.hour) % 24,
    minute: Number(p.minute),
    second: Number(p.second),
    weekday: WEEKDAYS.indexOf(p.weekday),
  };
}

const pad = (n) => String(n).padStart(2, '0');

/** Local calendar date (YYYY-MM-DD) of an instant in the campus timezone. */
export function localDate(ms, tz = config.timezone) {
  const p = zonedParts(ms, tz);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

/** Minutes since local midnight of an instant in the campus timezone. */
export function minuteOfDay(ms, tz = config.timezone) {
  const p = zonedParts(ms, tz);
  return p.hour * 60 + p.minute;
}

/** Converts a local wall-clock time (date + minutes since midnight) to UTC ms. */
export function zonedToUtc(dateStr, minutes = 0, tz = config.timezone) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const naive = Date.UTC(y, m - 1, d, 0, minutes);
  let guess = naive;
  // Two correction passes handle offset changes (DST) around the target time.
  for (let i = 0; i < 2; i++) {
    const p = zonedParts(guess, tz);
    const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
    guess += naive - asUtc;
  }
  return guess;
}

export function isValidDateStr(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

export function addDays(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

/** 0 = Sunday ... 6 = Saturday */
export function weekdayOf(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function hhmm(minutes) {
  return `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
}

/** "HH:MM" to minutes since midnight. "24:00" is accepted as end of day. */
export function parseHHMM(s) {
  if (s === '24:00') return 1440;
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(s || '');
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

/** Parses "YYYY-MM-DDTHH:MM" as a campus-local wall time. */
export function parseLocalDateTime(s, tz = config.timezone) {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})$/.exec(s || '');
  if (!m || !isValidDateStr(m[1])) return null;
  const minutes = parseHHMM(m[2]);
  if (minutes === null || minutes === 1440) return null;
  return zonedToUtc(m[1], minutes, tz);
}

/** [start, end) of the Monday-based week (campus time) containing the instant. */
export function weekBounds(ms, tz = config.timezone) {
  const date = localDate(ms, tz);
  const monday = addDays(date, -((weekdayOf(date) + 6) % 7));
  return [zonedToUtc(monday, 0, tz), zonedToUtc(addDays(monday, 7), 0, tz)];
}

export function formatLocal(ms, tz = config.timezone) {
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: tz,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(ms));
}

export function formatTime(ms, tz = config.timezone) {
  return hhmm(minuteOfDay(ms, tz));
}

export const toIso = (ms) => (ms === null || ms === undefined ? null : new Date(ms).toISOString());
