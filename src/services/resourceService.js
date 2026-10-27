// Resource discovery (search, filters, live availability) and admin management.
import { db, tx } from '../db/index.js';
import { config } from '../config.js';
import { clock } from '../lib/clock.js';
import { notFound, conflict, badRequest } from '../lib/errors.js';
import * as t from '../lib/time.js';
import { notify } from './notificationService.js';
import { getResourceRow, toResourceDTO, likePattern } from './repo.js';
import { findBlackout, findConflict, publishAvailability, ACTIVE_STATUSES } from './bookingService.js';

const P = config.policy;
const { MINUTE, DAY } = t;
export const RESOURCE_TYPES = ['study_room', 'meeting_room', 'lab', 'equipment', 'sports'];

/** True when the resource is open, not blacked out and unbooked for [start, end). */
function isRangeFree(r, start, end) {
  if (t.localDate(start) !== t.localDate(end - 1)) return false;
  const startMinute = t.minuteOfDay(start);
  const duration = (end - start) / MINUTE;
  if (startMinute < r.open_minute || startMinute + duration > r.close_minute) return false;
  return !findBlackout(r.id, start, end) && !findConflict(r.id, start, end);
}

function currentSlotStart(now) {
  const minute = t.minuteOfDay(now);
  return now - (now % MINUTE) - (minute % P.slotMinutes) * MINUTE;
}

export function searchResources(filters, { includeInactive = false, now = clock.now() } = {}) {
  const where = [];
  const params = [];
  if (!includeInactive) where.push('active = 1');
  if (filters.q) {
    where.push("(name LIKE ? ESCAPE '\\' OR building LIKE ? ESCAPE '\\' OR description LIKE ? ESCAPE '\\')");
    const like = likePattern(filters.q);
    params.push(like, like, like);
  }
  if (filters.type) {
    where.push('type = ?');
    params.push(filters.type);
  }
  if (filters.building) {
    where.push('building = ?');
    params.push(filters.building);
  }
  if (filters.minCapacity) {
    where.push('capacity >= ?');
    params.push(filters.minCapacity);
  }
  const sql = `SELECT * FROM resources ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY name`;
  let rows = db.prepare(sql).all(...params);

  if (filters.availableAt) {
    const end = filters.availableAt + (filters.duration || P.slotMinutes) * MINUTE;
    rows = rows.filter((r) => isRangeFree(r, filters.availableAt, end));
  }

  const slotStart = currentSlotStart(now);
  const items = rows.map((r) => ({
    ...toResourceDTO(r),
    freeNow: Boolean(r.active) && isRangeFree(r, slotStart, slotStart + P.slotMinutes * MINUTE),
  }));
  const buildings = db
    .prepare(`SELECT DISTINCT building FROM resources ${includeInactive ? '' : 'WHERE active = 1'} ORDER BY building`)
    .all()
    .map((b) => b.building);
  return { items, buildings, types: RESOURCE_TYPES };
}

export function getResource(id, user) {
  const r = getResourceRow(id);
  if (!r || (!r.active && user.role !== 'admin')) throw notFound('Resource');
  return toResourceDTO(r);
}

/** The slot grid for one resource on one campus-local date. */
export function getAvailability(resourceId, date, user, now = clock.now()) {
  const r = getResourceRow(resourceId);
  if (!r || (!r.active && user.role !== 'admin')) throw notFound('Resource');
  if (!t.isValidDateStr(date)) throw badRequest('INVALID_DATE', 'Date must be in YYYY-MM-DD format.');

  const dayStart = t.zonedToUtc(date, r.open_minute);
  const dayEnd = t.zonedToUtc(date, r.close_minute);
  const bookings = db
    .prepare(
      `SELECT id, user_id, start_at, end_at FROM bookings WHERE resource_id = ?
       AND status IN ${ACTIVE_STATUSES} AND start_at < ? AND end_at > ?`,
    )
    .all(r.id, dayEnd, dayStart);
  const blackouts = db
    .prepare(
      `SELECT start_at, end_at, reason FROM blackouts WHERE (resource_id IS NULL OR resource_id = ?)
       AND start_at < ? AND end_at > ?`,
    )
    .all(r.id, dayEnd, dayStart);
  const waiting = db
    .prepare(
      `SELECT start_at, end_at FROM waitlist WHERE resource_id = ? AND user_id = ? AND status = 'waiting'
       AND start_at < ? AND end_at > ?`,
    )
    .all(r.id, user.id, dayEnd, dayStart);

  const horizon = now + P.bookingWindowDays * DAY;
  const overlaps = (a, s, e) => a.start_at < e && a.end_at > s;
  const slots = [];
  for (let m = r.open_minute; m + P.slotMinutes <= r.close_minute; m += P.slotMinutes) {
    const start = t.zonedToUtc(date, m);
    const end = start + P.slotMinutes * MINUTE;
    const blackout = blackouts.find((b) => overlaps(b, start, end));
    const booking = bookings.find((b) => overlaps(b, start, end));
    let status;
    if (blackout) status = 'blackout';
    else if (booking && booking.user_id === user.id) status = 'mine';
    else if (booking) status = 'booked';
    else if (start < now) status = 'past';
    else if (start > horizon) status = 'closed';
    else status = 'free';
    slots.push({
      startAt: t.toIso(start),
      endAt: t.toIso(end),
      label: t.hhmm(m),
      status,
      reason: blackout?.reason || null,
      waitlisted: waiting.some((w) => overlaps(w, start, end)),
    });
  }

  const today = t.localDate(now);
  return {
    resource: toResourceDTO(r),
    date,
    timezone: config.timezone,
    slotMinutes: P.slotMinutes,
    minDate: today,
    maxDate: t.localDate(horizon),
    slots,
  };
}

