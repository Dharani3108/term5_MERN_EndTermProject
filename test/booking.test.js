import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup, teardown, at, codeOf, MONDAY, NOW, MIN } from './helpers.js';
import { clock } from '../src/lib/clock.js';
import { addDays } from '../src/lib/time.js';
import { createBooking, cancelBooking, checkIn, listMyBookings } from '../src/services/bookingService.js';
import { joinWaitlist, listMyWaitlist } from '../src/services/waitlistService.js';
import { getAvailability, setResourceActive } from '../src/services/resourceService.js';
import { createBlackout } from '../src/services/adminService.js';
import { listNotifications } from '../src/services/notificationService.js';

let f;
beforeEach(async () => {
  f = await setup();
});
after(teardown);

const book = (user, start, end, extra = {}, opts = {}) =>
  createBooking(user, { resourceId: f.room.id, startAt: at(MONDAY, start), endAt: at(MONDAY, end), ...extra }, opts);

test('books a free slot', () => {
  const { booking, replayed } = book(f.alice, '10:00', '11:00', { attendees: 2, purpose: 'Revision' });
  assert.equal(booking.status, 'confirmed');
  assert.equal(booking.attendees, 2);
  assert.equal(replayed, false);
});

test('rejects overlapping bookings but allows back-to-back ones', () => {
  book(f.alice, '10:00', '11:00');
  assert.equal(codeOf(() => book(f.bob, '10:30', '11:30')), 'SLOT_TAKEN');
  assert.equal(codeOf(() => book(f.bob, '09:30', '10:30')), 'SLOT_TAKEN');
  assert.equal(book(f.bob, '11:00', '12:00').booking.status, 'confirmed');
  assert.equal(book(f.carol, '09:30', '10:00').booking.status, 'confirmed');
});

test('a user cannot be in two places at once', () => {
  book(f.alice, '10:00', '11:00');
  const code = codeOf(() =>
    createBooking(f.alice, { resourceId: f.room2.id, startAt: at(MONDAY, '10:30'), endAt: at(MONDAY, '11:30') }),
  );
  assert.equal(code, 'SELF_CONFLICT');
});

test('enforces slot shape, hours, duration, capacity and booking window', () => {
  assert.equal(codeOf(() => book(f.alice, '10:10', '11:00')), 'MISALIGNED_SLOT');
  assert.equal(codeOf(() => book(f.alice, '11:00', '10:00')), 'INVALID_RANGE');
  assert.equal(codeOf(() => book(f.alice, '07:30', '08:30')), 'OUTSIDE_HOURS');
  assert.equal(codeOf(() => book(f.alice, '21:30', '22:30')), 'OUTSIDE_HOURS');
  assert.equal(codeOf(() => book(f.alice, '10:00', '13:30')), 'TOO_LONG');
  assert.equal(codeOf(() => book(f.alice, '08:00', '08:30')), 'IN_PAST');
  assert.equal(codeOf(() => book(f.alice, '10:00', '11:00', { attendees: 5 })), 'OVER_CAPACITY');
  const far = addDays(MONDAY, 15);
  const code = codeOf(() => createBooking(f.alice, { resourceId: f.room.id, startAt: at(far, '10:00'), endAt: at(far, '11:00') }));
  assert.equal(code, 'OUTSIDE_WINDOW');
});

test('idempotency key replays the original booking instead of duplicating', () => {
  const first = book(f.alice, '10:00', '11:00', {}, { idempotencyKey: 'key-123456' });
  const again = book(f.alice, '10:00', '11:00', {}, { idempotencyKey: 'key-123456' });
  assert.equal(again.replayed, true);
  assert.equal(again.booking.id, first.booking.id);
  assert.equal(codeOf(() => book(f.alice, '12:00', '13:00', {}, { idempotencyKey: 'key-123456' })), 'IDEMPOTENCY_KEY_REUSED');
  assert.equal(listMyBookings(f.alice).length, 1);
});

