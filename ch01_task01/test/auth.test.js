import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { createApp } from '../src/app.js';
import { openDatabase } from '../src/database.js';

const account = { name: 'Ayoub', email: 'ayoub@example.com', password: 'a secure example passphrase' };

async function fixture(t) {
  const database = openDatabase();
  const server = createApp({ database, authRateLimit: false }).listen(0, '127.0.0.1');
  t.after(async () => {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    database.close();
  });
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}/api/v1/auth`;
  const request = async (path, { method = 'GET', body, token, headers = {} } = {}) => {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    return { status: response.status, headers: response.headers, body: response.status === 204 ? null : await response.json() };
  };
  const registerAndLogin = async (values = account) => {
    assert.equal((await request('/register', { method: 'POST', body: values })).status, 201);
    const result = await request('/login', { method: 'POST', body: { email: values.email, password: values.password } });
    assert.equal(result.status, 200);
    return result.body;
  };
  return { database, request, registerAndLogin };
}

test('registration normalizes public data and stores a salted password hash', async t => {
  const { database, request } = await fixture(t);
  const result = await request('/register', {
    method: 'POST', body: { ...account, name: '  Ayoub  ', email: '  AYOUB@Example.com ' },
  });
  assert.equal(result.status, 201);
  assert.equal(result.headers.get('cache-control'), 'no-store');
  assert.deepEqual(Object.keys(result.body), ['user']);
  assert.deepEqual(Object.keys(result.body.user).sort(), ['createdAt', 'email', 'id', 'name']);
  assert.equal(result.body.user.name, 'Ayoub');
  assert.equal(result.body.user.email, 'ayoub@example.com');
  assert.match(result.body.user.id, /^[a-f0-9-]{36}$/);
  assert.equal(new Date(result.body.user.createdAt).toISOString(), result.body.user.createdAt);
  const stored = database.prepare('SELECT * FROM users').get();
  assert.notEqual(stored.password_hash, account.password);
  assert.match(stored.password_hash, /^scrypt\$32768\$8\$1\$[A-Za-z0-9_-]{22}\$[A-Za-z0-9_-]{86}$/);
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM sessions').get().count, 0);
});

test('password hashes use a fresh salt for each account', async t => {
  const { database, request } = await fixture(t);
  await request('/register', { method: 'POST', body: account });
  await request('/register', { method: 'POST', body: { ...account, email: 'second@example.com' } });
  const hashes = database.prepare('SELECT password_hash FROM users ORDER BY email').all();
  assert.equal(hashes.length, 2);
  assert.notEqual(hashes[0].password_hash, hashes[1].password_hash);
});

test('duplicate email checks are case insensitive, including simultaneous registrations', async t => {
  const { database, request } = await fixture(t);
  const results = await Promise.all([
    request('/register', { method: 'POST', body: account }),
    request('/register', { method: 'POST', body: { ...account, email: 'AYOUB@example.com' } }),
  ]);
  assert.deepEqual(results.map(result => result.status).sort(), [201, 409]);
  assert.equal(results.find(result => result.status === 409).body.error.code, 'EMAIL_IN_USE');
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM users').get().count, 1);
});

test('login issues an expiring opaque token and stores only its SHA-256 hash', async t => {
  const { database, request, registerAndLogin } = await fixture(t);
  const login = await registerAndLogin();
  assert.match(login.token, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(login.tokenType, 'Bearer');
  assert.ok(Date.parse(login.expiresAt) > Date.now());
  assert.ok(Date.parse(login.expiresAt) <= Date.now() + 604800 * 1000);
  const session = database.prepare('SELECT * FROM sessions').get();
  assert.equal(session.token_hash, createHash('sha256').update(login.token).digest('hex'));
  assert.notEqual(session.token_hash, login.token);
  assert.equal(session.expires_at, Date.parse(login.expiresAt));
  assert.equal(session.user_id, login.user.id);
  const me = await request('/me', { token: login.token });
  assert.equal(me.status, 200);
  assert.equal(me.headers.get('cache-control'), 'no-store');
  assert.deepEqual(me.body, { user: login.user });
});

test('password whitespace is preserved and email matching ignores case', async t => {
  const { request } = await fixture(t);
  const values = { ...account, password: '  password with spaces  ' };
  assert.equal((await request('/register', { method: 'POST', body: values })).status, 201);
  assert.equal((await request('/login', {
    method: 'POST', body: { email: ' AYOUB@EXAMPLE.COM ', password: values.password },
  })).status, 200);
  assert.equal((await request('/login', {
    method: 'POST', body: { email: account.email, password: values.password.trim() },
  })).status, 401);
});

test('unknown accounts and incorrect passwords return the same credentials error', async t => {
  const { request } = await fixture(t);
  await request('/register', { method: 'POST', body: account });
  const incorrect = await request('/login', {
    method: 'POST', body: { email: account.email, password: 'an incorrect password' },
  });
  const missing = await request('/login', {
    method: 'POST', body: { email: 'missing@example.com', password: account.password },
  });
  assert.equal(incorrect.status, 401);
  assert.equal(missing.status, 401);
  assert.deepEqual(incorrect.body, missing.body);
  assert.equal(incorrect.body.error.code, 'INVALID_CREDENTIALS');
  assert.equal(incorrect.headers.get('cache-control'), 'no-store');
});

test('registration rejects missing, invalid, oversized, and unknown fields', async t => {
  const { database, request } = await fixture(t);
  const invalidBodies = [
    undefined, {}, [],
    { ...account, name: '   ' }, { ...account, name: 123 }, { ...account, name: 'x'.repeat(81) },
    { ...account, email: 'invalid' }, { ...account, email: 123 },
    { ...account, email: `${'a'.repeat(250)}@example.com` },
    { ...account, password: 'short' }, { ...account, password: 123456789012 },
    { ...account, password: 'x'.repeat(129) },
    { ...account, ownerId: 'forged-owner' },
  ];
  for (const body of invalidBodies) {
    const result = await request('/register', { method: 'POST', body });
    assert.equal(result.status, 400);
    assert.equal(result.body.error.code, 'VALIDATION_ERROR');
  }
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM users').get().count, 0);
});

test('login rejects additional fields and invalid credential shapes', async t => {
  const { request } = await fixture(t);
  for (const body of [undefined, {}, [], { email: account.email, password: 'short' }, account]) {
    const result = await request('/login', { method: 'POST', body });
    assert.equal(result.status, 400);
    assert.equal(result.body.error.code, 'VALIDATION_ERROR');
  }
});

test('missing, malformed, and unknown bearer tokens cannot access the current user', async t => {
  const { request, registerAndLogin } = await fixture(t);
  const login = await registerAndLogin();
  for (const authorization of [
    undefined, 'Basic abc123', 'Bearer', 'Bearer short', 'Bearer a.b.c',
    `Bearer ${'a'.repeat(43)}`, `Bearer ${login.token} extra`,
  ]) {
    const result = await request('/me', { headers: authorization ? { Authorization: authorization } : {} });
    assert.equal(result.status, 401);
    assert.equal(result.body.error.code, 'UNAUTHORIZED');
  }
  assert.equal((await request('/me', { headers: { Authorization: `bearer ${login.token}` } })).status, 200);
});

test('expired sessions are rejected and removed', async t => {
  const { database, request, registerAndLogin } = await fixture(t);
  const login = await registerAndLogin();
  database.prepare('UPDATE sessions SET expires_at = ?').run(Date.now() - 1);
  const result = await request('/me', { token: login.token });
  assert.equal(result.status, 401);
  assert.equal(result.body.error.code, 'UNAUTHORIZED');
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM sessions').get().count, 0);
});

test('logging out revokes the current session without revoking another device', async t => {
  const { request, registerAndLogin } = await fixture(t);
  const first = await registerAndLogin();
  const second = await request('/login', { method: 'POST', body: { email: account.email, password: account.password } });
  assert.equal(second.status, 200);
  assert.notEqual(first.token, second.body.token);
  const logout = await request('/logout', { method: 'POST', token: first.token });
  assert.equal(logout.status, 204);
  assert.equal(logout.body, null);
  assert.equal((await request('/me', { token: first.token })).status, 401);
  assert.equal((await request('/logout', { method: 'POST', token: first.token })).status, 401);
  assert.equal((await request('/me', { token: second.body.token })).status, 200);
});

test('database startup applies a persistent versioned migration once', t => {
  const directory = mkdtempSync(join(tmpdir(), 'lost-found-database-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const filename = join(directory, 'nested', 'test.sqlite');
  const database = openDatabase(filename);
  assert.equal(database.prepare('PRAGMA user_version').get().user_version, 1);
  assert.equal(database.prepare('PRAGMA foreign_keys').get().foreign_keys, 1);
  assert.equal(database.prepare('PRAGMA journal_mode').get().journal_mode, 'wal');
  database.prepare('INSERT INTO users VALUES (?, ?, ?, ?, ?)').run('id', 'Name', 'test@example.com', 'hash', '2026-01-01T00:00:00.000Z');
  database.close();
  const reopened = openDatabase(filename);
  try {
    assert.equal(reopened.prepare('SELECT COUNT(*) AS count FROM users').get().count, 1);
    assert.equal(reopened.prepare('PRAGMA user_version').get().user_version, 1);
    assert.equal(reopened.prepare('PRAGMA foreign_keys').get().foreign_keys, 1);
  } finally {
    reopened.close();
  }
});

test('database constraints enforce foreign keys and strict column types', t => {
  const database = openDatabase();
  t.after(() => database.close());
  assert.throws(() => database.prepare('INSERT INTO sessions VALUES (?, ?, ?, ?)').run('hash', 'missing-user', 1234, 'now'), /FOREIGN KEY/);
  database.prepare('INSERT INTO users VALUES (?, ?, ?, ?, ?)').run('id', 'Name', 'test@example.com', 'hash', 'now');
  assert.throws(() => database.prepare('INSERT INTO sessions VALUES (?, ?, ?, ?)').run('hash', 'id', 'invalid-number', 'now'), /INTEGER/);
  const tables = database.prepare('PRAGMA table_list').all().filter(table => ['users', 'sessions', 'items'].includes(table.name));
  assert.equal(tables.length, 3);
  assert.ok(tables.every(table => table.strict === 1));
});

test('database startup rejects newer schemas without altering them', t => {
  const directory = mkdtempSync(join(tmpdir(), 'lost-found-schema-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const filename = join(directory, 'future.sqlite');
  const future = new DatabaseSync(filename);
  future.exec('PRAGMA user_version = 2');
  future.close();
  assert.throws(() => openDatabase(filename), /newer than supported/);
  const database = new DatabaseSync(filename);
  try {
    assert.equal(database.prepare('PRAGMA user_version').get().user_version, 2);
  } finally {
    database.close();
  }
});
