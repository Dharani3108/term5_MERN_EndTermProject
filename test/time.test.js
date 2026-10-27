import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as t from '../src/lib/time.js';

const TZ = 'Asia/Kolkata';

test('zonedToUtc converts campus wall time to UTC', () => {
  assert.equal(new Date(t.zonedToUtc('2026-11-02', 9 * 60, TZ)).toISOString(), '2026-11-02T03:30:00.000Z');
  assert.equal(new Date(t.zonedToUtc('2026-11-02', 0, TZ)).toISOString(), '2026-11-01T18:30:00.000Z');
});

test('zonedToUtc handles daylight-saving zones', () => {
  // New York switched back to EST on 1 Nov 2026.
  assert.equal(new Date(t.zonedToUtc('2026-10-31', 12 * 60, 'America/New_York')).toISOString(), '2026-10-31T16:00:00.000Z');
  assert.equal(new Date(t.zonedToUtc('2026-11-02', 12 * 60, 'America/New_York')).toISOString(), '2026-11-02T17:00:00.000Z');
});

test('localDate and minuteOfDay read the campus calendar', () => {
  const ms = Date.parse('2026-11-01T20:00:00Z'); // 01:30 on 2 Nov in IST
  assert.equal(t.localDate(ms, TZ), '2026-11-02');
  assert.equal(t.minuteOfDay(ms, TZ), 90);
});

test('weekBounds returns Monday-to-Monday in campus time', () => {
  const [start, end] = t.weekBounds(t.zonedToUtc('2026-11-05', 600, TZ), TZ);
  assert.equal(t.localDate(start, TZ), '2026-11-02');
  assert.equal(t.minuteOfDay(start, TZ), 0);
  assert.equal(end - start, 7 * t.DAY);
});

test('date and time parsing rejects invalid input', () => {
  assert.equal(t.isValidDateStr('2026-02-30'), false);
  assert.equal(t.isValidDateStr('2026-02-28'), true);
  assert.equal(t.parseHHMM('25:00'), null);
  assert.equal(t.parseHHMM('24:00'), 1440);
  assert.equal(t.parseLocalDateTime('2026-11-02T10:00', TZ), Date.parse('2026-11-02T04:30:00Z'));
  assert.equal(t.parseLocalDateTime('nonsense', TZ), null);
});
