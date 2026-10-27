// The booking engine. Every booking passes the same rule pipeline:
//   resource active -> slot shape (alignment, hours, duration, window)
//   -> capacity -> blackouts -> user rules (overlap, suspension, active
//   limit, weekly quota) -> resource conflict
// and is written inside a single IMMEDIATE transaction, so two people can
// never end up holding the same slot.
import { db, tx, afterCommit } from '../db/index.js';
import { config } from '../config.js';
import { clock } from '../lib/clock.js';
import { AppError, notFound, conflict, unprocessable } from '../lib/errors.js';
import * as t from '../lib/time.js';
import { broadcast } from '../lib/events.js';
import { notify } from './notificationService.js';
import { getResourceRow, getBookingRow, toBookingDTO, BOOKING_SELECT } from './repo.js';
import { promoteWaitlist } from './waitlistService.js';

const P = config.policy;
const { MINUTE, DAY } = t;
export const ACTIVE_STATUSES = "('confirmed', 'checked_in')";

export function publishAvailability(resourceId, startMs) {
  const date = t.localDate(startMs);
  afterCommit(() => broadcast('availability', { resourceId, date }));
}

// ---------- rule checks ----------

export function findBlackout(resourceId, start, end) {
  return db
    .prepare(
      `SELECT * FROM blackouts WHERE (resource_id IS NULL OR resource_id = ?)
       AND start_at < ? AND end_at > ? ORDER BY start_at LIMIT 1`,
    )
    .get(resourceId, end, start);
}

export function findConflict(resourceId, start, end, excludeBookingId = 0) {
  return db
    .prepare(
      `SELECT id, user_id FROM bookings WHERE resource_id = ? AND status IN ${ACTIVE_STATUSES}
       AND start_at < ? AND end_at > ? AND id <> ? LIMIT 1`,
    )
    .get(resourceId, end, start, excludeBookingId);
}

/** Rolling no-show strikes and, if over the limit, when booking reopens. */
export function strikeInfo(userId, now = clock.now()) {
  const since = now - P.strikeWindowDays * DAY;
  const rows = db
    .prepare(
      `SELECT start_at FROM bookings WHERE user_id = ? AND status = 'no_show'
       AND start_at >= ? AND start_at <= ? ORDER BY start_at`,
    )
    .all(userId, since, now);
  let suspendedUntil = null;
  if (rows.length >= P.strikeLimit) {
    // Suspension lifts once enough old strikes age out of the window.
    suspendedUntil = rows[rows.length - P.strikeLimit].start_at + P.strikeWindowDays * DAY;
  }
  return { count: rows.length, limit: P.strikeLimit, windowDays: P.strikeWindowDays, suspendedUntil };
}

export function weeklyUsageMinutes(userId, refMs) {
  const [ws, we] = t.weekBounds(refMs);
  return db
    .prepare(
      `SELECT COALESCE(SUM(end_at - start_at), 0) / 60000 AS m FROM bookings
       WHERE user_id = ? AND status IN ('confirmed', 'checked_in', 'completed')
       AND start_at >= ? AND start_at < ?`,
    )
    .get(userId, ws, we).m;
}

function activeBookingCount(userId, now) {
  return db
    .prepare(`SELECT COUNT(*) AS n FROM bookings WHERE user_id = ? AND status IN ${ACTIVE_STATUSES} AND end_at > ?`)
    .get(userId, now).n;
}

function validateSlotShape(resource, start, end, now) {
  if (!(end > start)) throw unprocessable('INVALID_RANGE', 'The end time must be after the start time.');
  const duration = (end - start) / MINUTE;
  const startMinute = t.minuteOfDay(start);
  if (start % MINUTE !== 0 || startMinute % P.slotMinutes !== 0 || duration % P.slotMinutes !== 0) {
    throw unprocessable('MISALIGNED_SLOT', `Bookings must start and end on ${P.slotMinutes}-minute boundaries.`);
  }
  if (duration > resource.max_minutes) {
    throw unprocessable(
      'TOO_LONG',
      `${resource.name} can be booked for at most ${resource.max_minutes} minutes at a time.`,
    );
  }
  if (startMinute < resource.open_minute || startMinute + duration > resource.close_minute) {
    throw unprocessable(
      'OUTSIDE_HOURS',
      `${resource.name} is open ${t.hhmm(resource.open_minute)} to ${t.hhmm(resource.close_minute)}.`,
    );
  }
  if (start < now) throw unprocessable('IN_PAST', 'That time has already started. Please pick a future slot.');
  if (start > now + P.bookingWindowDays * DAY) {
    throw unprocessable('OUTSIDE_WINDOW', `Bookings open ${P.bookingWindowDays} days in advance.`);
  }
}

