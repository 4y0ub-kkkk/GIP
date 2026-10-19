import { createHash, randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { Router } from 'express';
import { HttpError } from './errors.js';

const deriveKey = promisify(scrypt);
const SCRYPT_OPTIONS = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const PASSWORD_PREFIX = 'scrypt$32768$8$1';
const KEY_LENGTH = 64;
// A missing account still performs the same expensive password comparison.
const DUMMY_PASSWORD_HASH = `${PASSWORD_PREFIX}$${Buffer.alloc(16).toString('base64url')}$${Buffer.alloc(KEY_LENGTH).toString('base64url')}`;

function publicUser(row) {
  return { id: row.id, name: row.name, email: row.email, createdAt: row.created_at };
}

function credentials(body, registering = false) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new HttpError(400, 'VALIDATION_ERROR', 'Request body must be a JSON object');
  }
  const allowedFields = registering ? ['name', 'email', 'password'] : ['email', 'password'];
  const details = Object.keys(body)
    .filter(field => !allowedFields.includes(field))
    .map(field => ({ field, message: 'Unknown field' }));

  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (registering && (!name || name.length > 80)) {
    details.push({ field: 'name', message: 'Must be a string between 1 and 80 characters' });
  }
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    details.push({ field: 'email', message: 'Must be a valid email address of at most 254 characters' });
  }
  const password = body.password;
  if (typeof password !== 'string' || password.length < 12 || password.length > 128) {
    details.push({ field: 'password', message: 'Must be a string between 12 and 128 characters' });
  }
  if (details.length) throw new HttpError(400, 'VALIDATION_ERROR', 'Request validation failed', details);
  return { name, email, password };
}

async function hashPassword(password) {
  const salt = randomBytes(16);
  const key = await deriveKey(password, salt, KEY_LENGTH, SCRYPT_OPTIONS);
  return `${PASSWORD_PREFIX}$${salt.toString('base64url')}$${key.toString('base64url')}`;
}

async function verifyPassword(password, encoded) {
  const parts = encoded.split('$');
  if (parts.length !== 6 || parts.slice(0, 4).join('$') !== PASSWORD_PREFIX) return false;
  const salt = Buffer.from(parts[4], 'base64url');
  const expected = Buffer.from(parts[5], 'base64url');
  if (salt.length !== 16 || expected.length !== KEY_LENGTH) return false;
  const actual = await deriveKey(password, salt, KEY_LENGTH, SCRYPT_OPTIONS);
  return timingSafeEqual(actual, expected);
}

function hashToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

export function requireAuth(database) {
  const findSession = database.prepare(`
    SELECT users.id, users.name, users.email, users.created_at, sessions.expires_at
    FROM sessions JOIN users ON users.id = sessions.user_id
    WHERE sessions.token_hash = ?
  `);
  const deleteSession = database.prepare('DELETE FROM sessions WHERE token_hash = ?');

  return (request, _response, next) => {
    const match = /^Bearer ([A-Za-z0-9_-]{43})$/i.exec(request.get('authorization') || '');
    if (!match) return next(new HttpError(401, 'UNAUTHORIZED', 'A valid bearer token is required'));

    const tokenHash = hashToken(match[1]);
    const session = findSession.get(tokenHash);
    if (!session || session.expires_at <= Date.now()) {
      if (session) deleteSession.run(tokenHash);
      return next(new HttpError(401, 'UNAUTHORIZED', 'A valid bearer token is required'));
    }
    request.user = publicUser(session);
    request.auth = { userId: session.id, tokenHash };
    next();
  };
}

export function createAuthRouter(database, { sessionTtlSeconds = 604800 } = {}) {
  if (!Number.isSafeInteger(sessionTtlSeconds) || sessionTtlSeconds < 1 || sessionTtlSeconds > 31_536_000) {
    throw new TypeError('Session lifetime must be an integer between 1 and 31536000 seconds');
  }
  const router = Router();
  const authenticate = requireAuth(database);
  const findUser = database.prepare('SELECT * FROM users WHERE email = ?');
  const insertUser = database.prepare(
    'INSERT INTO users (id, name, email, password_hash, created_at) VALUES (?, ?, ?, ?, ?)',
  );
  const insertSession = database.prepare(
    'INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)',
  );
  const deleteExpiredSessions = database.prepare('DELETE FROM sessions WHERE expires_at <= ?');
  const deleteSession = database.prepare('DELETE FROM sessions WHERE token_hash = ?');

  router.use((_request, response, next) => {
    response.set('Cache-Control', 'no-store');
    next();
  });

  router.post('/register', async (request, response) => {
    const { name, email, password } = credentials(request.body, true);
    if (findUser.get(email)) throw new HttpError(409, 'EMAIL_IN_USE', 'Email address is already registered');

    const passwordHash = await hashPassword(password);
    const user = { id: randomUUID(), name, email, created_at: new Date().toISOString() };
    try {
      insertUser.run(user.id, name, email, passwordHash, user.created_at);
    } catch (error) {
      // The UNIQUE constraint also covers simultaneous registrations.
      if (error.errcode === 2067) {
        throw new HttpError(409, 'EMAIL_IN_USE', 'Email address is already registered');
      }
      throw error;
    }
    response.status(201).json({ user: publicUser(user) });
  });

  router.post('/login', async (request, response) => {
    const { email, password } = credentials(request.body);
    const user = findUser.get(email);
    const valid = await verifyPassword(password, user?.password_hash || DUMMY_PASSWORD_HASH);
    if (!user || !valid) throw new HttpError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect');

    const now = Date.now();
    const expiresAt = now + sessionTtlSeconds * 1000;
    const token = randomBytes(32).toString('base64url');
    deleteExpiredSessions.run(now);
    insertSession.run(hashToken(token), user.id, expiresAt, new Date(now).toISOString());
    response.json({ token, tokenType: 'Bearer', expiresAt: new Date(expiresAt).toISOString(), user: publicUser(user) });
  });

  router.get('/me', authenticate, (request, response) => {
    response.json({ user: request.user });
  });

  router.post('/logout', authenticate, (request, response) => {
    deleteSession.run(request.auth.tokenHash);
    response.status(204).end();
  });

  return router;
}
