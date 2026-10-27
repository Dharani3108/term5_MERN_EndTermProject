// Administrator workflows: blackout periods, booking oversight, user roles
// and utilisation analytics.
import { db, tx } from '../db/index.js';
import { config } from '../config.js';
import { clock } from '../lib/clock.js';
import { notFound, conflict, badRequest } from '../lib/errors.js';
import * as t from '../lib/time.js';
import { notify } from './notificationService.js';
import { destroyUserSessions } from './authService.js';
import { getResourceRow, getUserRow, toUserDTO, toBookingDTO, BOOKING_SELECT, likePattern } from './repo.js';
import { publishAvailability, strikeInfo } from './bookingService.js';

const { MINUTE, DAY } = t;

// ---------- blackouts ----------

const toBlackoutDTO = (b) => ({
  id: b.id,
  resourceId: b.resource_id,
  resourceName: b.resource_name || 'All resources',
  startAt: t.toIso(b.start_at),
  endAt: t.toIso(b.end_at),
  reason: b.reason,
  createdAt: t.toIso(b.created_at),
});

const BLACKOUT_SELECT = `SELECT bo.*, r.name AS resource_name FROM blackouts bo LEFT JOIN resources r ON r.id = bo.resource_id`;

export function listBlackouts(now = clock.now()) {
  return db
    .prepare(`${BLACKOUT_SELECT} WHERE bo.end_at > ? ORDER BY bo.start_at`)
    .all(now - 7 * DAY)
    .map(toBlackoutDTO);
}

/**
 * Blocks a resource (or every resource) for maintenance or events. Existing
 * bookings that collide are cancelled and their owners notified in the same
 * transaction, so the schedule never shows a booking inside a blackout.
 */
export function createBlackout(admin, { resourceId, startAt, endAt, reason }, now = clock.now()) {
  if (!(endAt > startAt)) throw badRequest('VALIDATION_ERROR', 'Some fields are invalid.', { end: 'must be after the start' });
  if (endAt <= now) throw badRequest('VALIDATION_ERROR', 'Some fields are invalid.', { end: 'must be in the future' });
  return tx(() => {
    let resource = null;
    if (resourceId) {
      resource = getResourceRow(resourceId);
      if (!resource) throw notFound('Resource');
    }
    const info = db
      .prepare('INSERT INTO blackouts (resource_id, start_at, end_at, reason, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(resourceId || null, startAt, endAt, reason || '', admin.id, now);

    const affected = db
      .prepare(
        `${BOOKING_SELECT} WHERE b.status = 'confirmed' AND b.start_at < ? AND b.end_at > ? AND b.end_at > ?
         ${resourceId ? 'AND b.resource_id = ?' : ''}`,
      )
      .all(...[endAt, startAt, now, ...(resourceId ? [resourceId] : [])]);
    for (const b of affected) {
      db.prepare(
        `UPDATE bookings SET status = 'cancelled', cancelled_at = ?, cancel_reason = ?, updated_at = ? WHERE id = ?`,
      ).run(now, `Blackout: ${reason || 'unavailable'}`, now, b.id);
      notify(
        b.user_id,
        'booking_cancelled',
        `Your booking for ${b.resource_name} on ${t.formatLocal(b.start_at)} was cancelled because the space is ` +
          `unavailable${reason ? ` (${reason})` : ''}. Sorry for the inconvenience.`,
        '#/bookings',
      );
      publishAvailability(b.resource_id, b.start_at);
    }
    const waitlistInfo = db
      .prepare(
        `UPDATE waitlist SET status = 'cancelled', updated_at = ? WHERE status = 'waiting'
         AND start_at < ? AND end_at > ? ${resourceId ? 'AND resource_id = ?' : ''}`,
      )
      .run(...[now, endAt, startAt, ...(resourceId ? [resourceId] : [])]);

    const row = db.prepare(`${BLACKOUT_SELECT} WHERE bo.id = ?`).get(Number(info.lastInsertRowid));
    return {
      blackout: toBlackoutDTO(row),
      cancelledBookings: affected.length,
      cancelledWaitlist: Number(waitlistInfo.changes),
      resourceName: resource?.name ?? 'All resources',
    };
  });
}

export function deleteBlackout(id) {
  const row = db.prepare('SELECT * FROM blackouts WHERE id = ?').get(id);
  if (!row) throw notFound('Blackout');
  db.prepare('DELETE FROM blackouts WHERE id = ?').run(id);
  publishAvailability(row.resource_id ?? 0, row.start_at);
  return { ok: true };
}

// ---------- bookings oversight ----------

export function listAllBookings({ status, resourceId, q, from, to, page = 1, pageSize = 20 }) {
  const where = [];
  const params = [];
  if (status) {
    where.push('b.status = ?');
    params.push(status);
  }
  if (resourceId) {
    where.push('b.resource_id = ?');
    params.push(resourceId);
  }
  if (q) {
    where.push("(u.name LIKE ? ESCAPE '\\' OR u.email LIKE ? ESCAPE '\\' OR b.purpose LIKE ? ESCAPE '\\')");
    const like = likePattern(q);
    params.push(like, like, like);
  }
  if (from) {
    where.push('b.start_at >= ?');
    params.push(t.zonedToUtc(from, 0));
  }
  if (to) {
    where.push('b.start_at < ?');
    params.push(t.zonedToUtc(t.addDays(to, 1), 0));
  }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = db
    .prepare(`SELECT COUNT(*) AS n FROM bookings b JOIN users u ON u.id = b.user_id ${clause}`)
    .get(...params).n;
  const items = db
    .prepare(`${BOOKING_SELECT} ${clause} ORDER BY b.start_at DESC LIMIT ? OFFSET ?`)
    .all(...params, pageSize, (page - 1) * pageSize)
    .map((b) => toBookingDTO(b, { includeUser: true }));
  return { items, total, page, pageSize, pages: Math.max(1, Math.ceil(total / pageSize)) };
}

// ---------- users ----------

export function listUsers(q, now = clock.now()) {
  const rows = q
    ? db
        .prepare("SELECT * FROM users WHERE name LIKE ? ESCAPE '\\' OR email LIKE ? ESCAPE '\\' ORDER BY name")
        .all(likePattern(q), likePattern(q))
    : db.prepare('SELECT * FROM users ORDER BY role, name').all();
  const counts = db.prepare(
    `SELECT COUNT(*) AS total, SUM(status = 'no_show') AS noShows, SUM(status IN ('confirmed','checked_in') AND end_at > ?) AS upcoming
     FROM bookings WHERE user_id = ?`,
  );
  return rows.map((u) => {
    const c = counts.get(now, u.id);
    const s = strikeInfo(u.id, now);
    return {
      ...toUserDTO(u),
      totalBookings: c.total,
      upcomingBookings: c.upcoming || 0,
      noShows: c.noShows || 0,
      recentStrikes: s.count,
      suspendedUntil: s.suspendedUntil > now ? t.toIso(s.suspendedUntil) : null,
    };
  });
}

export function setUserRole(admin, userId, role) {
  if (admin.id === userId) throw conflict('SELF_ROLE_CHANGE', 'You cannot change your own role.');
  const u = getUserRow(userId);
  if (!u) throw notFound('User');
  db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, userId);
  // Force re-authentication so the new permissions apply everywhere at once.
  destroyUserSessions(userId);
  return toUserDTO(getUserRow(userId));
}

