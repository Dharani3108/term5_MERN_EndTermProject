import { Router } from 'express';
import { validate } from '../lib/validate.js';
import { rateLimit } from '../middleware/security.js';
import { requireAuth, setSessionCookie, clearSessionCookie } from '../middleware/auth.js';
import { createUser, authenticate, createSession, destroySession } from '../services/authService.js';
import { toUserDTO } from '../services/repo.js';
import { getAccountSummary } from '../services/bookingService.js';

const router = Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60_000,
  max: 10,
  key: (req) => `${req.ip}|${String(req.body?.email || '').toLowerCase()}`,
  message: 'Too many sign-in attempts. Please wait 15 minutes and try again.',
});

const registerLimiter = rateLimit({
  windowMs: 60 * 60_000,
  max: 20,
  key: (req) => req.ip,
  message: 'Too many accounts created from this network. Please try again later.',
});

router.post('/register', registerLimiter, async (req, res) => {
  const input = validate(req.body)
    .string('name', { min: 2, max: 60 })
    .email('email')
    .string('password', {
      min: 8,
      max: 128,
      pattern: /^(?=.*[A-Za-z])(?=.*\d)/,
      patternMsg: 'must contain at least one letter and one number',
    })
    .done();
  const user = await createUser(input);
  setSessionCookie(res, createSession(user.id));
  res.status(201).json({ user: toUserDTO(user) });
});

router.post('/login', loginLimiter, async (req, res) => {
  const { email, password } = validate(req.body).email('email').string('password', { max: 128 }).done();
  const user = await authenticate(email, password);
  loginLimiter.reset(req);
  setSessionCookie(res, createSession(user.id));
  res.json({ user: toUserDTO(user) });
});

router.post('/logout', (req, res) => {
  destroySession(req.sessionToken);
  clearSessionCookie(res);
  res.status(204).end();
});

router.get('/me', requireAuth, (req, res) => {
  res.json({ user: toUserDTO(req.user), account: getAccountSummary(req.user) });
});

export default router;