test('weekly quota and active-booking cap apply to students only', () => {
  // 3 days x 3 h = 9 h used; a further 90 minutes would exceed 10 h.
  for (const d of [0, 1, 2]) {
    const date = addDays(MONDAY, d);
    createBooking(f.alice, { resourceId: f.room.id, startAt: at(date, '12:00'), endAt: at(date, '15:00') });
  }
  const thu = addDays(MONDAY, 3);
  const over = codeOf(() => createBooking(f.alice, { resourceId: f.room.id, startAt: at(thu, '12:00'), endAt: at(thu, '13:30') }));
  assert.equal(over, 'QUOTA_EXCEEDED');
  // Exactly reaching the limit is allowed.
  createBooking(f.alice, { resourceId: f.room.id, startAt: at(thu, '12:00'), endAt: at(thu, '13:00') });

  // Next week is a fresh quota: the 5th booking is fine, the 6th hits the cap.
  const nextMon = addDays(MONDAY, 7);
  createBooking(f.alice, { resourceId: f.room.id, startAt: at(nextMon, '12:00'), endAt: at(nextMon, '13:00') });
  const nextTue = addDays(MONDAY, 8);
  const cap = codeOf(() => createBooking(f.alice, { resourceId: f.room.id, startAt: at(nextTue, '12:00'), endAt: at(nextTue, '13:00') }));
  assert.equal(cap, 'TOO_MANY_ACTIVE');

  // Admins are exempt.
  for (const d of [0, 1, 2, 3, 4, 5]) {
    const date = addDays(MONDAY, d);
    createBooking(f.admin, { resourceId: f.room2.id, startAt: at(date, '12:00'), endAt: at(date, '16:00') });
  }
});

test('cancellation frees the slot and promotes the waitlist in order', () => {
  const { booking } = book(f.alice, '10:00', '11:00');
  const bobWait = joinWaitlist(f.bob, { resourceId: f.room.id, startAt: at(MONDAY, '10:00'), endAt: at(MONDAY, '11:00') });
  const carolWait = joinWaitlist(f.carol, { resourceId: f.room.id, startAt: at(MONDAY, '10:00'), endAt: at(MONDAY, '11:00') });
  assert.equal(bobWait.position, 1);
  assert.equal(carolWait.position, 2);

  const r = cancelBooking(f.alice, booking.id);
  assert.equal(r.booking.status, 'cancelled');
  assert.equal(r.promoted, 1);

  const bobs = listMyBookings(f.bob);
  assert.equal(bobs.length, 1);
  assert.equal(bobs[0].source, 'waitlist');
  assert.equal(listMyWaitlist(f.carol)[0].position, 1);
  assert.match(listNotifications(f.bob.id).items[0].message, /slot opened up/);
});

test('waitlist promotion skips ineligible users without blocking others', () => {
  const { booking } = book(f.alice, '10:00', '11:00');
  joinWaitlist(f.bob, { resourceId: f.room.id, startAt: at(MONDAY, '10:00'), endAt: at(MONDAY, '11:00') });
  joinWaitlist(f.carol, { resourceId: f.room.id, startAt: at(MONDAY, '10:00'), endAt: at(MONDAY, '11:00') });
  // Bob books something else at the same time, so he can no longer take it.
  createBooking(f.bob, { resourceId: f.room2.id, startAt: at(MONDAY, '10:00'), endAt: at(MONDAY, '11:00') });
  cancelBooking(f.alice, booking.id);
  assert.equal(listMyBookings(f.carol).length, 1);
  assert.equal(listMyWaitlist(f.bob)[0].status, 'waiting');
});

test('waitlist rules: only for taken slots and no duplicates', () => {
  const input = { resourceId: f.room.id, startAt: at(MONDAY, '10:00'), endAt: at(MONDAY, '11:00') };
  assert.equal(codeOf(() => joinWaitlist(f.bob, input)), 'SLOT_AVAILABLE');
  book(f.alice, '10:00', '11:00');
  joinWaitlist(f.bob, input);
  assert.equal(codeOf(() => joinWaitlist(f.bob, input)), 'ALREADY_WAITLISTED');
});

