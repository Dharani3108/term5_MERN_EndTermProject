// Waitlist: students can queue for a slot that is taken. Whenever time frees
// up (cancellation, no-show release, admin action) the queue is processed in
// first-come order and the first eligible entries are booked automatically.
import { db, tx } from '../db/index.js';
import { config } from '../config.js';
import { clock } from '../lib/clock.js';
import { AppError, notFound, conflict, unprocessable } from '../lib/errors.js';
import * as t from '../lib/time.js';
import { notify } from './notificationService.js';
import { getResourceRow, getUserRow } from './repo.js';
import { assertBookable, findConflict, createBooking } from './bookingService.js';

const P = config.policy;

function position(entry) {
  return (
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM waitlist WHERE resource_id = ? AND status = 'waiting'
         AND start_at < ? AND end_at > ? AND (created_at < ? OR (created_at = ? AND id < ?))`,
      )
      .get(entry.resource_id, entry.end_at, entry.start_at, entry.created_at, entry.created_at, entry.id).n + 1
  );
}

function toDTO(w) {
  return {
    id: w.id,
    resourceId: w.resource_id,
    resourceName: w.resource_name,
    startAt: t.toIso(w.start_at),
    endAt: t.toIso(w.end_at),
    attendees: w.attendees,
    purpose: w.purpose,
    status: w.status,
    bookingId: w.booking_id,
    createdAt: t.toIso(w.created_at),
    position: w.status === 'waiting' ? position(w) : null,
  };
}

const SELECT = `SELECT w.*, r.name AS resource_name FROM waitlist w JOIN resources r ON r.id = w.resource_id`;

export function joinWaitlist(user, input, { now = clock.now() } = {}) {
  const { resourceId, startAt, endAt } = input;
  const attendees = input.attendees ?? 1;
  const purpose = input.purpose ?? '';
  return tx(() => {
    const resource = getResourceRow(resourceId);
    if (!resource) throw notFound('Resource');
    // Same rules as a real booking, except that the slot may be taken.
    assertBookable(user, resource, { startAt, endAt, attendees }, now, { allowConflict: true });
    if (!findConflict(resourceId, startAt, endAt)) {
      throw conflict('SLOT_AVAILABLE', 'That time is free, so you can book it directly.');
    }
    const dup = db
      .prepare(
        `SELECT id FROM waitlist WHERE user_id = ? AND resource_id = ? AND start_at = ? AND end_at = ?
         AND status = 'waiting'`,
      )
      .get(user.id, resourceId, startAt, endAt);
    if (dup) throw conflict('ALREADY_WAITLISTED', 'You are already on the waitlist for this slot.');
    const open = db
      .prepare(`SELECT COUNT(*) AS n FROM waitlist WHERE user_id = ? AND status = 'waiting' AND start_at > ?`)
      .get(user.id, now).n;
    if (open >= P.maxWaitlistEntries) {
      throw unprocessable('WAITLIST_LIMIT', `You can be on at most ${P.maxWaitlistEntries} waitlists at once.`);
    }
    const info = db
      .prepare(
        `INSERT INTO waitlist (resource_id, user_id, start_at, end_at, attendees, purpose, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'waiting', ?, ?)`,
      )
      .run(resourceId, user.id, startAt, endAt, attendees, purpose, now, now);
    return toDTO(db.prepare(`${SELECT} WHERE w.id = ?`).get(Number(info.lastInsertRowid)));
  });
}

export function listMyWaitlist(user, now = clock.now()) {
  return db
    .prepare(
      `${SELECT} WHERE w.user_id = ? AND (w.status = 'waiting' OR w.updated_at > ?)
       ORDER BY CASE w.status WHEN 'waiting' THEN 0 ELSE 1 END, w.start_at`,
    )
    .all(user.id, now - 7 * t.DAY)
    .map(toDTO);
}

export function leaveWaitlist(user, id, { now = clock.now() } = {}) {
  const w = db.prepare('SELECT * FROM waitlist WHERE id = ?').get(id);
  if (!w || w.user_id !== user.id) throw notFound('Waitlist entry');
  if (w.status !== 'waiting') throw conflict('NOT_WAITING', 'This waitlist entry is no longer active.');
  db.prepare(`UPDATE waitlist SET status = 'cancelled', updated_at = ? WHERE id = ?`).run(now, id);
  return { ok: true };
}

/**
 * Tries to convert waitlist entries overlapping [from, to) into bookings.
 * Each attempt runs in its own savepoint, so one ineligible entry (e.g. the
 * user hit their quota meanwhile) never blocks the people behind them.
 */
export function promoteWaitlist(resourceId, from, to, now = clock.now()) {
  if (!(to > from)) return 0;
  const entries = db
    .prepare(
      `SELECT * FROM waitlist WHERE resource_id = ? AND status = 'waiting'
       AND start_at < ? AND end_at > ? AND start_at >= ? ORDER BY created_at, id`,
    )
    .all(resourceId, to, from, now);

  let promoted = 0;
  for (const entry of entries) {
    const user = getUserRow(entry.user_id);
    if (!user) continue;
    try {
      tx(() => {
        const { booking } = createBooking(
          user,
          {
            resourceId,
            startAt: entry.start_at,
            endAt: entry.end_at,
            attendees: entry.attendees,
            purpose: entry.purpose,
          },
          { source: 'waitlist', now },
        );
        db.prepare(`UPDATE waitlist SET status = 'promoted', booking_id = ?, updated_at = ? WHERE id = ?`).run(
          booking.id,
          now,
          entry.id,
        );
        notify(
          user.id,
          'waitlist_promoted',
          `Good news! A slot opened up and you are now booked into ${booking.resourceName} on ` +
            `${t.formatLocal(entry.start_at)}. Remember to check in.`,
          '#/bookings',
        );
      });
      promoted += 1;
    } catch (err) {
      if (!(err instanceof AppError)) throw err;
      // Still taken or user currently ineligible: keep them in the queue.
    }
  }
  return promoted;
}