// ---------- admin management ----------

function resourceValues(input) {
  const open = t.parseHHMM(input.openTime);
  const close = t.parseHHMM(input.closeTime);
  const errors = {};
  if (open === null || open === 1440) errors.openTime = 'must be a time like 08:00';
  if (close === null) errors.closeTime = 'must be a time like 22:00';
  if (open !== null && close !== null && close <= open) errors.closeTime = 'must be after the opening time';
  if (open !== null && open % P.slotMinutes) errors.openTime = `must be on a ${P.slotMinutes}-minute boundary`;
  if (close !== null && close % P.slotMinutes) errors.closeTime = `must be on a ${P.slotMinutes}-minute boundary`;
  if (input.maxMinutes % P.slotMinutes) errors.maxMinutes = `must be a multiple of ${P.slotMinutes}`;
  if (Object.keys(errors).length) throw badRequest('VALIDATION_ERROR', 'Some fields are invalid.', errors);
  return { open, close };
}

export function createResource(input, now = clock.now()) {
  const { open, close } = resourceValues(input);
  if (db.prepare('SELECT id FROM resources WHERE name = ?').get(input.name)) {
    throw conflict('NAME_TAKEN', 'A resource with this name already exists.');
  }
  const info = db
    .prepare(
      `INSERT INTO resources (name, type, building, capacity, description, amenities, open_minute, close_minute,
                              max_minutes, active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
    )
    .run(
      input.name,
      input.type,
      input.building,
      input.capacity,
      input.description || '',
      JSON.stringify(input.amenities || []),
      open,
      close,
      input.maxMinutes,
      now,
      now,
    );
  return toResourceDTO(getResourceRow(Number(info.lastInsertRowid)));
}

export function updateResource(id, input, now = clock.now()) {
  const r = getResourceRow(id);
  if (!r) throw notFound('Resource');
  const { open, close } = resourceValues(input);
  const clash = db.prepare('SELECT id FROM resources WHERE name = ? AND id <> ?').get(input.name, id);
  if (clash) throw conflict('NAME_TAKEN', 'A resource with this name already exists.');
  db.prepare(
    `UPDATE resources SET name = ?, type = ?, building = ?, capacity = ?, description = ?, amenities = ?,
       open_minute = ?, close_minute = ?, max_minutes = ?, updated_at = ? WHERE id = ?`,
  ).run(
    input.name,
    input.type,
    input.building,
    input.capacity,
    input.description || '',
    JSON.stringify(input.amenities || []),
    open,
    close,
    input.maxMinutes,
    now,
    id,
  );
  return toResourceDTO(getResourceRow(id));
}

/** Deactivating cancels future bookings and waitlists, and tells the people affected. */
export function setResourceActive(id, active, now = clock.now()) {
  return tx(() => {
    const r = getResourceRow(id);
    if (!r) throw notFound('Resource');
    db.prepare('UPDATE resources SET active = ?, updated_at = ? WHERE id = ?').run(active ? 1 : 0, now, id);
    let cancelled = 0;
    if (!active) {
      const affected = db
        .prepare(`SELECT * FROM bookings WHERE resource_id = ? AND status = 'confirmed' AND start_at > ?`)
        .all(id, now);
      for (const b of affected) {
        db.prepare(
          `UPDATE bookings SET status = 'cancelled', cancelled_at = ?, cancel_reason = ?, updated_at = ? WHERE id = ?`,
        ).run(now, 'Resource withdrawn from service', now, b.id);
        notify(
          b.user_id,
          'booking_cancelled',
          `${r.name} has been withdrawn from service, so your booking on ${t.formatLocal(b.start_at)} was cancelled.`,
          '#/bookings',
        );
        publishAvailability(id, b.start_at);
        cancelled += 1;
      }
      db.prepare(`UPDATE waitlist SET status = 'cancelled', updated_at = ? WHERE resource_id = ? AND status = 'waiting'`).run(
        now,
        id,
      );
    }
    return { resource: toResourceDTO(getResourceRow(id)), cancelledBookings: cancelled };
  });
}