function checkUserRules(user, start, end, now) {
  const own = db
    .prepare(
      `SELECT r.name FROM bookings b JOIN resources r ON r.id = b.resource_id
       WHERE b.user_id = ? AND b.status IN ${ACTIVE_STATUSES} AND b.start_at < ? AND b.end_at > ? LIMIT 1`,
    )
    .get(user.id, end, start);
  if (own) throw conflict('SELF_CONFLICT', `You already have ${own.name} booked during that time.`);

  if (user.role === 'admin') return; // staff are exempt from fairness limits

  const strikes = strikeInfo(user.id, now);
  if (strikes.suspendedUntil && strikes.suspendedUntil > now) {
    throw new AppError(
      403,
      'BOOKING_SUSPENDED',
      `Booking is paused after ${strikes.count} no-shows in ${P.strikeWindowDays} days. ` +
        `You can book again from ${t.formatLocal(strikes.suspendedUntil)}.`,
      { suspendedUntil: t.toIso(strikes.suspendedUntil) },
    );
  }

  if (activeBookingCount(user.id, now) >= P.maxActiveBookings) {
    throw unprocessable(
      'TOO_MANY_ACTIVE',
      `You can hold at most ${P.maxActiveBookings} upcoming bookings. Cancel one to book another.`,
    );
  }

  const used = weeklyUsageMinutes(user.id, start);
  const duration = (end - start) / MINUTE;
  if (used + duration > P.weeklyQuotaMinutes) {
    const left = Math.max(0, P.weeklyQuotaMinutes - used);
    throw unprocessable(
      'QUOTA_EXCEEDED',
      `This would exceed your weekly limit of ${P.weeklyQuotaMinutes / 60} hours. ` +
        `You have ${left / 60} hours left that week.`,
      { usedMinutes: used, quotaMinutes: P.weeklyQuotaMinutes },
    );
  }
}

/** Throws the first rule a proposed booking breaks. */
export function assertBookable(user, resource, { startAt, endAt, attendees }, now, { allowConflict = false } = {}) {
  if (!resource.active) throw unprocessable('RESOURCE_INACTIVE', `${resource.name} is not accepting bookings.`);
  validateSlotShape(resource, startAt, endAt, now);
  if (attendees < 1 || attendees > resource.capacity) {
    throw unprocessable('OVER_CAPACITY', `${resource.name} holds up to ${resource.capacity} people.`);
  }
  const blackout = findBlackout(resource.id, startAt, endAt);
  if (blackout) {
    throw conflict(
      'BLACKED_OUT',
      `${resource.name} is unavailable then${blackout.reason ? ` (${blackout.reason})` : ''}.`,
    );
  }
  checkUserRules(user, startAt, endAt, now);
  if (!allowConflict && findConflict(resource.id, startAt, endAt)) {
    throw conflict(
      'SLOT_TAKEN',
      'Someone has already booked part of that time. You can join the waitlist to get it if it frees up.',
    );
  }
}

// ---------- workflows ----------

export function createBooking(user, input, { idempotencyKey = null, source = 'direct', now = clock.now() } = {}) {
  const { resourceId, startAt, endAt } = input;
  const attendees = input.attendees ?? 1;
  const purpose = input.purpose ?? '';

  return tx(() => {
    // Replaying the same request (double click, retry after a timeout)
    // returns the original booking instead of failing or duplicating.
    if (idempotencyKey) {
      const prev = db
        .prepare('SELECT id, resource_id, start_at, end_at FROM bookings WHERE user_id = ? AND idempotency_key = ?')
        .get(user.id, idempotencyKey);
      if (prev) {
        if (prev.resource_id === resourceId && prev.start_at === startAt && prev.end_at === endAt) {
          return { booking: toBookingDTO(getBookingRow(prev.id)), replayed: true };
        }
        throw conflict('IDEMPOTENCY_KEY_REUSED', 'This request key was already used for a different booking.');
      }
    }

    const resource = getResourceRow(resourceId);
    if (!resource) throw notFound('Resource');
    assertBookable(user, resource, { startAt, endAt, attendees }, now);

    const info = db
      .prepare(
        `INSERT INTO bookings (resource_id, user_id, start_at, end_at, attendees, purpose, status, source,
                               idempotency_key, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'confirmed', ?, ?, ?, ?)`,
      )
      .run(resourceId, user.id, startAt, endAt, attendees, purpose, source, idempotencyKey, now, now);
    publishAvailability(resourceId, startAt);
    return { booking: toBookingDTO(getBookingRow(Number(info.lastInsertRowid))), replayed: false };
  });
}

