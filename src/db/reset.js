// Deletes the local database file and re-seeds it. Usage: npm run db:reset
import fs from 'node:fs';
import { config } from '../config.js';
import { initDb, closeDb } from './index.js';
import { seedIfEmpty } from './seed.js';

for (const suffix of ['', '-wal', '-shm']) fs.rmSync(config.dbPath + suffix, { force: true });
initDb(config.dbPath);
await seedIfEmpty();
closeDb();
console.log(`[reset] fresh database at ${config.dbPath}`);
