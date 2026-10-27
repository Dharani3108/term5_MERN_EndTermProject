// SQLite access layer using Node's built-in node:sqlite driver.
// tx() gives atomic, nestable transactions (nested calls become SAVEPOINTs),
// and afterCommit() defers side effects such as real-time pushes until the
// outermost transaction has actually committed.
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { MIGRATIONS } from './migrations.js';

export let db = null;

let depth = 0;
let pending = [];

export function initDb(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('PRAGMA busy_timeout = 5000;');
  migrate();
  return db;
}

export function closeDb() {
  if (db) db.close();
  db = null;
  depth = 0;
  pending = [];
}

function migrate() {
  const { user_version: current } = db.prepare('PRAGMA user_version').get();
  for (let v = current; v < MIGRATIONS.length; v++) {
    tx(() => {
      db.exec(MIGRATIONS[v]);
      db.exec(`PRAGMA user_version = ${v + 1}`);
    });
  }
}

export function tx(fn) {
  if (depth === 0) {
    db.exec('BEGIN IMMEDIATE');
    depth = 1;
    try {
      const result = fn();
      db.exec('COMMIT');
      depth = 0;
      const callbacks = pending;
      pending = [];
      for (const cb of callbacks) {
        try {
          cb();
        } catch (err) {
          console.error('[db] afterCommit callback failed', err);
        }
      }
      return result;
    } catch (err) {
      depth = 0;
      pending = [];
      try {
        db.exec('ROLLBACK');
      } catch {
        // Transaction was already rolled back by SQLite.
      }
      throw err;
    }
  }

  const name = `sp_${depth}`;
  const mark = pending.length;
  db.exec(`SAVEPOINT ${name}`);
  depth += 1;
  try {
    const result = fn();
    db.exec(`RELEASE ${name}`);
    depth -= 1;
    return result;
  } catch (err) {
    depth -= 1;
    db.exec(`ROLLBACK TO ${name}`);
    db.exec(`RELEASE ${name}`);
    pending.length = mark;
    throw err;
  }
}

/** Runs cb once the current transaction commits (immediately if none is open). */
export function afterCommit(cb) {
  if (depth === 0) cb();
  else pending.push(cb);
}
