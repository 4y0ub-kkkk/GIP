import express from 'express';
import { readFileSync } from 'node:fs';
import { createAuthRouter } from './auth.js';
import { createItemsRouter } from './items.js';
import { createAuthLimiter } from './rate-limit.js';
import { HttpError } from './errors.js';

const specification = JSON.parse(readFileSync(new URL('../openapi.json', import.meta.url), 'utf8'));

export function createApp({ database, sessionTtlSeconds = 604800, authRateLimit = {} }) {
  const app = express();
  app.disable('x-powered-by');
  app.set('query parser', 'simple');
  app.use((_request, response, next) => {
    response.set('X-Content-Type-Options', 'nosniff');
    response.set('Cache-Control', 'no-store');
    next();
  });
  if (authRateLimit !== false) {
    app.post(['/api/v1/auth/register', '/api/v1/auth/login'], createAuthLimiter(authRateLimit));
  }
  app.use((request, _response, next) => {
    const hasBody = Number(request.get('content-length')) > 0 || request.get('transfer-encoding');
    if (hasBody && !request.is('application/json')) {
      return next(new HttpError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Request bodies must use application/json'));
    }
    next();
  });
  // Route validation rejects valid JSON primitives with the same error as other non-objects.
  app.use(express.json({ limit: '100kb', strict: false }));

  app.get('/api/v1/health', (_request, response) => {
    response.json({ status: 'ok' });
  });
  app.get('/api/v1/openapi.json', (_request, response) => {
    response.json(specification);
  });
  app.use('/api/v1/auth', createAuthRouter(database, { sessionTtlSeconds }));
  app.use('/api/v1/items', createItemsRouter(database));

  app.use((_request, response) => {
    response.status(404).json({ error: { code: 'NOT_FOUND', message: 'Route not found' } });
  });
  app.use((error, _request, response, _next) => {
    if (error.type === 'entity.parse.failed') {
      return response.status(400).json({ error: { code: 'INVALID_JSON', message: 'Request body must be valid JSON' } });
    }
    if (error.type === 'entity.too.large') {
      return response.status(413).json({ error: { code: 'BODY_TOO_LARGE', message: 'Request body exceeds 100kb' } });
    }
    if (error instanceof HttpError) {
      return response.status(error.status).json({ error: { code: error.code, message: error.message, ...(error.details ? { details: error.details } : {}) } });
    }
    if (error.status === 415) {
      return response.status(415).json({ error: { code: 'UNSUPPORTED_MEDIA_TYPE', message: 'Use UTF-8 JSON with a supported content encoding' } });
    }
    console.error(error);
    response.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' } });
  });
  return app;
}
