import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';
import { openDatabase } from './database.js';

const port = Number(process.env.PORT ?? 3000);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('PORT must be an integer between 1 and 65535');
}

const sessionTtlSeconds = Number(process.env.SESSION_TTL_SECONDS ?? 604800);
if (!Number.isInteger(sessionTtlSeconds) || sessionTtlSeconds < 60 || sessionTtlSeconds > 2592000) {
  throw new Error('SESSION_TTL_SECONDS must be an integer between 60 and 2592000');
}
const databasePath = process.env.DATABASE_PATH ?? fileURLToPath(new URL('../data/lost-and-found.sqlite', import.meta.url));
const database = openDatabase(databasePath);
const app = createApp({ database, sessionTtlSeconds });
const server = app.listen(port, () => {
  console.log(`Lost and found API listening on port ${port}`);
});
server.once('error', error => {
  console.error('Unable to start API:', error.message);
  database.close();
  process.exitCode = 1;
});

let shuttingDown = false;
function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  // Allow active requests to finish before closing SQLite.
  const deadline = setTimeout(() => process.exit(1), 10_000).unref();
  server.close(error => {
    clearTimeout(deadline);
    database.close();
    process.exitCode = error ? 1 : 0;
  });
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
