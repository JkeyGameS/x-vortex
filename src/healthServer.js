// Minimal HTTP health endpoint for PaaS hosting.
//
// Platforms route liveness/readiness probes to a port via the PORT environment
// variable. This server answers GET / and GET /health with a small JSON body so
// the platform knows the process is up. It deliberately uses Node's built-in
// http module: no extra dependency to install on deploy.
//
// A failure to bind must never take the bot down, so EADDRINUSE and friends are
// logged and swallowed.
import http from 'http';
import logger from './utils/logger.js';

const startedAt = Date.now();

// PaaS platforms also probe /healthz; serve it from the same handler.
const PATHS = new Set(['/', '/health', '/healthz']);

function payload() {
  return {
    status: 'ok',
    // Seconds since this process started.
    uptime: Math.floor((Date.now() - startedAt) / 1000)
  };
}

function handle(req, res) {
  const path = String(req.url || '/').split('?')[0].replace(/\/+$/, '') || '/';

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { 'Content-Type': 'application/json', Allow: 'GET, HEAD' });
    res.end(JSON.stringify({ status: 'error', message: 'method not allowed' }));
    return;
  }

  if (!PATHS.has(path)) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'error', message: 'not found' }));
    return;
  }

  const body = JSON.stringify(payload());
  res.writeHead(200, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store'
  });
  res.end(req.method === 'HEAD' ? undefined : body);
}

let server = null;

/**
 * Start the health server.
 * @param {number|string} [port] defaults to process.env.PORT || 3000
 * @returns {Promise<import('http').Server|null>} null when it could not bind
 */
export function startHealthServer(port = process.env.PORT || 3000) {
  return new Promise((resolve) => {
    if (server) {
      resolve(server);
      return;
    }

    server = http.createServer(handle);
    // Never let a slow/absent probe socket hold the process open.
    server.keepAliveTimeout = 5000;

    server.once('error', (err) => {
      logger.error({ err, port }, '[HEALTH] health server error');
      server = null;
      resolve(null);
    });

    server.listen(port, () => {
      const address = server.address();
      logger.info({ port: address?.port ?? port, paths: [...PATHS] }, '[HEALTH] health server listening');
      resolve(server);
    });
  });
}

/** Stop the health server (used on graceful shutdown). */
export function stopHealthServer() {
  return new Promise((resolve) => {
    if (!server) {
      resolve();
      return;
    }
    const s = server;
    server = null;
    s.close(() => {
      logger.info('[HEALTH] health server stopped');
      resolve();
    });
  });
}

export const __testing = { payload, handle, PATHS };