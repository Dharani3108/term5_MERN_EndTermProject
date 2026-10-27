// Ordered schema migrations. PRAGMA user_version records how many have run.
export const MIGRATIONS = [
  `
  CREATE TABLE users (
    id            INTEGER PRIMARY KEY,
    name          TEXT    NOT NULL,
    email         TEXT    NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT    NOT NULL,
    role          TEXT    NOT NULL DEFAULT 'student' CHECK (role IN ('student', 'admin')),
    created_at    INTEGER NOT NULL
  );

  CREATE TABLE sessions (
    token_hash TEXT    PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX idx_sessions_user ON sessions(user_id);

  CREATE TABLE resources (
    id           INTEGER PRIMARY KEY,
    name         TEXT    NOT NULL UNIQUE COLLATE NOCASE,
    type         TEXT    NOT NULL CHECK (type IN ('study_room', 'meeting_room', 'lab', 'equipment', 'sports')),
    building     TEXT    NOT NULL,
    capacity     INTEGER NOT NULL CHECK (capacity > 0),
    description  TEXT    NOT NULL DEFAULT '',
    amenities    TEXT    NOT NULL DEFAULT '[]',
    open_minute  INTEGER NOT NULL CHECK (open_minute BETWEEN 0 AND 1439),
    close_minute INTEGER NOT NULL CHECK (close_minute BETWEEN 1 AND 1440),
    max_minutes  INTEGER NOT NULL CHECK (max_minutes > 0),
    active       INTEGER NOT NULL DEFAULT 1,
    created_at   INTEGER NOT NULL,
    updated_at   INTEGER NOT NULL,
    CHECK (close_minute > open_minute)
  );

  CREATE TABLE bookings (
    id              INTEGER PRIMARY KEY,
    resource_id     INTEGER NOT NULL REFERENCES resources(id),
    user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    start_at        INTEGER NOT NULL,
    end_at          INTEGER NOT NULL,
    attendees       INTEGER NOT NULL DEFAULT 1,
    purpose         TEXT    NOT NULL DEFAULT '',
    status          TEXT    NOT NULL CHECK (status IN ('confirmed', 'checked_in', 'completed', 'cancelled', 'no_show')),
    source          TEXT    NOT NULL DEFAULT 'direct' CHECK (source IN ('direct', 'waitlist')),
    idempotency_key TEXT,
    reminder_sent   INTEGER NOT NULL DEFAULT 0,
    checked_in_at   INTEGER,
    cancelled_at    INTEGER,
    cancel_reason   TEXT,
    created_at      INTEGER NOT NULL,
    updated_at      INTEGER NOT NULL,
    CHECK (end_at > start_at),
    UNIQUE (user_id, idempotency_key)
  );
  CREATE INDEX idx_bookings_resource_time ON bookings(resource_id, start_at, end_at);
  CREATE INDEX idx_bookings_user_time ON bookings(user_id, start_at);
  CREATE INDEX idx_bookings_status_time ON bookings(status, start_at);

  CREATE TABLE waitlist (
    id          INTEGER PRIMARY KEY,
    resource_id INTEGER NOT NULL REFERENCES resources(id),
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    start_at    INTEGER NOT NULL,
    end_at      INTEGER NOT NULL,
    attendees   INTEGER NOT NULL DEFAULT 1,
    purpose     TEXT    NOT NULL DEFAULT '',
    status      TEXT    NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting', 'promoted', 'expired', 'cancelled')),
    booking_id  INTEGER REFERENCES bookings(id),
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL
  );
  CREATE UNIQUE INDEX idx_waitlist_unique_waiting
    ON waitlist(user_id, resource_id, start_at, end_at) WHERE status = 'waiting';
  CREATE INDEX idx_waitlist_resource ON waitlist(resource_id, status, start_at);

  CREATE TABLE blackouts (
    id          INTEGER PRIMARY KEY,
    resource_id INTEGER REFERENCES resources(id),
    start_at    INTEGER NOT NULL,
    end_at      INTEGER NOT NULL,
    reason      TEXT    NOT NULL DEFAULT '',
    created_by  INTEGER REFERENCES users(id),
    created_at  INTEGER NOT NULL,
    CHECK (end_at > start_at)
  );
  CREATE INDEX idx_blackouts_time ON blackouts(start_at, end_at);

  CREATE TABLE notifications (
    id         INTEGER PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type       TEXT    NOT NULL,
    message    TEXT    NOT NULL,
    link       TEXT,
    read_at    INTEGER,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX idx_notifications_user ON notifications(user_id, read_at, created_at);
  `,
];
