import { Router } from 'express';
import { validate } from '../lib/validate.js';
import { badRequest } from '../lib/errors.js';
import { localDate } from '../lib/time.js';
import { clock } from '../lib/clock.js';
import { requireAuth } from '../middleware/auth.js';
import { searchResources, getResource, getAvailability, RESOURCE_TYPES } from '../services/resourceService.js';

const router = Router();
router.use(requireAuth);

export function parseId(value, what = 'id') {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw badRequest('INVALID_ID', `Invalid ${what}.`);
  return n;
}

router.get('/', (req, res) => {
  const filters = validate(req.query)
    .string('q', { required: false, max: 80 })
    .oneOf('type', RESOURCE_TYPES, { required: false })
    .string('building', { required: false, max: 80 })
    .int('minCapacity', { required: false, min: 1, max: 1000 })
    .instant('availableAt', { required: false })
    .int('duration', { required: false, min: 30, max: 480 })
    .done();
  res.json(searchResources(filters));
});

router.get('/:id', (req, res) => {
  res.json({ resource: getResource(parseId(req.params.id), req.user) });
});

router.get('/:id/availability', (req, res) => {
  const date = typeof req.query.date === 'string' ? req.query.date : localDate(clock.now());
  res.json(getAvailability(parseId(req.params.id), date, req.user));
});

export default router;
