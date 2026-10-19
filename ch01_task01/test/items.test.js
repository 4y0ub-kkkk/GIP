import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { createApp } from '../src/app.js';
import { openDatabase } from '../src/database.js';

const report = {
  type: 'lost',
  title: 'Black travel bag',
  description: 'A black travel bag with a small green ribbon on the handle.',
  category: 'Bags',
  location: 'University main entrance',
  eventDate: '2024-02-29',
};

async function startApi(database) {
  const db = database ?? openDatabase(':memory:');
  const server = createApp({ database: db, authRateLimit: false }).listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}/api/v1`;

  return {
    async request(path, { method = 'GET', body, token, headers = {} } = {}) {
      const requestHeaders = { ...headers };
      if (token) requestHeaders.Authorization = `Bearer ${token}`;
      if (body !== undefined && !requestHeaders['Content-Type']) {
        requestHeaders['Content-Type'] = 'application/json';
      }
      const response = await fetch(`${baseUrl}${path}`, {
        method,
        headers: requestHeaders,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      assert.match(response.headers.get('content-type') ?? '', /application\/json/);
      return { response, data: await response.json() };
    },
    async close() {
      await new Promise((resolve, reject) => {
        server.close(error => error ? reject(error) : resolve());
      });
      db.close();
    },
  };
}

async function createAccount(api, name) {
  const credentials = {
    name,
    email: `${randomUUID()}@example.com`,
    password: 'A-long-test-password-42',
  };
  const registration = await api.request('/auth/register', {
    method: 'POST', body: credentials,
  });
  assert.equal(registration.response.status, 201);
  const login = await api.request('/auth/login', {
    method: 'POST', body: { email: credentials.email, password: credentials.password },
  });
  assert.equal(login.response.status, 200);
  assert.equal(login.data.tokenType, 'Bearer');
  return { ...login.data, credentials };
}

async function createItem(api, token, overrides = {}) {
  const result = await api.request('/items', {
    method: 'POST', token, body: { ...report, ...overrides },
  });
  assert.equal(result.response.status, 201, JSON.stringify(result.data));
  return result;
}

function assertError(result, status, code) {
  assert.equal(result.response.status, status, JSON.stringify(result.data));
  assert.equal(result.data.error.code, code);
  assert.equal(typeof result.data.error.message, 'string');
  assert.ok(result.data.error.message.length > 0);
  assert.equal(Object.hasOwn(result.data.error, 'stack'), false);
}

function assertItem(item, ownerId, expected) {
  assert.deepEqual(Object.keys(item).sort(), [
    'id', 'ownerId', 'type', 'title', 'description', 'category', 'location',
    'eventDate', 'status', 'createdAt', 'updatedAt', 'recoveredAt',
  ].sort());
  assert.match(item.id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  assert.equal(item.ownerId, ownerId);
  for (const [key, value] of Object.entries(expected)) assert.equal(item[key], value);
  assert.ok(Number.isFinite(Date.parse(item.createdAt)));
  assert.ok(Number.isFinite(Date.parse(item.updatedAt)));
}

describe('lost and found reports over HTTP', () => {
  let api;
  let owner;
  let other;

  before(async () => {
    api = await startApi();
    owner = await createAccount(api, 'Report owner');
    other = await createAccount(api, 'Another reporter');
  });

  after(async () => {
    if (api) await api.close();
  });

  test('authenticated users report lost and found items; anyone can view their details', async () => {
    for (const type of ['lost', 'found']) {
      const created = await createItem(api, owner.token, { type });
      assert.equal(created.response.headers.get('location'), `/api/v1/items/${created.data.item.id}`);
      assertItem(created.data.item, owner.user.id, {
        ...report, type, status: 'open', recoveredAt: null,
      });
      const details = await api.request(`/items/${created.data.item.id}`);
      assert.equal(details.response.status, 200);
      assert.deepEqual(details.data, created.data);
      assert.equal(JSON.stringify(details.data).includes(owner.credentials.email), false);
      assert.equal(JSON.stringify(details.data).includes(owner.credentials.password), false);
    }
  });

  test('creation, edits, and recovery require a valid bearer session', async () => {
    const { data: { item } } = await createItem(api, owner.token);
    for (const token of [undefined, 'invalid-token']) {
      assertError(await api.request('/items', {
        method: 'POST', body: report, token,
      }), 401, 'UNAUTHORIZED');
      assertError(await api.request(`/items/${item.id}`, {
        method: 'PATCH', body: { title: 'Updated title' }, token,
      }), 401, 'UNAUTHORIZED');
      assertError(await api.request(`/items/${item.id}/recover`, {
        method: 'PATCH', token,
      }), 401, 'UNAUTHORIZED');
    }
    assertError(await api.request('/items?mine=true'), 401, 'UNAUTHORIZED');
  });

  test('only the owner may edit or recover a report', async () => {
    const { data: { item } } = await createItem(api, owner.token);
    assertError(await api.request(`/items/${item.id}`, {
      method: 'PATCH', token: other.token, body: { title: 'Stolen report' },
    }), 403, 'FORBIDDEN');
    assertError(await api.request(`/items/${item.id}/recover`, {
      method: 'PATCH', token: other.token,
    }), 403, 'FORBIDDEN');
    const details = await api.request(`/items/${item.id}`);
    assert.deepEqual(details.data.item, item);
  });

  test('owners can update every report field without changing report identity', async () => {
    const { data: { item } } = await createItem(api, owner.token);
    const changes = {
      type: 'found',
      title: 'Blue laptop sleeve',
      description: 'A blue laptop sleeve found beside the engineering building.',
      category: 'Electronics',
      location: 'Engineering building',
      eventDate: '2024-03-01',
    };
    const updated = await api.request(`/items/${item.id}`, {
      method: 'PATCH', token: owner.token, body: changes,
    });
    assert.equal(updated.response.status, 200);
    assertItem(updated.data.item, owner.user.id, { ...changes, status: 'open', recoveredAt: null });
    assert.equal(updated.data.item.id, item.id);
    assert.equal(updated.data.item.createdAt, item.createdAt);
    assert.ok(Date.parse(updated.data.item.updatedAt) >= Date.parse(item.updatedAt));

    const partial = await api.request(`/items/${item.id}`, {
      method: 'PATCH', token: owner.token, body: { location: 'Security office' },
    });
    assert.equal(partial.response.status, 200);
    assert.equal(partial.data.item.location, 'Security office');
    assert.equal(partial.data.item.title, changes.title);
    assert.equal(partial.data.item.type, 'found');
  });

  test('recovery persists, is idempotent, and prevents subsequent report edits', async () => {
    const { data: { item } } = await createItem(api, owner.token);
    const recovered = await api.request(`/items/${item.id}/recover`, {
      method: 'PATCH', token: owner.token,
    });
    assert.equal(recovered.response.status, 200);
    assert.equal(recovered.data.item.status, 'recovered');
    assert.ok(Number.isFinite(Date.parse(recovered.data.item.recoveredAt)));
    const repeated = await api.request(`/items/${item.id}/recover`, {
      method: 'PATCH', token: owner.token, body: {},
    });
    assert.equal(repeated.response.status, 200);
    assert.deepEqual(repeated.data.item, recovered.data.item);
    const publicDetails = await api.request(`/items/${item.id}`);
    assert.deepEqual(publicDetails.data.item, recovered.data.item);
    assertError(await api.request(`/items/${item.id}`, {
      method: 'PATCH', token: owner.token, body: { title: 'Cannot edit a recovered report' },
    }), 409, 'ITEM_RECOVERED');
  });

  test('identifiers distinguish malformed input from a missing item', async () => {
    for (const method of ['GET', 'PATCH']) {
      assertError(await api.request('/items/not-a-uuid', {
        method, token: owner.token, ...(method === 'PATCH' ? { body: { title: 'A valid title' } } : {}),
      }), 400, 'VALIDATION_ERROR');
      assertError(await api.request(`/items/${randomUUID()}`, {
        method, token: owner.token, ...(method === 'PATCH' ? { body: { title: 'A valid title' } } : {}),
      }), 404, 'ITEM_NOT_FOUND');
    }
    assertError(await api.request('/items/not-a-uuid/recover', {
      method: 'PATCH', token: owner.token,
    }), 400, 'VALIDATION_ERROR');
    assertError(await api.request(`/items/${randomUUID()}/recover`, {
      method: 'PATCH', token: owner.token,
    }), 404, 'ITEM_NOT_FOUND');
  });

  test('report creation requires every field and enforces field bounds and types', async () => {
    for (const field of Object.keys(report)) {
      const body = { ...report };
      delete body[field];
      assertError(await api.request('/items', {
        method: 'POST', token: owner.token, body,
      }), 400, 'VALIDATION_ERROR');
    }
    const invalidFields = [
      { type: 'missing' }, { type: 'LOST' }, { type: 1 },
      { title: 'ab' }, { title: 'x'.repeat(121) }, { title: null },
      { description: 'too short' }, { description: 'x'.repeat(2001) }, { description: [] },
      { category: '' }, { category: 'x'.repeat(51) }, { category: {} },
      { location: '' }, { location: 'x'.repeat(121) }, { location: false },
    ];
    for (const fields of invalidFields) {
      assertError(await api.request('/items', {
        method: 'POST', token: owner.token, body: { ...report, ...fields },
      }), 400, 'VALIDATION_ERROR');
    }
    for (const body of [null, [], 'a report', 42]) {
      assertError(await api.request('/items', {
        method: 'POST', token: owner.token, body,
      }), 400, 'VALIDATION_ERROR');
    }
  });

  test('event dates are real calendar dates in strict format and cannot be in the future', async () => {
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    for (const eventDate of [
      '2023-02-29', '2024-02-30', '2024-04-31', '2024-13-01', '2024-00-01',
      '2024-2-09', '29-02-2024', '2024-02-29T00:00:00Z', '', tomorrow, 20240229,
    ]) {
      assertError(await api.request('/items', {
        method: 'POST', token: owner.token, body: { ...report, eventDate },
      }), 400, 'VALIDATION_ERROR');
    }
    const today = new Date().toISOString().slice(0, 10);
    const accepted = await createItem(api, owner.token, { eventDate: today });
    assert.equal(accepted.data.item.eventDate, today);
  });

  test('clients cannot inject ownership, status, identifiers, or timestamps during creation', async () => {
    for (const fields of [
      { ownerId: other.user.id }, { id: randomUUID() }, { status: 'recovered' },
      { createdAt: '2020-01-01' }, { updatedAt: '2020-01-01' }, { recoveredAt: '2020-01-01' },
      { unknown: 'unexpected' },
    ]) {
      assertError(await api.request('/items', {
        method: 'POST', token: owner.token, body: { ...report, ...fields },
      }), 400, 'VALIDATION_ERROR');
    }
  });

  test('updates validate the entire patch atomically and reject protected or empty patches', async () => {
    const { data: { item } } = await createItem(api, owner.token);
    const invalidPatches = [
      {}, [], null, { ownerId: other.user.id }, { id: randomUUID() },
      { status: 'recovered' }, { createdAt: '2020-01-01' }, { updatedAt: '2020-01-01' },
      { recoveredAt: '2020-01-01' }, { unknown: true },
      { type: 'invalid' }, { title: 'x' }, { description: 'short' },
      { category: '' }, { location: '' }, { eventDate: '2024-02-30' },
      { title: 'This must not be persisted', location: 12 },
    ];
    for (const body of invalidPatches) {
      assertError(await api.request(`/items/${item.id}`, {
        method: 'PATCH', token: owner.token, body,
      }), 400, 'VALIDATION_ERROR');
    }
    const unchanged = await api.request(`/items/${item.id}`);
    assert.deepEqual(unchanged.data.item, item);
  });

  test('recovery accepts no client-supplied fields and rejected input leaves the item open', async () => {
    const { data: { item } } = await createItem(api, owner.token);
    for (const body of [{ status: 'recovered' }, { recoveredAt: '2024-01-01' }, [], null]) {
      assertError(await api.request(`/items/${item.id}/recover`, {
        method: 'PATCH', token: owner.token, body,
      }), 400, 'VALIDATION_ERROR');
    }
    const unchanged = await api.request(`/items/${item.id}`);
    assert.deepEqual(unchanged.data.item, item);
  });

  test('search, inclusive dates, combined filters, ownership, and pagination work together', async () => {
    const marker = 'Search fixture';
    const seeds = [
      { title: `${marker}: copper wallet`, category: 'Accessories', location: 'Campus library', eventDate: '2024-03-01' },
      { title: `${marker}: ruby wallet`, type: 'found', category: 'Accessories', location: 'Campus library', eventDate: '2024-03-05' },
      { title: `${marker}: phone`, category: 'Electronics', location: 'Campus cafeteria', eventDate: '2024-03-10' },
      { title: `${marker}: student card`, type: 'found', category: 'Documents', location: 'City station', eventDate: '2024-03-15' },
      { title: `% _ ${marker}: umbrella`, category: 'Other', location: 'Campus library', eventDate: '2024-03-20' },
      { title: `${marker}: backpack`, category: 'Bags', location: 'Campus library', eventDate: '2024-03-31' },
    ];
    const items = [];
    for (const [index, seed] of seeds.entries()) {
      const created = await createItem(api, index === 5 ? other.token : owner.token, seed);
      items.push(created.data.item);
    }
    const recovery = await api.request(`/items/${items[3].id}/recover`, {
      method: 'PATCH', token: owner.token,
    });
    assert.equal(recovery.response.status, 200);

    async function search(filters = {}, token) {
      const query = new URLSearchParams({ q: marker, ...filters });
      const result = await api.request(`/items?${query}`, { token });
      assert.equal(result.response.status, 200, JSON.stringify(result.data));
      return result.data;
    }
    const all = await search();
    assert.deepEqual(all.pagination, { page: 1, limit: 20, total: 6, totalPages: 1 });
    assert.equal(all.items.length, 6);
    const sorted = [...items].sort((left, right) => {
      const a = `${left.createdAt}:${left.id}`;
      const b = `${right.createdAt}:${right.id}`;
      return a < b ? 1 : a > b ? -1 : 0;
    });
    assert.deepEqual(all.items.map(item => item.id), sorted.map(item => item.id));

    const combined = await search({
      type: 'lost', status: 'open', category: 'ACCESS', location: 'LIBR',
      from: '2024-03-01', to: '2024-03-10',
    });
    assert.deepEqual(combined.items.map(item => item.id), [items[0].id]);
    const boundary = await search({ from: '2024-03-05', to: '2024-03-10' });
    assert.deepEqual(new Set(boundary.items.map(item => item.id)), new Set([items[1].id, items[2].id]));
    const found = await search({ type: 'found' });
    assert.deepEqual(new Set(found.items.map(item => item.id)), new Set([items[1].id, items[3].id]));
    const recovered = await search({ status: 'recovered' });
    assert.deepEqual(recovered.items.map(item => item.id), [items[3].id]);
    const mine = await search({ mine: 'true' }, owner.token);
    assert.equal(mine.pagination.total, 5);
    assert.ok(mine.items.every(item => item.ownerId === owner.user.id));
    const theirs = await search({ mine: 'true' }, other.token);
    assert.deepEqual(theirs.items.map(item => item.id), [items[5].id]);

    const first = await search({ limit: '2', page: '1' });
    const second = await search({ limit: '2', page: '2' });
    assert.deepEqual(first.pagination, { page: 1, limit: 2, total: 6, totalPages: 3 });
    assert.deepEqual(second.pagination, { page: 2, limit: 2, total: 6, totalPages: 3 });
    assert.deepEqual(first.items.map(item => item.id), sorted.slice(0, 2).map(item => item.id));
    assert.deepEqual(second.items.map(item => item.id), sorted.slice(2, 4).map(item => item.id));
    const pastEnd = await search({ limit: '2', page: '100' });
    assert.deepEqual(pastEnd.items, []);
    assert.deepEqual(pastEnd.pagination, { page: 100, limit: 2, total: 6, totalPages: 3 });
    assert.equal((await search({ limit: '100' })).items.length, 6);

    for (const [q, expected] of [['%', items[4].id], ['_', items[4].id]]) {
      const literal = await search({ q });
      assert.deepEqual(literal.items.map(item => item.id), [expected]);
    }
    const injection = await search({ q: "%' OR 1=1 --" });
    assert.deepEqual(injection.items, []);
    assert.equal(injection.pagination.total, 0);
  });

  test('case-insensitive text search covers title, description, category, and location', async () => {
    const distinctive = {
      title: 'TitleNeedle case',
      description: 'A report containing DescriptionNeedle in its detailed description.',
      category: 'CategoryNeedle',
      location: 'LocationNeedle hall',
    };
    const { data: { item } } = await createItem(api, owner.token, distinctive);
    for (const q of ['titleneedle', 'DESCRIPTIONNEEDLE', 'categoryneedle', 'LOCATIONNEEDLE']) {
      const result = await api.request(`/items?${new URLSearchParams({ q })}`);
      assert.equal(result.response.status, 200);
      assert.deepEqual(result.data.items.map(found => found.id), [item.id]);
    }
  });

  test('invalid, repeated, and unknown query parameters are rejected', async () => {
    for (const query of [
      'type=other', 'status=closed', 'type=LOST', 'status=OPEN',
      'page=0', 'page=-1', 'page=1.5', 'page=1e2', 'page=2abc', 'page=',
      'limit=0', 'limit=-1', 'limit=101', 'limit=2.5', 'limit=20abc', 'limit=',
      'from=2024-02-30', 'to=2024-13-01', 'from=2024-2-01',
      'from=2024-03-10&to=2024-03-01', 'mine=maybe',
      'unknown=value', 'page=1&page=2', 'type=lost&type=found', 'q=a&q=b',
      'category=a&category=b', 'location=a&location=b', 'mine=true&mine=false',
      'q%5Bvalue%5D=unexpected',
    ]) {
      assertError(await api.request(`/items?${query}`, { token: owner.token }), 400, 'VALIDATION_ERROR');
    }
  });

  test('request bodies must use JSON media types', async () => {
    const { data: { item } } = await createItem(api, owner.token);
    for (const [path, method, body] of [
      ['/items', 'POST', report],
      [`/items/${item.id}`, 'PATCH', { title: 'A valid replacement title' }],
      [`/items/${item.id}/recover`, 'PATCH', {}],
    ]) {
      assertError(await api.request(path, {
        method, token: owner.token, body, headers: { 'Content-Type': 'text/plain' },
      }), 415, 'UNSUPPORTED_MEDIA_TYPE');
    }
  });
});

test('reports, recovered state, and authenticated ownership survive a database restart', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'lost-and-found-test-'));
  const databasePath = join(directory, 'persistent.sqlite');
  let api;
  try {
    api = await startApi(openDatabase(databasePath));
    const account = await createAccount(api, 'Persistent owner');
    const { data: { item } } = await createItem(api, account.token, { type: 'found' });
    const recovered = await api.request(`/items/${item.id}/recover`, {
      method: 'PATCH', token: account.token,
    });
    assert.equal(recovered.response.status, 200);
    await api.close();
    api = undefined;

    api = await startApi(openDatabase(databasePath));
    const details = await api.request(`/items/${item.id}`);
    assert.equal(details.response.status, 200);
    assert.deepEqual(details.data, recovered.data);
    const login = await api.request('/auth/login', {
      method: 'POST', body: { email: account.credentials.email, password: account.credentials.password },
    });
    assert.equal(login.response.status, 200);
    assert.equal(login.data.user.id, account.user.id);
    const mine = await api.request('/items?mine=true', { token: login.data.token });
    assert.equal(mine.response.status, 200);
    assert.deepEqual(mine.data.items.map(found => found.id), [item.id]);
    const existingSession = await api.request('/items?mine=true', { token: account.token });
    assert.equal(existingSession.response.status, 200);
    assert.deepEqual(existingSession.data.items.map(found => found.id), [item.id]);
  } finally {
    if (api) await api.close();
    await rm(directory, { recursive: true, force: true });
  }
});
