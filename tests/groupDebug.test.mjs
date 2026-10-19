// Group debug mode: per-admin sessions, throttling, and the line cap.
//
// This is the tool that answers "why did the bot ignore this message?", so the
// properties worth pinning are the ones that keep it from becoming a nuisance:
// it is scoped, self-expiring, throttled, and capped.
import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import path from 'path';
import config from '../src/config/config.js';
import {
  enableDebug,
  disableDebug,
  isDebugActive,
  pushDebug,
  listActiveDebugs,
  __testing
} from '../src/services/groupDebugService.js';

const ADMIN = 'admin@lid';
const OTHER = 'other@lid';
const GROUP = 'g1@g.us';
const GROUP2 = 'g2@g.us';

/** Collects DM bodies so assertions can read what the admin actually received. */
function makeSock() {
  const dms = [];
  return {
    dms,
    sendMessage: async (jid, content) => {
      dms.push({ jid, text: String(content?.text ?? '') });
      return { key: { id: 'k' + dms.length } };
    }
  };
}

/** Wait for the throttle window to open. */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Debug text goes through toSmallCaps, so "limit reached" never appears
// literally. Derived from toSmallCaps itself so it cannot drift.
const { toSmallCaps: sc } = await import('../src/utils/smallCaps.js');
const SMALL_CAPS = new Map([...'abcdefghijklmnopqrstuvwxyz'].map((c) => [sc(c), c]));
const flat = (s) => [...String(s)].map((c) => SMALL_CAPS.get(c) ?? c).join('').toLowerCase();

function reset() {
  for (const admin of [...__testing.sessions.keys()]) disableDebug(admin);
}

beforeEach(() => {
  reset();
});

after(() => {
  reset();
});

// ---------------------------------------------------------------------------
// 1. Session lifecycle
// ---------------------------------------------------------------------------

test('1. an enabled session is active for its group', () => {
  enableDebug(ADMIN, GROUP);
  assert.strictEqual(isDebugActive(ADMIN, GROUP), true);
  assert.strictEqual(listActiveDebugs().length, 1);
});

test('1b. an all-groups session is active for every group', () => {
  enableDebug(ADMIN, null);
  assert.strictEqual(isDebugActive(ADMIN, GROUP), true);
  assert.strictEqual(isDebugActive(ADMIN, GROUP2), true);
});

test('2. a session expires and is cleaned up', async () => {
  const original = config.groupDebug.autoExpireMs;
  config.groupDebug.autoExpireMs = 40;
  try {
    enableDebug(ADMIN, GROUP);
    assert.strictEqual(isDebugActive(ADMIN, GROUP), true);
    await sleep(70);
    assert.strictEqual(isDebugActive(ADMIN, GROUP), false, 'expired session must not be active');
    assert.strictEqual(__testing.sessions.has(ADMIN), false, 'expired session must be removed');
  } finally {
    config.groupDebug.autoExpireMs = original;
  }
});

test('3. a group-scoped session does not fire for another group', () => {
  enableDebug(ADMIN, GROUP);
  assert.strictEqual(isDebugActive(ADMIN, GROUP), true);
  assert.strictEqual(isDebugActive(ADMIN, GROUP2), false);
});

test('5. disableDebug clears the session', () => {
  enableDebug(ADMIN, GROUP);
  disableDebug(ADMIN);
  assert.strictEqual(isDebugActive(ADMIN, GROUP), false);
  assert.deepStrictEqual(listActiveDebugs(), []);
});

test('6. disableDebug is safe for an unknown admin', () => {
  assert.doesNotThrow(() => disableDebug('never-enabled@lid'));
});

// ---------------------------------------------------------------------------
// 4. Throttling and the flush queue
// ---------------------------------------------------------------------------

