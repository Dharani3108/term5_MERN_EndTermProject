import { Router } from 'express';
import { validate } from '../lib/validate.js';
import { badRequest } from '../lib/errors.js';
import { parseLocalDateTime, isValidDateStr } from '../lib/time.js';
import { requireAdmin } from '../middleware/auth.js';
import {
  searchResources,
  createResource,
  updateResource,
  setResourceActive,
  RESOURCE_TYPES,
} from '../services/resourceService.js';
import {
  listBlackouts,
  createBlackout,
  deleteBlackout,
  listAllBookings,
  listUsers,
  setUserRole,
  getAnalytics,
} from '../services/adminService.js';
import { cancelBooking } from '../services/bookingService.js';
import { parseId } from './resources.js';

const router = Router();
router.use(requireAdmin);

const resourceInput = (body) =>
  validate(body)
    .string('name', { min: 2, max: 80 })
    .oneOf('type', RESOURCE_TYPES)
    .string('building', { min: 1, max: 80 })
    .int('capacity', { min: 1, max: 500 })
    .string('description', { required: false, max: 500, def: '' })
    .stringArray('amenities', { maxItems: 10, maxLength: 40 })
    .string('openTime', { pattern: /^\d{2}:\d{2}$/, patternMsg: 'must be HH:MM' })
    .string('closeTime', { pattern: /^\d{2}:\d{2}$/, patternMsg: 'must be HH:MM' })
    .int('maxMinutes', { min: 30, max: 720 })
    .done();

// ----- resources -----
router.get('/resources', (req, res) => {
  res.json(searchResources({}, { includeInactive: true }));
});
router.post('/resources', (req, res) => {
  res.status(201).json({ resource: createResource(resourceInput(req.body)) });
});
router.put('/resources/:id', (req, res) => {
  res.json({ resource: updateResource(parseId(req.params.id), resourceInput(req.body)) });
});
router.post('/resources/:id/deactivate', (req, res) => {
  res.json(setResourceActive(parseId(req.params.id), false));
});
router.post('/resources/:id/activate', (req, res) => {
  res.json(setResourceActive(parseId(req.params.id), true));
});

// ----- blackouts -----
router.get('/blackouts', (req, res) => {
  res.json({ items: listBlackouts() });
});
router.post('/blackouts', (req, res) => {
  const input = validate(req.body)
    .int('resourceId', { required: false, min: 1 })
    .string('start', { max: 16 })
    .string('end', { max: 16 })
    .string('reason', { min: 3, max: 120 })
    .done();
  const startAt = parseLocalDateTime(input.start);
  const endAt = parseLocalDateTime(input.end);
  const errors = {};
  if (input.start && startAt === null) errors.start = 'must be a date and time';
  if (input.end && endAt === null) errors.end = 'must be a date and time';
  if (Object.keys(errors).length) throw badRequest('VALIDATION_ERROR', 'Some fields are invalid.', errors);
  res.status(201).json(createBlackout(req.user, { resourceId: input.resourceId, startAt, endAt, reason: input.reason }));
});
router.delete('/blackouts/:id', (req, res) => {
  res.json(deleteBlackout(parseId(req.params.id)));
});

// ----- bookings -----
router.get('/bookings', (req, res) => {
  const f = validate(req.query)
    .oneOf('status', ['confirmed', 'checked_in', 'completed', 'cancelled', 'no_show'], { required: false })
    .int('resourceId', { required: false, min: 1 })
    .string('q', { required: false, max: 80 })
    .string('from', { required: false, max: 10 })
    .string('to', { required: false, max: 10 })
    .int('page', { required: false, min: 1, max: 10000, def: 1 })
    .int('pageSize', { required: false, min: 5, max: 100, def: 20 })
    .done();
  for (const k of ['from', 'to']) {
    if (f[k] && !isValidDateStr(f[k])) throw badRequest('VALIDATION_ERROR', 'Some fields are invalid.', { [k]: 'must be YYYY-MM-DD' });
  }
  res.json(listAllBookings(f));
});
router.post('/bookings/:id/cancel', (req, res) => {
  const { reason } = validate(req.body).string('reason', { min: 3, max: 200 }).done();
  res.json(cancelBooking(req.user, parseId(req.params.id), { reason }));
});

// ----- users -----
router.get('/users', (req, res) => {
  const { q } = validate(req.query).string('q', { required: false, max: 80 }).done();
  res.json({ items: listUsers(q) });
});
router.put('/users/:id/role', (req, res) => {
  const { role } = validate(req.body).oneOf('role', ['student', 'admin']).done();
  res.json({ user: setUserRole(req.user, parseId(req.params.id), role) });
});

// ----- analytics -----
router.get('/analytics', (req, res) => {
  const { days } = validate(req.query).int('days', { required: false, min: 1, max: 365, def: 30 }).done();
  res.json(getAnalytics(days));
});

export default router;
