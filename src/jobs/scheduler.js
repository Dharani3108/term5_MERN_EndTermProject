// Background jobs, run every minute:
//  1. release unclaimed bookings as no-shows (and offer the time to the waitlist)
//  2. mark checked-in bookings completed once they end
//  3. send check-in reminders shortly before a booking starts
//  4. expire waitlist entries whose slot has passed
//  5. purge expired sessions
// Each step is idempotent, so a crash or restart mid-run is harmless.
import { db, tx } from '../db/index.js';
import { config } from '../config.js';
import { clock } from '../lib/clock.js';
import * as t from '../lib/time.js';
import { notify } from '../services/notificationService.js';
import { BOOKING_SELECT } from '../services/repo.js';
import { publishAvailability, strikeInfo } from '../services/bookingService.js';
import { promoteWaitlist } from '../services/waitlistService.js';

const P = config.policy;
const { MINUTE } = t;

export function runJobs(now = clock.now()) {
  const result = { noShows: 0, promoted: 0, completed: 0, reminders: 0, expiredWaitlist: 0, sessionsPurged: 0 };

  const late = db
    .prepare(`${BOOKING_SELECT} WHERE b.status = 'confirmed' AND b.start_at + ? < ?`)
    .all(P.noShowGraceMinutes * MINUTE, now);
  for (const b of late) {
    tx(() => {
      const changed = db
        .prepare(`UPDATE bookings SET status = 'no_show', updated_at = ? WHERE id = ? AND status = 'confirmed'`)
        .run(now, b.id).changes;
      if (!changed) return;
      result.noShows += 1;
      const s = strikeInfo(b.user_id, now);
      const paused = s.suspendedUntil && s.suspendedUntil > now;
      notify(
        b.user_id,
        'no_show',
        `You did not check in for ${b.resource_name} at ${t.formatLocal(b.start_at)}, so it was released for others. ` +
          `That is ${s.count} of ${s.limit} allowed no-shows in ${s.windowDays} days.` +
          (paused ? ` Booking is paused until ${t.formatLocal(s.suspendedUntil)}.` : ''),
        '#/bookings',
      );
      publishAvailability(b.resource_id, b.start_at);
      if (b.end_at > now) result.promoted += promoteWaitlist(b.resource_id, now, b.end_at, now);
    });
  }

  result.completed = Number(
    db
      .prepare(`UPDATE bookings SET status = 'completed', updated_at = ? WHERE status = 'checked_in' AND end_at <= ?`)
      .run(now, now).changes,
  );

  const due = db
    .prepare(
      `${BOOKING_SELECT} WHERE b.status = 'confirmed' AND b.reminder_sent = 0 AND b.start_at > ? AND b.start_at <= ?`,
    )
    .all(now, now + P.reminderMinutes * MINUTE);
  for (const b of due) {
    tx(() => {
      db.prepare('UPDATE bookings SET reminder_sent = 1 WHERE id = ?').run(b.id);
      notify(
        b.user_id,
        'reminder',
        `Reminder: ${b.resource_name} is booked for you at ${t.formatTime(b.start_at)}. ` +
          `Check in within ${P.noShowGraceMinutes} minutes of the start or it will be released.`,
        '#/bookings',
      );
    });
    result.reminders += 1;
  }

  const expired = db
    .prepare(
      `SELECT w.*, r.name AS resource_name FROM waitlist w JOIN resources r ON r.id = w.resource_id
       WHERE w.status = 'waiting' AND w.start_at <= ?`,
    )
    .all(now);
  for (const w of expired) {
    tx(() => {
      db.prepare(`UPDATE waitlist SET status = 'expired', updated_at = ? WHERE id = ?`).run(now, w.id);
      notify(
        w.user_id,
        'waitlist_expired',
        `The slot you were waiting for (${w.resource_name}, ${t.formatLocal(w.start_at)}) did not open up in time.`,
        '#/bookings',
      );
    });
    result.expiredWaitlist += 1;
  }

  result.sessionsPurged = Number(db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(now).changes);
  return result;
}

export function startScheduler(intervalMs = config.jobIntervalMs) {
  let running = false;
  const run = () => {
    if (running) return;
    running = true;
    try {
      const r = runJobs();
      const touched = Object.entries(r).filter(([k, v]) => v && k !== 'sessionsPurged');
      if (touched.length) console.log('[jobs]', Object.fromEntries(touched));
    } catch (err) {
      console.error('[jobs] run failed', err);
    } finally {
      running = false;
    }
  };
  run();
  const handle = setInterval(run, intervalMs);
  handle.unref();
  return () => clearInterval(handle);
}