test('4. rapid pushes coalesce into one queued batch', async () => {
  const original = config.groupDebug.rateLimitMs;
  config.groupDebug.rateLimitMs = 60;
  try {
    const sock = makeSock();
    enableDebug(ADMIN, GROUP);
    // First push goes straight out and opens the window.
    await pushDebug(sock, GROUP, 'line one');
    assert.strictEqual(sock.dms.length, 1);

    // The rest land inside the throttle and must queue, not send.
    await pushDebug(sock, GROUP, 'line two');
    await pushDebug(sock, GROUP, 'line three');
    assert.strictEqual(sock.dms.length, 1, 'throttled lines must not send immediately');

    await sleep(120);
    // dms holds {jid, text} records, so map before joining.
    const flushed = sock.dms.slice(1).map((d) => d.text).join('\n');
    assert.ok(flushed.includes('line two'), 'queued line two was lost');
    assert.ok(flushed.includes('line three'), 'queued line three was lost');
  } finally {
    config.groupDebug.rateLimitMs = original;
  }
});

test('4b. the flush reschedules when lines arrive while it is sending', async () => {
  // The regression this pins: without the reschedule in flush(), lines queued
  // after the drain sat in `queued` with no timer and were stranded.
  const original = config.groupDebug.rateLimitMs;
  config.groupDebug.rateLimitMs = 50;
  try {
    const sock = makeSock();
    enableDebug(ADMIN, GROUP);
    await pushDebug(sock, GROUP, 'first');
    await pushDebug(sock, GROUP, 'queued-a');

    await sleep(90);                       // let the first flush fire
    const afterFirst = sock.dms.length;
    assert.ok(afterFirst >= 2, 'first batch never flushed');

    // Land more lines just as a new window opens; they must still go out.
    await pushDebug(sock, GROUP, 'queued-b');
    await pushDebug(sock, GROUP, 'queued-c');
    await sleep(120);

    const all = sock.dms.map((d) => d.text).join('\n');
    assert.ok(all.includes('queued-a'), 'queued-a lost');
    assert.ok(all.includes('queued-b'), 'queued-b lost -- the queue was stranded');
    assert.ok(all.includes('queued-c'), 'queued-c lost -- the queue was stranded');
  } finally {
    config.groupDebug.rateLimitMs = original;
  }
});

test('4c. the throttle is per admin, not global', async () => {
  const original = config.groupDebug.rateLimitMs;
  config.groupDebug.rateLimitMs = 5000;
  try {
    const sock = makeSock();
    enableDebug(ADMIN, GROUP);
    enableDebug(OTHER, GROUP);
    await pushDebug(sock, GROUP, 'shared line');
    const recipients = sock.dms.map((d) => d.jid).sort();
    assert.deepStrictEqual(recipients, [ADMIN, OTHER].sort(),
      'a second admin must not starve the first through a shared window');
  } finally {
    config.groupDebug.rateLimitMs = original;
  }
});

test('4d. a group-scoped session receives nothing from another group', async () => {
  const sock = makeSock();
  enableDebug(ADMIN, GROUP);
  await pushDebug(sock, GROUP2, 'wrong group');
  assert.strictEqual(sock.dms.length, 0, 'debug leaked across groups');
  await pushDebug(sock, GROUP, 'right group');
  assert.strictEqual(sock.dms.length, 1);
});

// ---------------------------------------------------------------------------
// 4e. Line cap
// ---------------------------------------------------------------------------

test('4e. the session stops emitting at maxLinesPerSession and says so', async () => {
  const original = config.groupDebug.rateLimitMs;
  const originalMax = config.groupDebug.maxLinesPerSession;
  config.groupDebug.rateLimitMs = 0;                 // send every line immediately
  config.groupDebug.maxLinesPerSession = 3;
  try {
    const sock = makeSock();
    enableDebug(ADMIN, GROUP);
    for (let i = 0; i < 10; i++) await pushDebug(sock, GROUP, 'line ' + i);

    const emitted = sock.dms.filter((d) => /^line /.test(d.text));
    assert.strictEqual(emitted.length, 3, 'must stop at the cap, sent ' + emitted.length);

    const tail = sock.dms.find((d) => flat(d.text).includes('limit reached'));
    assert.ok(tail, 'a limit-reached notice must be sent');
    assert.ok(flat(tail.text).includes('lines suppressed'), flat(tail.text));
    assert.ok(flat(tail.text).includes('/debug on'), 'the notice must say how to start over');

    // The session is gone, so nothing more is ever sent.
    const before = sock.dms.length;
    await pushDebug(sock, GROUP, 'after the cap');
    assert.strictEqual(sock.dms.length, before, 'session must be torn down after the cap');
  } finally {
    config.groupDebug.rateLimitMs = original;
    config.groupDebug.maxLinesPerSession = originalMax;
  }
});

