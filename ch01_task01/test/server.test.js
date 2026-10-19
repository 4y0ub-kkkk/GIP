import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const entrypoint = fileURLToPath(new URL('../src/server.js', import.meta.url));

async function freePort() {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();
  await new Promise(resolve => server.close(resolve));
  return port;
}

async function startServer(directory, port) {
  const child = spawn(process.execPath, [entrypoint], {
    cwd: directory,
    env: { ...process.env, PORT: String(port), DATABASE_PATH: join(directory, 'api.sqlite'), SESSION_TTL_SECONDS: '120' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk; });
  const exited = once(child, 'exit');
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`Server startup timed out: ${stderr}`));
    }, 10_000);
    const failed = () => {
      clearTimeout(timeout);
      reject(new Error(`Server exited during startup: ${stderr}`));
    };
    child.once('exit', failed);
    child.once('error', error => { clearTimeout(timeout); reject(error); });
    let stdout = '';
    child.stdout.on('data', chunk => {
      stdout += chunk;
      if (stdout.includes('listening on port')) {
        clearTimeout(timeout);
        child.off('exit', failed);
        resolve();
      }
    });
  });
  return {
    async stop() {
      child.kill('SIGTERM');
      const deadline = setTimeout(() => child.kill('SIGKILL'), 12_000);
      const [code, signal] = await exited;
      clearTimeout(deadline);
      assert.equal(signal, null, stderr);
      assert.equal(code, 0, stderr);
    },
  };
}

test('server entrypoint persists the complete workflow across a graceful restart', { timeout: 30_000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'lost-found-server-'));
  const port = await freePort();
  const baseUrl = `http://127.0.0.1:${port}/api/v1`;
  let server;
  async function request(path, { method = 'GET', body, token } = {}) {
    return fetch(`${baseUrl}${path}`, {
      method,
      headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  }
  try {
    server = await startServer(directory, port);
    assert.equal((await request('/health')).status, 200);
    const credentials = { email: 'workflow@example.com', password: 'a-long-test-password' };
    assert.equal((await request('/auth/register', { method: 'POST', body: { name: 'Sam', ...credentials } })).status, 201);
    const login = await request('/auth/login', { method: 'POST', body: credentials });
    assert.equal(login.status, 200);
    const { token, expiresAt } = await login.json();
    assert.ok(Date.parse(expiresAt) > Date.now() + 110_000);
    assert.ok(Date.parse(expiresAt) <= Date.now() + 120_000);
    const created = await request('/items', { method: 'POST', token, body: {
      type: 'lost', title: 'Blue backpack', description: 'A blue backpack with a red keyring.',
      category: 'Bags', location: 'Library', eventDate: '2024-01-01',
    } });
    assert.equal(created.status, 201);
    const { item } = await created.json();
    const recovered = await request(`/items/${item.id}/recover`, { method: 'PATCH', token });
    assert.equal(recovered.status, 200);
    const expected = await recovered.json();
    await server.stop();
    server = undefined;
    server = await startServer(directory, port);
    assert.deepEqual(await (await request(`/items/${item.id}`)).json(), expected);
    const mine = await request('/items?mine=true', { token });
    assert.equal(mine.status, 200);
    assert.deepEqual((await mine.json()).items, [expected.item]);
    assert.equal((await request('/auth/logout', { method: 'POST', token })).status, 204);
    assert.equal((await request('/auth/me', { token })).status, 401);
  } finally {
    if (server) await server.stop();
    await rm(directory, { recursive: true, force: true });
  }
});

test('server rejects invalid port and session lifetime configuration', () => {
  for (const [key, value] of [
    ['PORT', '0'], ['PORT', '65536'], ['PORT', 'invalid'],
    ['SESSION_TTL_SECONDS', '59'], ['SESSION_TTL_SECONDS', '2592001'], ['SESSION_TTL_SECONDS', 'invalid'],
  ]) {
    const result = spawnSync(process.execPath, [entrypoint], {
      env: { ...process.env, DATABASE_PATH: ':memory:', PORT: '3000', SESSION_TTL_SECONDS: '120', [key]: value },
      encoding: 'utf8', timeout: 5000,
    });
    assert.equal(result.status, 1);
    assert.ok(result.stderr.includes(`${key} must be an integer`));
  }
});
