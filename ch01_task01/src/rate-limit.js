import { HttpError } from './errors.js';

export function createAuthLimiter({ max = 20, windowMs = 15 * 60 * 1000 } = {}) {
  const clients = new Map();
  return (request, response, next) => {
    const now = Date.now();
    // Bound memory even when many distinct clients send one request each.
    for (const [key, entry] of clients) {
      if (entry.expiresAt <= now) clients.delete(key);
    }
    const key = request.ip;
    let entry = clients.get(key);
    if (!entry) {
      if (clients.size >= 10_000) {
        response.set('Retry-After', String(Math.ceil(windowMs / 1000)));
        return next(new HttpError(429, 'TOO_MANY_REQUESTS', 'Try again later.'));
      }
      entry = { count: 0, expiresAt: now + windowMs };
      clients.set(key, entry);
    }
    entry.count++;
    if (entry.count > max) {
      response.set('Retry-After', String(Math.ceil((entry.expiresAt - now) / 1000)));
      return next(new HttpError(429, 'TOO_MANY_REQUESTS', 'Too many account requests. Try again later.'));
    }
    next();
  };
}
