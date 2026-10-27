// Seeds an empty database with an admin account and, optionally, a realistic
// demo campus: resources, students, 30 days of history and upcoming bookings.
import crypto from 'node:crypto';
import { db, tx } from './index.js';
import { config } from '../config.js';
import { clock } from '../lib/clock.js';
import * as t from '../lib/time.js';
import { hashPassword } from '../services/authService.js';

export const DEMO_STUDENT = { name: 'Demo Student', email: 'student@slotwise.app', password: 'Student@123' };

const RESOURCES = [
  ['Library Study Room A', 'study_room', 'Central Library', 6, '08:00', '22:00', 180, 'Glass-walled group room on the second floor.', ['Whiteboard', 'TV screen', 'Power outlets']],
  ['Library Study Room B', 'study_room', 'Central Library', 4, '08:00', '22:00', 180, 'Quiet group room next to the reference section.', ['Whiteboard', 'Power outlets']],
  ['Silent Pod 1', 'study_room', 'Central Library', 1, '08:00', '22:00', 240, 'Single-person soundproof pod for focused work.', ['Desk lamp', 'Power outlets']],
  ['Seminar Hall', 'meeting_room', 'Academic Block 2', 60, '08:00', '20:00', 180, 'Tiered hall for club meetings and talks.', ['Projector', 'Microphone', 'Air conditioning']],
  ['Discussion Room 104', 'meeting_room', 'Academic Block 1', 10, '09:00', '21:00', 120, 'Round table room for project discussions.', ['Whiteboard', 'Video conferencing']],
  ['Innovation Lab', 'lab', 'Engineering Block', 20, '09:00', '20:00', 240, 'Maker space with prototyping tools.', ['3D printers', 'Workbenches', 'Soldering stations']],
  ['Electronics Bench 3', 'lab', 'Engineering Block', 2, '09:00', '18:00', 180, 'Bench with oscilloscope and power supply.', ['Oscilloscope', 'Bench power supply']],
  ['DSLR Camera Kit', 'equipment', 'Media Centre', 1, '09:00', '18:00', 240, 'Camera body, two lenses and a tripod. Collect from the media desk.', ['Tripod', '2 lenses']],
  ['Badminton Court 1', 'sports', 'Sports Complex', 4, '06:00', '22:00', 60, 'Indoor wooden court. Bring your own racquets.', ['Shuttle cocks', 'Changing room']],
];

const STUDENTS = ['Rohan Mehta', 'Meera Iyer', 'Kabir Singh', 'Ananya Rao', 'Dev Patel', 'Sara Thomas'];

// Small deterministic PRNG so the demo data looks the same on every fresh seed.
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let x = s;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

