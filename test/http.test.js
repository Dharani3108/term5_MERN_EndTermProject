// End-to-end HTTP tests: auth, sessions, CSRF guard, authorization and
// the error envelope, exercised through the real Express app.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup, teardown, at, MONDAY } from './helpers.js';
import { createApp } from '../src/app.js';

let server;
let base;
let f;

before(async () => {
  f = await setup();
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}/api`;
});
after(() => {
  server.close();
  teardown();
});

async function call(path, { method = 'GET', body, cookie, csrf = true, headers = {} } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(csrf && method !== 'GET' ? { 'X-Requested-With': 'fetch' } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null, cookie: res.headers.get('set-cookie') };
}

const sid = (setCookie) => setCookie.split(';')[0];

async function login(email, password) {
  const r = await call('/auth/login', { method: 'POST', body: { email, password } });
  assert.equal(r.status, 200);
  return sid(r.cookie);
}

test('registration validates input, hashes passwords and starts a session', async () => {
  const bad = await call('/auth/register', { method: 'POST', body: { name: 'D', email: 'nope', password: 'short' } });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.error.code, 'VALIDATION_ERROR');
  assert.deepEqual(Object.keys(bad.body.error.details).sort(), ['email', 'name', 'password']);

  const ok = await call('/auth/register', { method: 'POST', body: { name: 'Dana', email: 'Dana@Test.dev', password: 'Dana1234' } });
  assert.equal(ok.status, 201);
  assert.equal(ok.body.user.email, 'dana@test.dev');
  assert.equal(ok.body.user.role, 'student');
  assert.match(ok.cookie, /HttpOnly/);
  assert.match(ok.cookie, /SameSite=Lax/);
  const row = f.db.prepare('SELECT password_hash FROM users WHERE email = ?').get('dana@test.dev');
  assert.match(row.password_hash, /^scrypt\$/);

  const dup = await call('/auth/register', { method: 'POST', body: { name: 'Dana', email: 'dana@test.dev', password: 'Dana1234' } });
  assert.equal(dup.status, 409);
  assert.equal(dup.body.error.code, 'EMAIL_TAKEN');

  const me = await call('/auth/me', { cookie: sid(ok.cookie) });
  assert.equal(me.body.user.name, 'Dana');
  assert.equal(me.body.account.weeklyQuotaMinutes, 600);
});

test('login gives one generic error for wrong email or password', async () => {
  const a = await call('/auth/login', { method: 'POST', body: { email: 'alice@test.dev', password: 'wrong-pass1' } });
  const b = await call('/auth/login', { method: 'POST', body: { email: 'ghost@test.dev', password: 'wrong-pass1' } });
  assert.equal(a.status, 401);
  assert.equal(b.status, 401);
  assert.equal(a.body.error.message, b.body.error.message);
});

test('protected routes require a session, and logout revokes it', async () => {
  assert.equal((await call('/bookings/mine')).status, 401);
  const cookie = await login('alice@test.dev', 'Alice123');
  assert.equal((await call('/bookings/mine', { cookie })).status, 200);
  assert.equal((await call('/auth/logout', { method: 'POST', cookie })).status, 204);
  assert.equal((await call('/bookings/mine', { cookie })).status, 401);
});

test('state-changing requests without the anti-forgery header are rejected', async () => {
  const cookie = await login('alice@test.dev', 'Alice123');
  const r = await call('/bookings', { method: 'POST', cookie, csrf: false, body: {} });
  assert.equal(r.status, 403);
  assert.equal(r.body.error.code, 'CSRF_REJECTED');
});

test('students cannot reach admin endpoints; admins can', async () => {
  const student = await login('alice@test.dev', 'Alice123');
  const admin = await login('admin@test.dev', 'Admin123');
  assert.equal((await call('/admin/analytics', { cookie: student })).status, 403);
  assert.equal((await call('/admin/analytics', { cookie: admin })).status, 200);
  const users = await call('/admin/users', { cookie: admin });
  assert.ok(users.body.items.every((u) => !('password_hash' in u)));
});

test('booking over HTTP: create, idempotent replay, conflict and error envelope', async () => {
  const alice = await login('alice@test.dev', 'Alice123');
  const bob = await login('bob@test.dev', 'Bobby123');
  const body = { resourceId: f.room.id, startAt: new Date(at(MONDAY, '15:00')).toISOString(), endAt: new Date(at(MONDAY, '16:00')).toISOString() };
  const headers = { 'Idempotency-Key': 'test-key-0001' };

  const first = await call('/bookings', { method: 'POST', cookie: alice, body, headers });
  assert.equal(first.status, 201);
  const replay = await call('/bookings', { method: 'POST', cookie: alice, body, headers });
  assert.equal(replay.status, 200);
  assert.equal(replay.body.replayed, true);
  assert.equal(replay.body.booking.id, first.body.booking.id);

  const taken = await call('/bookings', { method: 'POST', cookie: bob, body });
  assert.equal(taken.status, 409);
  assert.equal(taken.body.error.code, 'SLOT_TAKEN');

  const other = await call(`/bookings/${first.body.booking.id}/cancel`, { method: 'POST', cookie: bob, body: {} });
  assert.equal(other.status, 404, 'other users cannot see or cancel it');

  const malformed = await fetch(`${base}/bookings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'fetch', Cookie: alice },
    body: '{not json',
  });
  assert.equal(malformed.status, 400);
  assert.equal((await malformed.json()).error.code, 'INVALID_JSON');

  assert.equal((await call('/resources/abc', { cookie: alice })).body.error.code, 'INVALID_ID');
  assert.equal((await call('/resources/9999', { cookie: alice })).status, 404);
  assert.equal((await call('/nope', { cookie: alice })).status, 404);
});

test('security headers are set on every response', async () => {
  const res = await fetch(`${base}/health`);
  assert.match(res.headers.get('content-security-policy'), /default-src 'self'/);
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(res.headers.get('x-frame-options'), 'DENY');
  assert.equal(res.headers.get('x-powered-by'), null);
});

test('repeated failed logins are rate limited', async () => {
  let last;
  for (let i = 0; i < 11; i++) {
    last = await call('/auth/login', { method: 'POST', body: { email: 'carol@test.dev', password: 'bad-guess-1' } });
  }
  assert.equal(last.status, 429);
  assert.equal(last.body.error.code, 'RATE_LIMITED');
});
