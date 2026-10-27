// Express application factory (kept separate from server.js so tests can
// mount the app without starting background jobs or binding a port).
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { config } from './config.js';
import { db } from './db/index.js';
import { securityHeaders, csrfGuard } from './middleware/security.js';
import { loadSession, requireAuth } from './middleware/auth.js';
import { errorHandler, apiNotFound } from './middleware/errors.js';
import authRoutes from './routes/auth.js';
import resourceRoutes from './routes/resources.js';
import bookingRoutes from './routes/bookings.js';
import waitlistRoutes from './routes/waitlist.js';
import notificationRoutes, { eventsHandler } from './routes/notifications.js';
import adminRoutes from './routes/admin.js';

const publicDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  app.use(securityHeaders);
  app.use(express.json({ limit: '32kb' }));

  app.get('/api/health', (_req, res) => {
    db.prepare('SELECT 1').get();
    res.json({ status: 'ok' });
  });

  app.use('/api', loadSession, csrfGuard);
  app.get('/api/config', (_req, res) => {
    res.json({ timezone: config.timezone, policy: config.policy });
  });
  app.use('/api/auth', authRoutes);
  app.use('/api/resources', resourceRoutes);
  app.use('/api/bookings', bookingRoutes);
  app.use('/api/waitlist', waitlistRoutes);
  app.use('/api/notifications', notificationRoutes);
  app.get('/api/events', requireAuth, eventsHandler);
  app.use('/api/admin', adminRoutes);
  app.use('/api', apiNotFound);

  app.use(express.static(publicDir, { index: 'index.html', maxAge: config.isProduction ? '1h' : 0 }));
  app.use(errorHandler);
  return app;
}