test('only the owner or an admin can cancel, and not after the start', () => {
  const { booking } = book(f.alice, '10:00', '11:00');
  assert.equal(codeOf(() => cancelBooking(f.bob, booking.id)), 'NOT_FOUND');
  clock.set(at(MONDAY, '10:05'));
  assert.equal(codeOf(() => cancelBooking(f.alice, booking.id)), 'ALREADY_STARTED');
  const r = cancelBooking(f.admin, booking.id, { reason: 'Exam' });
  assert.equal(r.booking.status, 'cancelled');
  assert.match(listNotifications(f.alice.id).items[0].message, /administrator cancelled/);
  assert.equal(codeOf(() => cancelBooking(f.admin, booking.id)), 'ALREADY_CANCELLED');
});

test('check-in is only possible inside its window', () => {
  const { booking } = book(f.alice, '10:00', '11:00');
  clock.set(at(MONDAY, '09:45'));
  assert.equal(codeOf(() => checkIn(f.alice, booking.id)), 'CHECKIN_TOO_EARLY');
  clock.set(at(MONDAY, '09:52'));
  assert.equal(codeOf(() => checkIn(f.bob, booking.id)), 'NOT_FOUND');
  assert.equal(checkIn(f.alice, booking.id).booking.status, 'checked_in');
  assert.equal(codeOf(() => checkIn(f.alice, booking.id)), 'ALREADY_CHECKED_IN');

  const late = book(f.alice, '12:00', '13:00').booking;
  clock.set(at(MONDAY, '12:16'));
  assert.equal(codeOf(() => checkIn(f.alice, late.id)), 'CHECKIN_CLOSED');
});

test('blackouts block booking and cancel colliding bookings with notice', () => {
  const { booking } = book(f.alice, '14:00', '15:00');
  const r = createBlackout(f.admin, { resourceId: f.room.id, startAt: at(MONDAY, '13:00'), endAt: at(MONDAY, '16:00'), reason: 'Painting' });
  assert.equal(r.cancelledBookings, 1);
  assert.equal(listMyBookings(f.alice).length, 0);
  assert.match(listNotifications(f.alice.id).items[0].message, /Painting/);
  assert.equal(codeOf(() => book(f.bob, '15:00', '15:30')), 'BLACKED_OUT');
  assert.equal(book(f.bob, '16:00', '16:30').booking.status, 'confirmed');
  assert.equal(booking.status, 'confirmed');
});

test('availability grid reflects bookings, ownership, blackouts and the past', () => {
  book(f.alice, '10:00', '11:00');
  createBlackout(f.admin, { resourceId: null, startAt: at(MONDAY, '18:00'), endAt: at(MONDAY, '19:00'), reason: 'Event' });
  const grid = getAvailability(f.room.id, MONDAY, f.alice);
  const byLabel = Object.fromEntries(grid.slots.map((s) => [s.label, s.status]));
  assert.equal(grid.slots.length, 28);
  assert.equal(byLabel['08:00'], 'past');
  assert.equal(byLabel['10:00'], 'mine');
  assert.equal(byLabel['10:30'], 'mine');
  assert.equal(byLabel['11:00'], 'free');
  assert.equal(byLabel['18:30'], 'blackout');
  const bobView = getAvailability(f.room.id, MONDAY, f.bob);
  assert.equal(bobView.slots.find((s) => s.label === '10:00').status, 'booked');
});

test('deactivating a resource cancels its future bookings and blocks new ones', () => {
  book(f.alice, '10:00', '11:00');
  const r = setResourceActive(f.room.id, false);
  assert.equal(r.cancelledBookings, 1);
  assert.equal(codeOf(() => book(f.bob, '12:00', '13:00')), 'RESOURCE_INACTIVE');
  assert.equal(codeOf(() => getAvailability(f.room.id, MONDAY, f.bob)), 'NOT_FOUND');
});

test('transactions roll back completely on failure', () => {
  const before = f.db.prepare('SELECT COUNT(*) AS n FROM bookings').get().n;
  assert.throws(() => book(f.alice, '10:00', '11:00', { attendees: 99 }));
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM bookings').get().n, before);
  assert.equal(NOW, clock.now());
  assert.ok(MIN);
});
