import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup, teardown, at, codeOf, MONDAY, MIN } from './helpers.js';
import { clock } from '../src/lib/clock.js';
import { addDays } from '../src/lib/time.js';
import { runJobs } from '../src/jobs/scheduler.js';
import { createBooking, checkIn, listMyBookings, strikeInfo } from '../src/services/bookingService.js';
import { joinWaitlist, listMyWaitlist } from '../src/services/waitlistService.js';
import { listNotifications } from '../src/services/notificationService.js';
import { getAnalytics } from '../src/services/adminService.js';

let f;
beforeEach(async () => {
  f = await setup();
});
after(teardown);

const bookOn = (user, date, start, end, resource = f.room) =>
  createBooking(user, { resourceId: resource.id, startAt: at(date, start), endAt: at(date, end) }).booking;

test('unclaimed bookings are released as no-shows and offered to the waitlist', () => {
  const b = bookOn(f.alice, MONDAY, '10:00', '12:00');
  joinWaitlist(f.bob, { resourceId: f.room.id, startAt: at(MONDAY, '11:00'), endAt: at(MONDAY, '12:00') });

  clock.set(at(MONDAY, '10:14'));
  assert.equal(runJobs().noShows, 0, 'still inside the grace period');

  clock.set(at(MONDAY, '10:16'));
  const r = runJobs();
  assert.equal(r.noShows, 1);
  assert.equal(r.promoted, 1);
  assert.equal(listMyBookings(f.alice, 'past')[0].status, 'no_show');
  assert.equal(listMyBookings(f.bob)[0].source, 'waitlist');
  assert.match(listNotifications(f.alice.id).items[0].message, /1 of 3/);

  // Idempotent: a second run changes nothing.
  assert.equal(runJobs().noShows, 0);
  assert.ok(b.id);
});

test('three no-shows within 30 days pause booking until the oldest ages out', () => {
  for (const d of [0, 1, 2]) {
    const date = addDays(MONDAY, d);
    clock.set(at(date, '09:00'));
    bookOn(f.alice, date, '10:00', '10:30');
    clock.set(at(date, '10:20'));
    runJobs();
  }
  const now = clock.now();
  const s = strikeInfo(f.alice.id, now);
  assert.equal(s.count, 3);
  assert.equal(s.suspendedUntil, at(MONDAY, '10:00') + 30 * 86_400_000);
  const date = addDays(MONDAY, 3);
  const code = codeOf(() => createBooking(f.alice, { resourceId: f.room.id, startAt: at(date, '10:00'), endAt: at(date, '11:00') }));
  assert.equal(code, 'BOOKING_SUSPENDED');

  clock.set(s.suspendedUntil + MIN);
  const later = addDays(MONDAY, 31);
  assert.equal(
    createBooking(f.alice, { resourceId: f.room.id, startAt: at(later, '12:00'), endAt: at(later, '13:00') }).booking.status,
    'confirmed',
  );
});

test('checked-in bookings complete after they end and count as usage', () => {
  const b = bookOn(f.alice, MONDAY, '10:00', '11:00');
  clock.set(at(MONDAY, '10:02'));
  checkIn(f.alice, b.id);
  clock.set(at(MONDAY, '11:00'));
  assert.equal(runJobs().completed, 1);
  assert.equal(listMyBookings(f.alice, 'past')[0].status, 'completed');

  clock.set(at(addDays(MONDAY, 1), '09:00'));
  const a = getAnalytics(7);
  const room = a.perResource.find((r) => r.id === f.room.id);
  assert.equal(room.usedMinutes, 60);
  assert.equal(a.totals.completed, 1);
});

test('reminders are sent once, shortly before the start', () => {
  bookOn(f.alice, MONDAY, '12:00', '13:00');
  clock.set(at(MONDAY, '11:00'));
  assert.equal(runJobs().reminders, 0);
  clock.set(at(MONDAY, '11:31'));
  assert.equal(runJobs().reminders, 1);
  assert.equal(runJobs().reminders, 0);
  assert.match(listNotifications(f.alice.id).items[0].message, /Reminder/);
});

test('waitlist entries expire when their slot starts without opening up', () => {
  bookOn(f.alice, MONDAY, '10:00', '11:00');
  joinWaitlist(f.bob, { resourceId: f.room.id, startAt: at(MONDAY, '10:00'), endAt: at(MONDAY, '11:00') });
  clock.set(at(MONDAY, '10:05'));
  checkIn(f.alice, listMyBookings(f.alice)[0].id);
  assert.equal(runJobs().expiredWaitlist, 1);
  assert.equal(listMyWaitlist(f.bob)[0].status, 'expired');
});