export function cancelBooking(user, bookingId, { reason = null, now = clock.now() } = {}) {
  return tx(() => {
    const b = getBookingRow(bookingId);
    const isAdmin = user.role === 'admin';
    const isOwner = b && b.user_id === user.id;
    // Non-owners get a 404, so booking ids of other users are not revealed.
    if (!b || (!isOwner && !isAdmin)) throw notFound('Booking');
    if (b.status === 'cancelled') throw conflict('ALREADY_CANCELLED', 'This booking is already cancelled.');
    if (!['confirmed', 'checked_in'].includes(b.status)) {
      throw conflict('NOT_CANCELLABLE', `A ${b.status.replace('_', '-')} booking cannot be cancelled.`);
    }
    if (b.end_at <= now) throw conflict('ALREADY_ENDED', 'This booking has already ended.');
    if (!isAdmin && b.start_at <= now) {
      throw conflict('ALREADY_STARTED', 'This booking has already started and can no longer be cancelled.');
    }

    db.prepare(
      `UPDATE bookings SET status = 'cancelled', cancelled_at = ?, cancel_reason = ?, updated_at = ? WHERE id = ?`,
    ).run(now, reason, now, b.id);

    if (!isOwner) {
      notify(
        b.user_id,
        'booking_cancelled',
        `An administrator cancelled your booking for ${b.resource_name} on ${t.formatLocal(b.start_at)}` +
          `${reason ? `. Reason: ${reason}` : ''}.`,
        '#/bookings',
      );
    }
    publishAvailability(b.resource_id, b.start_at);
    const promoted = promoteWaitlist(b.resource_id, Math.max(b.start_at, now), b.end_at, now);
    return { booking: toBookingDTO(getBookingRow(b.id)), promoted };
  });
}

export function checkIn(user, bookingId, { now = clock.now() } = {}) {
  return tx(() => {
    const b = getBookingRow(bookingId);
    if (!b || b.user_id !== user.id) throw notFound('Booking');
    if (b.status === 'checked_in') throw conflict('ALREADY_CHECKED_IN', 'You have already checked in.');
    if (b.status !== 'confirmed') {
      throw conflict('NOT_CHECKIN_ELIGIBLE', `A ${b.status.replace('_', '-')} booking cannot be checked in.`);
    }
    const opens = b.start_at - P.checkInEarlyMinutes * MINUTE;
    const closes = b.start_at + P.noShowGraceMinutes * MINUTE;
    if (now < opens) {
      throw unprocessable(
        'CHECKIN_TOO_EARLY',
        `Check-in opens ${P.checkInEarlyMinutes} minutes before your booking, at ${t.formatTime(opens)}.`,
      );
    }
    if (now > closes) throw conflict('CHECKIN_CLOSED', 'The check-in window has closed for this booking.');
    db.prepare(`UPDATE bookings SET status = 'checked_in', checked_in_at = ?, updated_at = ? WHERE id = ?`).run(
      now,
      now,
      b.id,
    );
    return { booking: toBookingDTO(getBookingRow(b.id)) };
  });
}

/** Adds the actions the current user may take, so the UI does not guess. */
function withActions(dto, row, now) {
  const opens = row.start_at - P.checkInEarlyMinutes * MINUTE;
  const closes = row.start_at + P.noShowGraceMinutes * MINUTE;
  return {
    ...dto,
    canCancel: row.status === 'confirmed' && row.start_at > now,
    canCheckIn: row.status === 'confirmed' && now >= opens && now <= closes,
    checkInOpensAt: t.toIso(opens),
    checkInClosesAt: t.toIso(closes),
  };
}

export function listMyBookings(user, scope = 'upcoming', now = clock.now()) {
  const rows =
    scope === 'past'
      ? db
          .prepare(
            `${BOOKING_SELECT} WHERE b.user_id = ? AND (b.end_at <= ? OR b.status IN ('cancelled', 'no_show', 'completed'))
             ORDER BY b.start_at DESC LIMIT 100`,
          )
          .all(user.id, now)
      : db
          .prepare(
            `${BOOKING_SELECT} WHERE b.user_id = ? AND b.end_at > ? AND b.status IN ${ACTIVE_STATUSES}
             ORDER BY b.start_at ASC`,
          )
          .all(user.id, now);
  return rows.map((r) => withActions(toBookingDTO(r), r, now));
}

export function getAccountSummary(user, now = clock.now()) {
  const strikes = strikeInfo(user.id, now);
  return {
    weeklyUsedMinutes: weeklyUsageMinutes(user.id, now),
    weeklyQuotaMinutes: user.role === 'admin' ? null : P.weeklyQuotaMinutes,
    activeBookings: activeBookingCount(user.id, now),
    maxActiveBookings: user.role === 'admin' ? null : P.maxActiveBookings,
    strikes: { ...strikes, suspendedUntil: strikes.suspendedUntil > now ? t.toIso(strikes.suspendedUntil) : null },
  };
}
