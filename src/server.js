import { config } from './config.js';
import { initDb, closeDb } from './db/index.js';
import { seedIfEmpty } from './db/seed.js';
import { createApp } from './app.js';
import { startScheduler } from './jobs/scheduler.js';

initDb(config.dbPath);
await seedIfEmpty();

const app = createApp();
const stopJobs = startScheduler();

const server = app.listen(config.port, () => {
  console.log(`SlotWise running on http://localhost:${config.port} (timezone ${config.timezone})`);
});

function shutdown(signal) {
  console.log(`${signal} received, shutting down`);
  stopJobs();
  server.close(() => {
    closeDb();
    process.exit(0);
  });
  // SSE connections keep the server open; force exit after a grace period.
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
