import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { addClient, removeClient } from '../lib/events.js';
import { listNotifications, markRead, markAllRead, unreadCount } from '../services/notificationService.js';
import { parseId } from './resources.js';

const router = Router();
router.use(requireAuth);

router.get('/', (req, res) => {
  res.json(listNotifications(req.user.id));
});

router.post('/read-all', (req, res) => {
  res.json(markAllRead(req.user.id));
});

router.post('/:id/read', (req, res) => {
  res.json(markRead(req.user.id, parseId(req.params.id)));
});

/** Server-Sent Events stream for live notifications and schedule changes. */
export function eventsHandler(req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write('retry: 5000\n\n');
  res.write(`event: hello\ndata: ${JSON.stringify({ unread: unreadCount(req.user.id) })}\n\n`);
  addClient(req.user.id, res);
  req.on('close', () => removeClient(req.user.id, res));
}

export default router;
