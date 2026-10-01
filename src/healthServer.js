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
import QRCode from 'qrcode';
import logger from './utils/logger.js';
import { getQR, getQRGeneratedAt } from './utils/qrState.js';

const startedAt = Date.now();

// PaaS platforms also probe /healthz; serve it from the same handler.
const HEALTH_PATHS = new Set(['/', '/health', '/healthz']);
const QR_PNG_PATH = '/qr.png';
const QR_PAGE_PATH = '/qr/page';

function payload() {
  return {
    status: 'ok',
    // Seconds since this process started.
    uptime: Math.floor((Date.now() - startedAt) / 1000)
  };
}

function json(res, status, body, extraHeaders = {}) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'no-store',
    ...extraHeaders
  });
  res.end(payload);
}

/** The QR payload as a PNG, or null when Baileys has not produced one yet. */
async function qrPng() {
  const qr = getQR();
  // Logged (truncated) so a PaaS log shows whether state was ever populated.
  logger.info({ hasQR: Boolean(qr), qrHead: qr ? String(qr).slice(0, 32) : null }, '[QR] /qr.png requested');
  if (!qr) {
    logger.info('[QR] no QR in state (bot paired, or QR expired/cleared)');
    return null;
  }
  try {
    const png = await QRCode.toBuffer(qr, {
      type: 'png',
      width: 400,
      margin: 2,
      errorCorrectionLevel: 'M'
    });
    logger.info({ bytes: png.length }, '[QR] served PNG');
    return png;
  } catch (err) {
    logger.error({ err }, '[QR] PNG generation failed');
    return null;
  }
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

const PAGE_STYLE = `
  body { font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
         background: #11151c; color: #e8ecf1; display: flex; flex-direction: column;
         align-items: center; justify-content: center; min-height: 100vh; margin: 0; }
  h1 { font-size: 1.25rem; margin: 1.5rem 0 0.25rem; text-align: center; }
  img { background: #fff; padding: 12px; border-radius: 8px; margin-top: 1rem;
        width: 400px; height: 400px; }
  .meta { color: #8b95a5; font-size: 0.8rem; margin-top: 0.75rem; }
  .note { color: #8b95a5; font-size: 0.85rem; text-align: center; max-width: 38ch; margin-top: 1rem; }
  .card { background: #1c222c; border: 1px solid #2b3441; border-radius: 10px;
          padding: 1.5rem 2rem; margin-top: 1rem; text-align: center; max-width: 38ch; }
  .card p { margin: 0.5rem 0; line-height: 1.5; }
  .state { font-weight: 600; color: #ffd166; }
  code { background: #0d1117; padding: 2px 5px; border-radius: 4px; }
`;

function qrPageHtml() {
  const qr = getQR();
  const generatedAt = getQRGeneratedAt();

  // No QR right now means either "already paired" or "this QR expired".
  // Rendering an <img> anyway is what produced the broken-image report, so this
  // state gets an explicit message and an auto-refresh instead. Baileys emits a
  // new QR within seconds of the bot starting, so refreshing recovers on its own.
  if (!qr) {
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="refresh" content="5">
<title>X-Vortex pairing QR</title>
<style>${PAGE_STYLE}</style>
</head>
<body>
  <h1>X-Vortex pairing QR</h1>
  <div class="card">
    <p class="state">No pairing QR available right now.</p>
    <p>The bot is already connected, or the previous QR has expired.</p>
    <p>If you expected a QR, restart the bot and reload this page &mdash; it
       refreshes every 5 seconds.</p>
  </div>
  <p class="note">To link a device: WhatsApp &rarr; Linked devices &rarr; Link a device.</p>
</body>
</html>`;
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="refresh" content="10">
<title>X-Vortex pairing QR</title>
<style>${PAGE_STYLE}</style>
</head>
<body>
  <h1>X-Vortex pairing QR</h1>
  <img src="/qr.png" alt="WhatsApp pairing QR code">
  <p class="meta">Generated ${escapeHtml(generatedAt)}</p>
  <p class="note">Open WhatsApp &rarr; Linked devices &rarr; Link a device, then scan this.<br>
  This page refreshes automatically because the QR rotates about every 20 seconds.</p>
</body>
</html>`;
}

function handle(req, res) {
  const path = String(req.url || '/').split('?')[0].replace(/\/+$/, '') || '/';

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    json(res, 405, { status: 'error', message: 'method not allowed' }, { Allow: 'GET, HEAD' });
    return;
  }

  if (path === QR_PNG_PATH) {
    qrPng().then((png) => {
      if (!png) {
        // A 404 is the right answer for an image endpoint with nothing to serve.
        json(res, 404, { status: 'error', message: 'no QR available' });
        return;
      }
      res.writeHead(200, {
        'Content-Type': 'image/png',
        'Content-Length': png.length,
        // Always fetch the newest QR: Baileys rotates it roughly every 20s.
        'Cache-Control': 'no-store'
      });
      res.end(req.method === 'HEAD' ? undefined : png);
    }).catch((err) => {
      logger.error({ err }, '[QR] /qr.png failed');
      json(res, 500, { status: 'error', message: 'failed to generate QR' });
    });
    return;
  }

  if (path === QR_PAGE_PATH) {
    const html = qrPageHtml();
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Length': Buffer.byteLength(html),
      'Cache-Control': 'no-store'
    });
    res.end(req.method === 'HEAD' ? undefined : html);
    return;
  }

  if (HEALTH_PATHS.has(path)) {
    json(res, 200, {
      status: 'ok',
      // Seconds since this process started.
      uptime: Math.floor((Date.now() - startedAt) / 1000)
    });
    return;
  }

  json(res, 404, { status: 'error', message: 'not found' });
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
      logger.info({ port: address?.port ?? port, paths: [...HEALTH_PATHS, QR_PNG_PATH, QR_PAGE_PATH] }, '[HEALTH] health server listening');
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

export const __testing = { payload, handle, HEALTH_PATHS, QR_PNG_PATH, QR_PAGE_PATH, qrPageHtml };