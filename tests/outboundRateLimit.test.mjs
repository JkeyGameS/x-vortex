// Outbound rate limiter -- safety net against host/WhatsApp spam flags.
//
// Runs on Node's built-in test runner (no new dependency). Registered as the
// 16th link in the package.json "test" chain so the 15 existing bespoke
// suites keep running.
import { test } from 'node:test';
import assert from 'node:assert';
import config from '../src/config/config.js';
import {
  checkOutbound,
  getOutboundRateLimitStats,
  resetOutboundRateLimit,
  recordBlock,
  getRecentBlocks
} from '../src/services/outboundRateLimitService.js';

const PER_CHAT = config.rateLimit.perChatPerMinute;
const GLOBAL = config.rateLimit.globalPerMinute;

test('config block exists with the documented shape', () => {
  assert.ok(config.rateLimit, 'config.rateLimit missing');
  assert.strictEqual(typeof config.rateLimit.enabled, 'boolean');
  assert.strictEqual(typeof config.rateLimit.windowMs, 'number');
  assert.strictEqual(typeof config.rateLimit.perChatPerMinute, 'number');
  assert.strictEqual(typeof config.rateLimit.globalPerMinute, 'number');
  assert.strictEqual(typeof config.rateLimit.adminWarnThreshold, 'number');
});

test('allows up to the per-chat limit', () => {
  resetOutboundRateLimit();
  for (let i = 0; i < PER_CHAT; i++) {
    assert.strictEqual(checkOutbound('userA').allowed, true, `send ${i + 1} should pass`);
  }
});

test('blocks after the per-chat limit', () => {
  resetOutboundRateLimit();
  for (let i = 0; i < PER_CHAT; i++) checkOutbound('userA');
  const res = checkOutbound('userA');
  assert.strictEqual(res.allowed, false);
  assert.strictEqual(res.reason, 'per_chat_limit');
});

test('different chats have independent per-chat windows', () => {
  resetOutboundRateLimit();
  for (let i = 0; i < PER_CHAT; i++) checkOutbound('userA');
  assert.strictEqual(checkOutbound('userB').allowed, true);
});

test('a blocked send does not consume a slot', () => {
  resetOutboundRateLimit();
  for (let i = 0; i < PER_CHAT; i++) checkOutbound('userA');
  const before = getOutboundRateLimitStats();
  for (let i = 0; i < 5; i++) checkOutbound('userA');
  const after = getOutboundRateLimitStats();
  assert.strictEqual(after.globalCount, before.globalCount,
    'retries by a blocked caller must not deepen the penalty');
  assert.strictEqual(after.chats.userA, before.chats.userA);
});

test('global limit blocks across chats', () => {
  resetOutboundRateLimit();
  // Fill the global budget using distinct chats so no per-chat cap is hit.
  let sent = 0;
  for (let i = 0; sent < GLOBAL && i < 1000; i++) {
    if (checkOutbound('bulk' + i).allowed) sent++;
  }
  assert.strictEqual(sent, GLOBAL, 'exactly the global budget should pass');
  const res = checkOutbound('anyone');
  assert.strictEqual(res.allowed, false);
  assert.strictEqual(res.reason, 'global_limit');
});

test('stats reflect current counts', () => {
  resetOutboundRateLimit();
  checkOutbound('userA');
  checkOutbound('userA');
  const stats = getOutboundRateLimitStats();
  assert.strictEqual(stats.chats.userA, 2);
  assert.strictEqual(stats.globalCount, 2);
});

test('stats expose the active limits for diagnostics', () => {
  const stats = getOutboundRateLimitStats();
  assert.strictEqual(stats.limits.perChatPerMinute, PER_CHAT);
  assert.strictEqual(stats.limits.globalPerMinute, GLOBAL);
});

test('a disabled limiter always allows', () => {
  resetOutboundRateLimit();
  const original = config.rateLimit.enabled;
  config.rateLimit.enabled = false;
  try {
    for (let i = 0; i < PER_CHAT + 50; i++) {
      assert.strictEqual(checkOutbound('userA').allowed, true);
    }
  } finally {
    config.rateLimit.enabled = original;
  }
});

test('windows expire so sends resume without a restart', async () => {
  resetOutboundRateLimit();
  const originalWindow = config.rateLimit.windowMs;
  // 40ms window keeps the test fast while still exercising the prune path.
  config.rateLimit.windowMs = 40;
  try {
    for (let i = 0; i < PER_CHAT; i++) checkOutbound('userA');
    assert.strictEqual(checkOutbound('userA').allowed, false);
    await new Promise((r) => setTimeout(r, 70));
    assert.strictEqual(checkOutbound('userA').allowed, true,
      'sends must resume once the window slides');
  } finally {
    config.rateLimit.windowMs = originalWindow;
    resetOutboundRateLimit();
  }
});

test('recordBlock stays quiet below the admin warn threshold', () => {
  resetOutboundRateLimit();
  const threshold = config.rateLimit.adminWarnThreshold;
  for (let i = 0; i < threshold - 1; i++) {
    assert.strictEqual(recordBlock('per_chat_limit').shouldWarn, false, `block ${i + 1}`);
  }
});

test('recordBlock warns once the threshold is reached', () => {
  resetOutboundRateLimit();
  const threshold = config.rateLimit.adminWarnThreshold;
  let warned = null;
  for (let i = 0; i < threshold; i++) {
    const r = recordBlock('global_limit');
    if (r.shouldWarn) warned = r;
  }
  assert.ok(warned, 'expected a warning at the threshold');
  assert.ok(warned.count >= threshold);
});

test('repeated blocks do not re-warn inside the cooldown', () => {
  resetOutboundRateLimit();
  const threshold = config.rateLimit.adminWarnThreshold;
  let warnCount = 0;
  for (let i = 0; i < threshold * 4; i++) {
    if (recordBlock('global_limit').shouldWarn) warnCount++;
  }
  assert.strictEqual(warnCount, 1,
    'a sustained flood must produce exactly one admin warning');
});

test('recent blocks are recorded with their reason', () => {
  resetOutboundRateLimit();
  recordBlock('per_chat_limit');
  recordBlock('global_limit');
  const blocks = getRecentBlocks();
  assert.strictEqual(blocks.length, 2);
  assert.strictEqual(blocks[0].reason, 'per_chat_limit');
  assert.strictEqual(blocks[1].reason, 'global_limit');
});

test('reset clears every window', () => {
  for (let i = 0; i < PER_CHAT; i++) checkOutbound('userA');
  resetOutboundRateLimit();
  const stats = getOutboundRateLimitStats();
  assert.strictEqual(stats.globalCount, 0);
  assert.deepStrictEqual(stats.chats, {});
  assert.strictEqual(getRecentBlocks().length, 0);
  assert.strictEqual(checkOutbound('userA').allowed, true);
});