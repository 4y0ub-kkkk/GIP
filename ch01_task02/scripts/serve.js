import { createServer } from 'node:http';
import { readFile, realpath, stat } from 'node:fs/promises';
import { dirname, extname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.PORT ?? 5173);
const host = '127.0.0.1';

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('PORT must be an integer between 1 and 65535.');
}

const types = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
};

function isWithinRoot(path) {
  const fromRoot = relative(root, path);
  return (
    fromRoot !== '..' && !fromRoot.startsWith('../') && !isAbsolute(fromRoot)
  );
}

function sendText(response, status, message) {
  response.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
  response.end(message);
}

const server = createServer(async (request, response) => {
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Cache-Control', 'no-store');

  if (!['GET', 'HEAD'].includes(request.method)) {
    response.setHeader('Allow', 'GET, HEAD');
    sendText(response, 405, 'Method not allowed');
    return;
  }

  let pathname;
  try {
    pathname = decodeURIComponent(
      new URL(request.url, `http://${host}:${port}`).pathname,
    );
  } catch {
    sendText(response, 400, 'Invalid request path');
    return;
  }

  const segments = pathname.split('/');
  const privateDirectories = ['node_modules', 'scripts', 'test', 'browser'];
  if (
    pathname.includes('\0') ||
    segments.some(
      (segment) =>
        segment.startsWith('.') || privateDirectories.includes(segment),
    )
  ) {
    sendText(response, 404, 'Not found');
    return;
  }

  const requestedFile = resolve(
    root,
    `.${pathname === '/' ? '/index.html' : pathname}`,
  );
  if (!isWithinRoot(requestedFile) || !types[extname(requestedFile)]) {
    sendText(response, 404, 'Not found');
    return;
  }

  try {
    const file = await realpath(requestedFile);
    if (!isWithinRoot(file) || !(await stat(file)).isFile()) {
      sendText(response, 404, 'Not found');
      return;
    }

    const content = await readFile(file);
    response.writeHead(200, {
      'Content-Type': types[extname(requestedFile)],
      'Content-Length': content.length,
    });
    response.end(request.method === 'HEAD' ? undefined : content);
  } catch (error) {
    if (['ENOENT', 'ENOTDIR', 'EACCES', 'ELOOP'].includes(error.code)) {
      sendText(response, 404, 'Not found');
      return;
    }
    console.error('Unable to serve file:', error.message);
    sendText(response, 500, 'Unable to serve file');
  }
});

server.on('error', (error) => {
  console.error(`Unable to start Forma: ${error.message}`);
  process.exitCode = 1;
});

server.listen(port, host, () => {
  console.log(`Forma is available at http://${host}:${port}`);
});