export async function seedIfEmpty({ demo = config.seedDemo, now = clock.now() } = {}) {
  if (db.prepare('SELECT COUNT(*) AS n FROM users').get().n > 0) return false;

  const adminHash = await hashPassword(config.adminPassword);
  const studentHash = demo ? await hashPassword(DEMO_STUDENT.password) : null;
  const otherHash = demo ? await hashPassword(crypto.randomBytes(12).toString('hex')) : null;

  tx(() => {
    const insertUser = db.prepare('INSERT INTO users (name, email, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?)');
    insertUser.run('Campus Admin', config.adminEmail, adminHash, 'admin', now);
    if (!demo) return;

    const demoId = Number(insertUser.run(DEMO_STUDENT.name, DEMO_STUDENT.email, studentHash, 'student', now).lastInsertRowid);
    const studentIds = STUDENTS.map((name) =>
      Number(insertUser.run(name, `${name.split(' ')[0].toLowerCase()}@students.slotwise.app`, otherHash, 'student', now).lastInsertRowid),
    );

    const insertResource = db.prepare(
      `INSERT INTO resources (name, type, building, capacity, description, amenities, open_minute, close_minute,
                              max_minutes, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
    );
    const resources = RESOURCES.map(([name, type, building, capacity, open, close, max, description, amenities]) => {
      const id = Number(
        insertResource.run(name, type, building, capacity, description, JSON.stringify(amenities), t.parseHHMM(open), t.parseHHMM(close), max, now, now)
          .lastInsertRowid,
      );
      return { id, open: t.parseHHMM(open), close: t.parseHHMM(close), max, capacity };
    });

    const insertBooking = db.prepare(
      `INSERT INTO bookings (resource_id, user_id, start_at, end_at, attendees, purpose, status, source, reminder_sent,
                             checked_in_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
    );
    const taken = new Map(resources.map((r) => [r.id, []]));
    const userBusy = new Map();
    const free = (list, s, e) => !list.some(([a, b]) => a < e && b > s);
    const purposes = ['Group project', 'Exam revision', 'Club meeting', 'Lab assignment', 'Practice session', 'Interview prep', ''];

    const random = rng(20261027);
    const today = t.localDate(now);

    const place = (r, userId, start, end, status, source = 'direct') => {
      if (!free(taken.get(r.id), start, end)) return false;
      const busy = userBusy.get(userId) || [];
      if (!free(busy, start, end)) return false;
      taken.get(r.id).push([start, end]);
      busy.push([start, end]);
      userBusy.set(userId, busy);
      const attendees = Math.max(1, Math.min(r.capacity, 1 + Math.floor(random() * r.capacity)));
      const purpose = purposes[Math.floor(random() * purposes.length)];
      insertBooking.run(r.id, userId, start, end, attendees, purpose, status, source,
        status === 'completed' ? start + 3 * 60_000 : null, start - 2 * t.DAY, start - 2 * t.DAY);
      return true;
    };

    // 30 days of history. Peak hours are weighted towards afternoons and evenings.
    for (let d = 30; d >= 1; d--) {
      const date = t.addDays(today, -d);
      for (const r of resources) {
        const count = Math.floor(random() * 6);
        for (let i = 0; i < count; i++) {
          const span = (r.close - r.open) / 30;
          const skew = Math.pow(random(), 0.6);
          const slot = Math.floor(skew * span);
          const len = Math.min(r.max, 30 * (1 + Math.floor(random() * 4)));
          const startMin = r.open + slot * 30;
          if (startMin + len > r.close) continue;
          const roll = random();
          const status = roll < 0.12 ? 'no_show' : roll < 0.2 ? 'cancelled' : 'completed';
          const userId = studentIds[Math.floor(random() * studentIds.length)];
          place(r, userId, t.zonedToUtc(date, startMin), t.zonedToUtc(date, startMin + len), status, random() < 0.08 ? 'waitlist' : 'direct');
        }
      }
    }

    // Demo student history (no no-shows, so the account is in good standing).
    for (const [d, idx, startMin, len] of [[3, 0, 600, 120], [6, 2, 840, 90], [10, 5, 660, 60]]) {
      const r = resources[idx];
      const date = t.addDays(today, -d);
      place(r, demoId, t.zonedToUtc(date, startMin), t.zonedToUtc(date, startMin + len), 'completed');
    }

    // Upcoming bookings by other students so the schedule looks busy, including
    // tomorrow 10:00-12:00 in Study Room A for demonstrating the waitlist.
    const tomorrow = t.addDays(today, 1);
    place(resources[0], studentIds[0], t.zonedToUtc(tomorrow, 600), t.zonedToUtc(tomorrow, 720), 'confirmed');
    for (let d = 1; d <= 7; d++) {
      const date = t.addDays(today, d);
      for (const r of resources) {
        const count = 1 + Math.floor(random() * 3);
        for (let i = 0; i < count; i++) {
          const slot = Math.floor(random() * ((r.close - r.open) / 30));
          const len = Math.min(r.max, 30 * (1 + Math.floor(random() * 3)));
          const startMin = r.open + slot * 30;
          if (startMin + len > r.close) continue;
          place(r, studentIds[Math.floor(random() * studentIds.length)], t.zonedToUtc(date, startMin), t.zonedToUtc(date, startMin + len), 'confirmed');
        }
      }
    }

    db.prepare('INSERT INTO notifications (user_id, type, message, link, created_at) VALUES (?, ?, ?, ?, ?)').run(
      demoId,
      'welcome',
      'Welcome to SlotWise! Browse spaces, pick a slot on the grid and remember to check in when you arrive.',
      '#/',
      now,
    );
  });

  console.log(`[seed] created admin ${config.adminEmail}${demo ? ' and demo campus data' : ''}`);
  return true;
}
