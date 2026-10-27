// Accounts and sessions. Passwords are hashed with scrypt (salted, slow) and
// sessions are random opaque tokens of which only a SHA-256 hash is stored,
// so a database leak does not reveal usable session cookies.
import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { db } from '../db/index.js';
import { config } from '../config.js';
import { clock } from '../lib/clock.js';
import { AppError, conflict } from '../lib/errors.js';
import { getUserRow } from './repo.js';

const scrypt = promisify(crypto.scrypt);
const KEY_LEN = 64;
const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1 };

export async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password, salt, KEY_LEN, SCRYPT_PARAMS);
  return `scrypt$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(password, stored) {
  const [scheme, saltB64, keyB64] = String(stored).split('$');
  if (scheme !== 'scrypt' || !saltB64 || !keyB64) return false;
  const expected = Buffer.from(keyB64, 'base64');
  const actual = await scrypt(password, Buffer.from(saltB64, 'base64'), expected.length, SCRYPT_PARAMS);
  return crypto.timingSafeEqual(actual, expected);
}

// Used when the email is unknown so login timing does not reveal which
// accounts exist.
let dummyHash = null;
async function getDummyHash() {
  dummyHash ??= await hashPassword(crypto.randomBytes(16).toString('hex'));
  return dummyHash;
}

export async function createUser({ name, email, password, role = 'student' }) {
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (existing) throw conflict('EMAIL_TAKEN', 'An account with this email already exists.');
  const hash = await hashPassword(password);
  // Re-check after the async hash in case of a concurrent registration.
  try {
    const info = db
      .prepare('INSERT INTO users (name, email, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(name, email, hash, role, clock.now());
    return getUserRow(Number(info.lastInsertRowid));
  } catch (err) {
    if (/UNIQUE/.test(err.message)) throw conflict('EMAIL_TAKEN', 'An account with this email already exists.');
    throw err;
  }
}

export async function authenticate(email, password) {
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  const ok = await verifyPassword(password, user ? user.password_hash : await getDummyHash());
  if (!user || !ok) throw new AppError(401, 'INVALID_CREDENTIALS', 'Incorrect email or password.');
  return user;
}

const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

export function createSession(userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  const now = clock.now();
  db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)').run(
    hashToken(token),
    userId,
    now + config.sessionDays * 86_400_000,
    now,
  );
  return token;
}

export function getSessionUser(token) {
  if (!token || token.length > 200) return null;
  const row = db
    .prepare(
      `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ? AND s.expires_at > ?`,
    )
    .get(hashToken(token), clock.now());
  return row || null;
}

export function destroySession(token) {
  if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(token));
}

export function destroyUserSessions(userId) {
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
}