test('4f. /debug on resets the line count', async () => {
  const original = config.groupDebug.rateLimitMs;
  const originalMax = config.groupDebug.maxLinesPerSession;
  config.groupDebug.rateLimitMs = 0;
  config.groupDebug.maxLinesPerSession = 2;
  try {
    const sock = makeSock();
    enableDebug(ADMIN, GROUP);
    await pushDebug(sock, GROUP, 'a');
    await pushDebug(sock, GROUP, 'b');
    // The cap fires on the next push, not the one that reaches it, so the
    // session is still present here and emits nothing further.
    assert.strictEqual(sock.dms.length, 2, 'no line may be emitted past the cap');
    assert.strictEqual(__testing.sessions.get(ADMIN).lineCount, 2);
    await pushDebug(sock, GROUP, 'c');                       // trips the cap
    assert.strictEqual(__testing.sessions.get(ADMIN), undefined, 'session must be torn down');
    assert.ok(sock.dms.some((d) => flat(d.text).includes('limit reached')),
      'the limit notice must be sent');

    enableDebug(ADMIN, GROUP);                       // /debug on again
    sock.dms.length = 0;
    await pushDebug(sock, GROUP, 'c');
    assert.strictEqual(sock.dms.length, 1, 'a fresh session must emit again');
  } finally {
    config.groupDebug.rateLimitMs = original;
    config.groupDebug.maxLinesPerSession = originalMax;
  }
});

test('4g. the shipped default cap is 100 lines', () => {
  assert.strictEqual(config.groupDebug.maxLinesPerSession, 100);
  assert.strictEqual(config.groupDebug.autoExpireMs, 10 * 60 * 1000);
  assert.strictEqual(config.groupDebug.rateLimitMs, 2000);
});

// ---------------------------------------------------------------------------
// 5. The command surface
// ---------------------------------------------------------------------------

test('5. /debug is registered, admin-only and DM-only', async () => {
  const { command } = await import('../src/handlers/debugCommand.js');
  assert.strictEqual(command.name, 'debug');
  assert.strictEqual(command.adminOnly, true, 'must not be user-reachable');
  assert.strictEqual(command.groupAllowed, false, 'must be DM-only');

  const { menuCommands } = await import('../src/config/menuConfig.js');
  assert.strictEqual(menuCommands.debug.adminOnly, true,
    'the central registry must keep /debug admin-only');
  assert.strictEqual(menuCommands.gd.adminOnly, true, 'the /gd alias must be covered too');
});

test('5b. the loader picks up the command and its alias', async () => {
  const { loadCommands } = await import('../src/handlers/commandHandler.js');
  const commands = await loadCommands();
  const debug = commands.get('debug');
  assert.ok(debug, '/debug not registered');
  assert.strictEqual(debug.adminOnly, true);
  const alias = commands.get('gd');
  assert.ok(alias, '/gd alias not registered');
  assert.strictEqual(alias.name, 'debug');
});

test('5c. debug is a no-op with no active session', async () => {
  const sock = makeSock();
  await pushDebug(sock, GROUP, 'nobody is listening');
  assert.strictEqual(sock.dms.length, 0);
});

test('6. handler emissions exist and chat rules are reported as unimplemented', () => {
  const src = fs.readFileSync(path.resolve('src/handlers/groupMessageHandler.js'), 'utf8');
  assert.ok(src.includes('pushDebug'), 'handler does not push debug lines');
  assert.ok(src.includes('debugLine('), 'handler has no debug header helper');
  // The specific diagnostic this whole feature was built for.
  assert.ok(/chat rules/i.test(src), 'no chat-rules emission');
  assert.ok(/not implemented/i.test(src),
    'chat rules must be reported as not implemented so the silence is explained');
  // Terminal logging must survive: debug is additive.
  assert.ok(src.includes('[GROUP] message ignored (Phase 1)'),
    'the terminal logger call was removed');
  assert.ok(src.includes('[GROUP] not activated, ignored'));
});