import { Router } from 'express';
import { validate } from '../lib/validate.js';
import { badRequest } from '../lib/errors.js';
import { requireAuth } from '../middleware/auth.js';
import { createBooking, cancelBooking, checkIn, listMyBookings } from '../services/bookingService.js';
import { parseId } from './resources.js';

const router = Router();
router.use(requireAuth);

export function bookingInput(body) {
  return validate(body)
    .int('resourceId', { min: 1 })
    .instant('startAt')
    .instant('endAt')
    .int('attendees', { required: false, min: 1, max: 1000, def: 1 })
    .string('purpose', { required: false, max: 200, def: '' })
    .done();
}

router.get('/mine', (req, res) => {
  const scope = req.query.scope === 'past' ? 'past' : 'upcoming';
  res.json({ items: listMyBookings(req.user, scope) });
});

router.post('/', (req, res) => {
  const key = req.get('Idempotency-Key') || null;
  if (key && !/^[A-Za-z0-9_-]{8,64}$/.test(key)) {
    throw badRequest('INVALID_IDEMPOTENCY_KEY', 'Idempotency-Key must be 8 to 64 letters, digits, dashes or underscores.');
  }
  const { booking, replayed } = createBooking(req.user, bookingInput(req.body), { idempotencyKey: key });
  res.status(replayed ? 200 : 201).json({ booking, replayed });
});

router.post('/:id/cancel', (req, res) => {
  const { reason } = validate(req.body).string('reason', { required: false, max: 200 }).done();
  res.json(cancelBooking(req.user, parseId(req.params.id), { reason: reason || null }));
});

router.post('/:id/check-in', (req, res) => {
  res.json(checkIn(req.user, parseId(req.params.id)));
});

export default router;
