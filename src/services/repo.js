// Shared row lookups and DTO mappers used across services.
import { db } from '../db/index.js';
import { hhmm, toIso } from '../lib/time.js';

export function getUserRow(id) {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
}

export function getResourceRow(id) {
  if (!Number.isInteger(id)) return undefined;
  return db.prepare('SELECT * FROM resources WHERE id = ?').get(id);
}

export function toUserDTO(u) {
  return { id: u.id, name: u.name, email: u.email, role: u.role, createdAt: toIso(u.created_at) };
}

export function toResourceDTO(r) {
  return {
    id: r.id,
    name: r.name,
    type: r.type,
    building: r.building,
    capacity: r.capacity,
    description: r.description,
    amenities: JSON.parse(r.amenities || '[]'),
    openTime: hhmm(r.open_minute),
    closeTime: hhmm(r.close_minute),
    maxMinutes: r.max_minutes,
    active: Boolean(r.active),
  };
}

export const BOOKING_SELECT = `
  SELECT b.*, r.name AS resource_name, r.building AS building, r.type AS resource_type,
         u.name AS user_name, u.email AS user_email
  FROM bookings b
  JOIN resources r ON r.id = b.resource_id
  JOIN users u ON u.id = b.user_id`;

export function getBookingRow(id) {
  return db.prepare(`${BOOKING_SELECT} WHERE b.id = ?`).get(id);
}

export function toBookingDTO(b, { includeUser = false } = {}) {
  const dto = {
    id: b.id,
    resourceId: b.resource_id,
    resourceName: b.resource_name,
    resourceType: b.resource_type,
    building: b.building,
    startAt: toIso(b.start_at),
    endAt: toIso(b.end_at),
    attendees: b.attendees,
    purpose: b.purpose,
    status: b.status,
    source: b.source,
    createdAt: toIso(b.created_at),
    checkedInAt: toIso(b.checked_in_at),
    cancelledAt: toIso(b.cancelled_at),
    cancelReason: b.cancel_reason ?? null,
  };
  if (includeUser) dto.user = { id: b.user_id, name: b.user_name, email: b.user_email };
  return dto;
}

/** Escapes LIKE wildcards so user search text is matched literally. */
export const likePattern = (s) => `%${s.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
