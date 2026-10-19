import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createApp } from '../src/app.js';
import { openDatabase } from '../src/database.js';

let server;
let baseUrl;
let database;

before(async () => {
  database = openDatabase();
  server = createApp({ database }).listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  database?.close();
});

test('health endpoint confirms the API is running', async () => {
  const response = await fetch(`${baseUrl}/api/v1/health`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: 'ok' });
});

test('unknown routes return a JSON error', async () => {
  const response = await fetch(`${baseUrl}/missing`);
  assert.equal(response.status, 404);
  assert.equal((await response.json()).error.code, 'NOT_FOUND');
});

test('malformed JSON returns a useful client error', async () => {
  const response = await fetch(`${baseUrl}/api/v1/items`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{broken',
  });
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error.code, 'INVALID_JSON');
});

test('oversized JSON requests are rejected', async () => {
  const response = await fetch(`${baseUrl}/api/v1/items`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ description: 'x'.repeat(110_000) }),
  });
  assert.equal(response.status, 413);
  assert.equal((await response.json()).error.code, 'BODY_TOO_LARGE');
});

test('OpenAPI documentation is served with all report and account operations', async () => {
  const response = await fetch(`${baseUrl}/api/v1/openapi.json`);
  assert.equal(response.status, 200);
  const spec = await response.json();
  assert.equal(spec.openapi, '3.1.0');
  assert.equal(spec.servers[0].url, '/api/v1');
  for (const [path, method] of [
    ['/auth/register', 'post'], ['/auth/login', 'post'], ['/auth/me', 'get'],
    ['/auth/logout', 'post'], ['/items', 'get'], ['/items', 'post'],
    ['/items/{id}', 'get'], ['/items/{id}', 'patch'], ['/items/{id}/recover', 'patch'],
  ]) {
    assert.ok(spec.paths[path][method].responses);
  }
  function checkReferences(value) {
    if (!value || typeof value !== 'object') return;
    if (value.$ref) {
      assert.ok(value.$ref.startsWith('#/'));
      const target = value.$ref.slice(2).split('/').reduce((node, key) => node?.[key], spec);
      assert.ok(target, `Unresolved OpenAPI reference: ${value.$ref}`);
    }
    Object.values(value).forEach(checkReferences);
  }
  checkReferences(spec);
});

test('responses avoid caching private data and exposing framework headers', async () => {
  const response = await fetch(`${baseUrl}/api/v1/health`);
  assert.equal(response.headers.get('x-powered-by'), null);
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(response.headers.get('cache-control'), 'no-store');
});

test('unsupported media types and character sets return JSON errors', async () => {
  for (const contentType of ['text/plain', 'application/json; charset=iso-8859-1']) {
    const response = await fetch(`${baseUrl}/api/v1/items`, {
      method: 'POST', headers: { 'Content-Type': contentType }, body: '{}',
    });
    assert.equal(response.status, 415);
    assert.equal((await response.json()).error.code, 'UNSUPPORTED_MEDIA_TYPE');
  }
});

test('registration and login share a rate limit, including malformed requests, and it expires', async t => {
  const db = openDatabase();
  const limited = createApp({ database: db, authRateLimit: { max: 2, windowMs: 60_000 } }).listen(0, '127.0.0.1');
  t.after(async () => {
    await new Promise(resolve => limited.close(resolve));
    db.close();
  });
  await new Promise((resolve, reject) => {
    limited.once('listening', resolve);
    limited.once('error', reject);
  });
  let now = Date.now();
  t.mock.method(Date, 'now', () => now);
  const url = `http://127.0.0.1:${limited.address().port}/api/v1`;
  const request = (path, body) => fetch(`${url}/auth/${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': Math.random().toString() }, body,
  });
  assert.equal((await request('register', '{broken')).status, 400);
  assert.equal((await request('login', '{}')).status, 400);
  const blocked = await request('register', '{}');
  assert.equal(blocked.status, 429);
  assert.equal(blocked.headers.get('retry-after'), '60');
  assert.equal((await blocked.json()).error.code, 'TOO_MANY_REQUESTS');
  assert.equal((await fetch(`${url}/health`)).status, 200);
  assert.equal((await fetch(`${url}/auth/me`)).status, 401);
  now += 60_001;
  const retry = await request('login', '{}');
  assert.equal(retry.status, 400);
  assert.equal(retry.headers.get('retry-after'), null);
});
