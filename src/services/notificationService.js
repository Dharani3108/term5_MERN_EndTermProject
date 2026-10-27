// Persistent in-app notifications plus a live push once the change commits.
import { db, afterCommit } from '../db/index.js';
import { clock } from '../lib/clock.js';
import { notFound } from '../lib/errors.js';
import { toIso } from '../lib/time.js';
import { sendToUser } from '../lib/events.js';

export function unreadCount(userId) {
  return db.prepare('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read_at IS NULL').get(userId).n;
}

export function notify(userId, type, message, link = null) {
  db.prepare('INSERT INTO notifications (user_id, type, message, link, created_at) VALUES (?, ?, ?, ?, ?)').run(
    userId,
    type,
    message,
    link,
    clock.now(),
  );
  afterCommit(() => sendToUser(userId, 'notification', { type, message, link, unread: unreadCount(userId) }));
}

const toDTO = (n) => ({
  id: n.id,
  type: n.type,
  message: n.message,
  link: n.link,
  read: n.read_at !== null,
  createdAt: toIso(n.created_at),
});

export function listNotifications(userId, { limit = 50 } = {}) {
  const items = db
    .prepare('SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT ?')
    .all(userId, limit)
    .map(toDTO);
  return { items, unread: unreadCount(userId) };
}

export function markRead(userId, id) {
  const info = db
    .prepare('UPDATE notifications SET read_at = COALESCE(read_at, ?) WHERE id = ? AND user_id = ?')
    .run(clock.now(), id, userId);
  if (!info.changes) throw notFound('Notification');
  return { unread: unreadCount(userId) };
}

export function markAllRead(userId) {
  db.prepare('UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL').run(clock.now(), userId);
  return { unread: 0 };
}
