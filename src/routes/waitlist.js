import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { joinWaitlist, listMyWaitlist, leaveWaitlist } from '../services/waitlistService.js';
import { parseId } from './resources.js';
import { bookingInput } from './bookings.js';

const router = Router();
router.use(requireAuth);

router.get('/mine', (req, res) => {
  res.json({ items: listMyWaitlist(req.user) });
});

router.post('/', (req, res) => {
  res.status(201).json({ entry: joinWaitlist(req.user, bookingInput(req.body)) });
});

router.delete('/:id', (req, res) => {
  res.json(leaveWaitlist(req.user, parseId(req.params.id)));
});

export default router;
