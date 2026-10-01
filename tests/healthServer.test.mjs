// Health server: liveness endpoint plus the QR-as-PNG routes used for pairing
// on a PaaS platform.
//
// Verifies the response contract, that /qr.png is a real 400px PNG generated
// from the current Baileys payload, that both QR routes are uncached, and that
// the QR disappears once the socket connects.
//
// Binds to port 0 so the OS picks a free port and the test never collides with
// a locally running bot.
import http from 'http';
import { startHealthServer, stopHealthServer, __testing } from '../src/healthServer.js';
import { setQR, clearQR, getQR, getQRGeneratedAt } from '../src/utils/qrState.js';

let fails = 0;
function check(name, cond, extra = '') {
  console.log((cond ? 'PASS' : 'FAIL') + ' ' + name + (extra && !cond ? ' :: ' + String(extra).slice(0, 300) : ''));
  if (!cond) fails++;
}

// Minimal request helper returning status, headers and body.
function request(port, path) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path, method: 'GET' }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({
        status: res.statusCode,
        headers: res.headers,
        body: Buffer.concat(chunks)
      }));
    });
    req.on('error', reject);
    req.end();
  });
}

// Pull width/height out of a PNG IHDR chunk.
function pngSize(buf) {
  if (buf.length < 24) return null;
  if (buf.readUInt32BE(0) !== 0x89504e47) return null;          // \x89PNG magic
  if (buf.toString('ascii', 12, 16) !== 'IHDR') return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

const SAMPLE_QR = '2@WvTj0,example-payload-for-testing,0O1b2c3@4';

let server = null;
let port = 0;
try {
  server = await startHealthServer(0);
  port = server.address().port;
  check('health server binds on an OS-assigned port', port > 0, String(port));

  // --- no QR yet -----------------------------------------------------------
  clearQR();
  let r = await request(port, '/qr.png');
  check('/qr.png is 404 before a QR exists', r.status === 404, String(r.status));
  r = await request(port, '/qr/page');
  check('/qr/page is 200 even with no QR (shows guidance)', r.status === 200, String(r.status));

  // --- health endpoints ----------------------------------------------------
  for (const p of ['/', '/health', '/healthz']) {
    const res = await request(port, p);
    let json = null;
    try { json = JSON.parse(res.body.toString()); } catch { /* reported below */ }
    check(p + ' returns 200 JSON', res.status === 200 && json !== null, res.status + ' ' + res.body.toString().slice(0, 80));
    check(p + ' reports status ok and a numeric uptime', json?.status === 'ok' && typeof json.uptime === 'number', JSON.stringify(json));
  }

  // --- QR present ----------------------------------------------------------
  setQR(SAMPLE_QR);
  check('getQR returns the stored payload', getQR() === SAMPLE_QR);
  check('getQRGeneratedAt is set', typeof getQRGeneratedAt() === 'string' && !Number.isNaN(Date.parse(getQRGeneratedAt())));

  const png = await request(port, '/qr.png');
  check('/qr.png returns 200', png.status === 200, String(png.status));
  check('/qr.png is served as image/png', png.headers['content-type'] === 'image/png', png.headers['content-type']);
  check('/qr.png is uncached', String(png.headers['cache-control']).includes('no-store'), png.headers['cache-control']);
  const size = pngSize(png.body);
  check('/qr.png is a valid PNG', size !== null, 'magic/IHDR mismatch');
  // `width: 400` in the qrcode lib is the total output size, quiet zone included.
  check('/qr.png is the requested size (' + size?.width + 'px)', size?.width === 400 && size?.height === 400, JSON.stringify(size));
  check('/qr.png body is a plausible image', png.body.length > 500, String(png.body.length));

  const page = await request(port, '/qr/page');
  check('/qr/page returns 200 HTML', page.status === 200 && String(page.headers['content-type']).includes('text/html'), page.status + ' ' + page.headers['content-type']);
  check('/qr/page is uncached', String(page.headers['cache-control']).includes('no-store'), page.headers['cache-control']);
  const html = page.body.toString();
  check('/qr/page embeds the image tag', html.includes('<img src="/qr.png"'));
  check('/qr/page shows the generation timestamp', html.includes(getQRGeneratedAt()), 'timestamp missing');

  // --- QR cleared on connect ----------------------------------------------
  clearQR();
  check('clearQR empties the payload', getQR() === null && getQRGeneratedAt() === null);
  const after = await request(port, '/qr.png');
  check('/qr.png is 404 once the QR is cleared', after.status === 404, String(after.status));

  // --- unknown path / method ----------------------------------------------
  const missing = await request(port, '/nope');
  check('unknown path is 404', missing.status === 404, String(missing.status));

  // --- module surface ------------------------------------------------------
  check('exports the QR paths used by index.js', __testing.QR_PNG_PATH === '/qr.png' && __testing.QR_PAGE_PATH === '/qr/page');
} finally {
  await stopHealthServer();
}

console.log(fails === 0 ? 'ALL PASS' : fails + ' FAILURES');
process.exit(fails === 0 ? 0 : 1);