// ---------- analytics ----------

/**
 * Utilisation compares minutes actually used (checked in) against minutes
 * the resource was open. No-show minutes are reported separately because
 * they are the capacity the strike policy is trying to recover.
 */
export function getAnalytics(days = 30, now = clock.now()) {
  const from = now - days * DAY;
  const resources = db.prepare('SELECT * FROM resources ORDER BY name').all();
  const rows = db
    .prepare('SELECT resource_id, user_id, start_at, end_at, status, source FROM bookings WHERE start_at >= ? AND start_at < ?')
    .all(from, now);

  const per = new Map(
    resources.map((r) => [
      r.id,
      {
        id: r.id,
        name: r.name,
        type: r.type,
        active: Boolean(r.active),
        bookings: 0,
        usedMinutes: 0,
        noShowMinutes: 0,
        noShows: 0,
        cancellations: 0,
        openMinutes: days * (r.close_minute - r.open_minute),
      },
    ]),
  );
  // heatmap[weekday Mon=0..Sun=6][hour 0..23] = minutes booked
  const heatmap = Array.from({ length: 7 }, () => new Array(24).fill(0));
  const users = new Set();
  let completed = 0;
  let noShows = 0;
  let cancellations = 0;
  let fromWaitlist = 0;

  for (const b of rows) {
    const s = per.get(b.resource_id);
    if (!s) continue;
    const minutes = (b.end_at - b.start_at) / MINUTE;
    if (b.status === 'cancelled') {
      s.cancellations += 1;
      cancellations += 1;
      continue;
    }
    s.bookings += 1;
    users.add(b.user_id);
    if (b.source === 'waitlist') fromWaitlist += 1;
    if (b.status === 'no_show') {
      s.noShows += 1;
      s.noShowMinutes += minutes;
      noShows += 1;
    } else if (b.status === 'completed' || b.status === 'checked_in') {
      s.usedMinutes += minutes;
      completed += 1;
    }
    for (let m = b.start_at; m < b.end_at; m += 30 * MINUTE) {
      const p = t.zonedParts(m);
      heatmap[(p.weekday + 6) % 7][p.hour] += 30;
    }
  }

  const perResource = [...per.values()].map((s) => ({
    ...s,
    utilization: s.openMinutes ? s.usedMinutes / s.openMinutes : 0,
    noShowRate: s.bookings ? s.noShows / s.bookings : 0,
  }));
  const totalOpen = perResource.filter((r) => r.active).reduce((a, r) => a + r.openMinutes, 0);
  const totalUsed = perResource.filter((r) => r.active).reduce((a, r) => a + r.usedMinutes, 0);
  const attended = completed + noShows;

  return {
    days,
    from: t.toIso(from),
    to: t.toIso(now),
    totals: {
      bookings: rows.length - cancellations,
      completed,
      noShows,
      cancellations,
      fromWaitlist,
      activeUsers: users.size,
      utilization: totalOpen ? totalUsed / totalOpen : 0,
      noShowRate: attended ? noShows / attended : 0,
      cancellationRate: rows.length ? cancellations / rows.length : 0,
      upcomingNext7Days: db
        .prepare(`SELECT COUNT(*) AS n FROM bookings WHERE status = 'confirmed' AND start_at >= ? AND start_at < ?`)
        .get(now, now + 7 * DAY).n,
      waitingNow: db.prepare(`SELECT COUNT(*) AS n FROM waitlist WHERE status = 'waiting' AND start_at > ?`).get(now).n,
    },
    perResource: perResource.sort((a, b) => b.utilization - a.utilization),
    heatmap,
    timezone: config.timezone,
  };
}
