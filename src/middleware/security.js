// Security headers, CSRF guard and a small in-memory rate limiter.
import { AppError, tooMany } from '../lib/errors.js';

export function securityHeaders(_req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
  );
  next();
}

// State-changing API calls must carry a custom header. Browsers will not let
// another origin set it without a CORS preflight (which we never approve),
// so together with SameSite cookies this blocks cross-site request forgery.
export function csrfGuard(req, _res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.get('X-Requested-With') !== 'fetch') {
    return next(new AppError(403, 'CSRF_REJECTED', 'Request rejected: missing anti-forgery header.'));
  }
  next();
}

/** Fixed-window limiter keyed by a function of the request. */
export function rateLimit({ windowMs, max, key, message }) {
  const hits = new Map();
  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [k, v] of hits) if (v.reset <= now) hits.delete(k);
  }, windowMs);
  sweep.unref();

  const limiter = (req, res, next) => {
    const now = Date.now();
    const k = key(req);
    let entry = hits.get(k);
    if (!entry || entry.reset <= now) {
      entry = { count: 0, reset: now + windowMs };
      hits.set(k, entry);
    }
    entry.count += 1;
    if (entry.count > max) {
      res.setHeader('Retry-After', Math.ceil((entry.reset - now) / 1000));
      return next(tooMany(message));
    }
    next();
  };
  limiter.reset = (req) => hits.delete(key(req));
  return limiter;
}
