// Test fixtures: a fresh in-memory database, a frozen clock and helpers for
// building campus-local instants.
import { initDb, closeDb, db } from '../src/db/index.js';
import { clock } from '../src/lib/clock.js';
import { zonedToUtc, parseHHMM } from '../src/lib/time.js';
import { createUser } from '../src/services/authService.js';
import { createResource } from '../src/services/resourceService.js';

// Monday 2 Nov 2026, 09:00 in Asia/Kolkata.
export const MONDAY = '2026-11-02';
export const NOW = zonedToUtc(MONDAY, 9 * 60);
export const MIN = 60_000;

/** Campus-local instant, e.g. at('2026-11-02', '14:30'). */
export const at = (date, hm) => zonedToUtc(date, parseHHMM(hm));

export async function setup() {
  closeDb();
  initDb(':memory:');
  clock.set(NOW);
  const admin = await createUser({ name: 'Admin', email: 'admin@test.dev', password: 'Admin123', role: 'admin' });
  const alice = await createUser({ name: 'Alice', email: 'alice@test.dev', password: 'Alice123' });
  const bob = await createUser({ name: 'Bob', email: 'bob@test.dev', password: 'Bobby123' });
  const carol = await createUser({ name: 'Carol', email: 'carol@test.dev', password: 'Carol123' });
  const room = createResource({
    name: 'Room 1',
    type: 'study_room',
    building: 'Library',
    capacity: 4,
    openTime: '08:00',
    closeTime: '22:00',
    maxMinutes: 180,
    amenities: [],
    description: '',
  });
  const room2 = createResource({
    name: 'Room 2',
    type: 'study_room',
    building: 'Library',
    capacity: 4,
    openTime: '08:00',
    closeTime: '22:00',
    maxMinutes: 240,
    amenities: [],
    description: '',
  });
  return { admin, alice, bob, carol, room, room2, db };
}

export function teardown() {
  clock.reset();
  closeDb();
}

/** Expects fn to throw an AppError with the given code. */
export function codeOf(fn) {
  try {
    fn();
  } catch (err) {
    return err.code;
  }
  return null;
}
