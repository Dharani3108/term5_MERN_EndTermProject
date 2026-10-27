// Translates every failure into a consistent JSON error envelope:
// { error: { code, message, details? } }
import { AppError } from '../lib/errors.js';

export function apiNotFound(req, res) {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: `No API route for ${req.method} ${req.path}.` } });
}

export function errorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);

  if (err instanceof AppError) {
    return res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
  }
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: { code: 'INVALID_JSON', message: 'The request body is not valid JSON.' } });
  }
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ error: { code: 'PAYLOAD_TOO_LARGE', message: 'The request body is too large.' } });
  }
  if (typeof err.message === 'string' && err.message.includes('UNIQUE constraint failed')) {
    return res.status(409).json({ error: { code: 'DUPLICATE', message: 'That record already exists.' } });
  }
  if (typeof err.message === 'string' && /database is locked|SQLITE_BUSY/i.test(err.message)) {
    return res
      .status(503)
      .json({ error: { code: 'BUSY', message: 'The server is busy. Please try again in a moment.' } });
  }

  console.error(`[error] ${req.method} ${req.originalUrl}`, err);
  res.status(500).json({ error: { code: 'INTERNAL', message: 'Something went wrong on our side. Please try again.' } });
}
