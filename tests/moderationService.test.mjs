// Moderation state (Phase 4): warnings, mutes, bans.
//
// Isolated via GROUP_DATA_PATH / GROUP_DEFAULTS_DATA_PATH. No messages are sent
// and no socket is involved: this suite covers the service only.
import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import os from 'os';
import path from 'path';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'moderation-test-'));
const groupsFile = path.join(tmpDir, 'groups.json');
const defaultsFile = path.join(tmpDir, 'groupDefaults.json');
process.env.GROUP_DATA_PATH = groupsFile;
process.env.GROUP_DEFAULTS_DATA_PATH = defaultsFile;

const groups = await import('../src/services/groupService.js');
const mod = await import('../src/services/moderationService.js');
const { humanizeDuration } = await import('../src/utils/humanizeDuration.js');

const G = '111111111111@group.g.us';
const U = '000000000001@lid';
const V = '000000000002@lid';

beforeEach(() => {
  fs.writeFileSync(groupsFile, '{}', 'utf8');
  fs.writeFileSync(defaultsFile, JSON.stringify(groups.defaultGroupSettings(), null, 2), 'utf8');
  groups.reload();
  groups.loadGroupDefaults();
  groups.activateGroup(G, { name: 'Dev Team', activatedBy: 'admin@lid' });
});

after(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('a fresh group starts with an empty moderation block', () => {
  const log = mod.getModerationLog(G);
  assert.ok(log);
  assert.deepStrictEqual(log.warnings, {});
  assert.deepStrictEqual(log.mutes, {});
  assert.deepStrictEqual(log.bans, {});
});

test('addWarning increments the count and preserves reasons', () => {
  const r1 = mod.addWarning(G, U, 'spam');
  assert.strictEqual(r1.count, 1);
  const r2 = mod.addWarning(G, U, 'link posting');
  assert.strictEqual(r2.count, 2);
  const reasons = mod.getWarnings(G, U);
  assert.strictEqual(reasons.length, 2);
  assert.strictEqual(reasons[0].reason, 'spam');
  assert.strictEqual(reasons[1].reason, 'link posting');
  assert.ok(reasons[0].at, 'each reason is timestamped');
  assert.strictEqual(mod.getActiveWarningCount(G, U), 2);
});

test('warnings are kept per user', () => {
  mod.addWarning(G, U, 'a');
  mod.addWarning(G, V, 'b');
  mod.addWarning(G, V, 'c');
  assert.strictEqual(mod.getActiveWarningCount(G, U), 1);
  assert.strictEqual(mod.getActiveWarningCount(G, V), 2);
});

test('a warning with no reason still records something', () => {
  const r = mod.addWarning(G, U);
  assert.strictEqual(r.count, 1);
  assert.strictEqual(mod.getWarnings(G, U)[0].reason, 'no reason given');
});

test('removeLastWarning decrements and keeps the rest', () => {
  mod.addWarning(G, U, 'one');
  mod.addWarning(G, U, 'two');
  const res = mod.removeLastWarning(G, U);
  assert.strictEqual(res.removed, 1);
  assert.strictEqual(res.count, 1, 'count reflects what is left');
  assert.strictEqual(mod.getActiveWarningCount(G, U), 1);
  assert.strictEqual(mod.getWarnings(G, U)[0].reason, 'one', 'the older one survives');
});

test('removeLastWarning deletes the entry when it reaches zero', () => {
  mod.addWarning(G, U, 'only');
  const res = mod.removeLastWarning(G, U);
  assert.deepStrictEqual(res, { removed: 1, count: 0 });
  assert.strictEqual(mod.getActiveWarningCount(G, U), 0);
  const log = mod.getModerationLog(G);
  assert.ok(!(U in log.warnings), 'entry is gone, not left as an empty object');
});

test('removeLastWarning on a user with no warnings is a no-op', () => {
  assert.deepStrictEqual(mod.removeLastWarning(G, U), { removed: 0, count: 0 });
});

test('muteUser caps the duration at maxMuteDurationMs', () => {
  const cap = 7 * 24 * 60 * 60 * 1000;
  const res = mod.muteUser(G, U, cap * 10, 'too long');
  assert.strictEqual(res.durationMs, cap);
  assert.strictEqual(res.capped, true);
  assert.strictEqual(mod.isMuted(G, U), true);
});

test('muteUser accepts a shorter duration uncapped', () => {
  const res = mod.muteUser(G, U, 5 * 60 * 1000, 'short');
  assert.strictEqual(res.durationMs, 5 * 60 * 1000);
  assert.strictEqual(res.capped, false);
});

test('isMuted returns false once the until timestamp has passed', () => {
  mod.muteUser(G, U, 60_000, 'quick');
  // Rewrite the stored mute as already expired rather than waiting.
  const g = groups.getGroup(G);
  g.moderation.mutes[U].until = Date.now() - 1000;
  groups.updateGroup(G, { moderation: g.moderation });
  assert.strictEqual(mod.isMuted(G, U), false);
  // And the expired entry is cleaned up on the way out.
  assert.ok(!(U in mod.getModerationLog(G).mutes), 'expired mute removed');
});

test('unmuteUser clears a live mute', () => {
  mod.muteUser(G, U, 60_000, 'x');
  const res = mod.unmuteUser(G, U);
  assert.strictEqual(res.removed, true);
  assert.strictEqual(mod.isMuted(G, U), false);
});

test('unmuteUser on a user who is not muted reports removed false', () => {
  assert.strictEqual(mod.unmuteUser(G, U).removed, false);
});

test('banUser and isBanned', () => {
  assert.strictEqual(mod.banUser(G, U, 'abuse'), true);
  assert.strictEqual(mod.isBanned(G, U), true);
  assert.strictEqual(mod.getModerationLog(G).bans[U].reason, 'abuse');
});

test('ban does not remove the user from the group', () => {
  mod.banUser(G, U, 'abuse');
  // A ban is bot-side state only: the group entry is untouched.
  assert.strictEqual(groups.getGroup(G).enabled, true);
  assert.strictEqual(groups.getGroup(G).id, G);
});

test('unbanUser clears the ban', () => {
  mod.banUser(G, U, 'abuse');
  const res = mod.unbanUser(G, U);
  assert.strictEqual(res.removed, true);
  assert.strictEqual(mod.isBanned(G, U), false);
});

test('unbanUser on a user who is not banned reports removed false', () => {
  assert.strictEqual(mod.unbanUser(G, U).removed, false);
});

test('warnings older than warnExpiryMs are pruned', () => {
  // Inject a backdated warning rather than waiting 90 days.
  const g = groups.getGroup(G);
  const old = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000).toISOString();
  g.moderation.warnings[U] = {
    count: 2,
    reasons: [{ reason: 'ancient', at: old }, { reason: 'recent', at: new Date().toISOString() }]
  };
  groups.updateGroup(G, { moderation: g.moderation });

  assert.strictEqual(mod.getActiveWarningCount(G, U), 1, 'only the recent one counts');
  assert.deepStrictEqual(
    mod.getWarnings(G, U).map((r) => r.reason),
    ['recent']
  );
});

test('a fully expired warning entry is deleted and the delete persists', () => {
  const g = groups.getGroup(G);
  const old = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000).toISOString();
  g.moderation.warnings[U] = { count: 1, reasons: [{ reason: 'ancient', at: old }] };
  groups.updateGroup(G, { moderation: g.moderation });

  assert.strictEqual(mod.getActiveWarningCount(G, U), 0);
  // Re-read from disk: without persistence the stale entry would come back.
  groups.reload();
  assert.strictEqual(mod.getActiveWarningCount(G, U), 0, 'prune survived a reload');
  assert.ok(!(U in mod.getModerationLog(G).warnings));
});

test('getModerationLog returns all three sections', () => {
  mod.addWarning(G, U, 'w');
  mod.muteUser(G, U, 60_000, 'm');
  mod.banUser(G, U, 'b');
  const log = mod.getModerationLog(G);
  assert.ok(log.warnings[U], 'warnings section');
  assert.ok(log.mutes[U], 'mutes section');
  assert.ok(log.bans[U], 'bans section');
});

test('operations on an unknown group return null rather than throwing', () => {
  assert.strictEqual(mod.addWarning('nope@g.us', U, 'x'), null);
  assert.strictEqual(mod.muteUser('nope@g.us', U, 1000, 'x'), null);
  assert.strictEqual(mod.banUser('nope@g.us', U, 'x'), null);
  assert.strictEqual(mod.unmuteUser('nope@g.us', U), null);
  assert.strictEqual(mod.unbanUser('nope@g.us', U), null);
  assert.strictEqual(mod.removeLastWarning('nope@g.us', U), null);
  assert.strictEqual(mod.getModerationLog('nope@g.us'), null);
  assert.strictEqual(mod.isMuted('nope@g.us', U), false);
  assert.strictEqual(mod.isBanned('nope@g.us', U), false);
  assert.strictEqual(mod.getActiveWarningCount('nope@g.us', U), 0);
  assert.deepStrictEqual(mod.getWarnings('nope@g.us', U), []);
});

test('moderation state persists to disk', () => {
  mod.addWarning(G, U, 'persisted');
  mod.banUser(G, U, 'also persisted');
  groups.reload();
  assert.strictEqual(mod.getActiveWarningCount(G, U), 1);
  assert.strictEqual(mod.isBanned(G, U), true);
  const raw = JSON.parse(fs.readFileSync(groupsFile, 'utf8'));
  assert.strictEqual(raw[G].moderation.warnings[U].count, 1);
  assert.ok(raw[G].moderation.bans[U]);
});

test('humanizeDuration renders each unit', () => {
  assert.strictEqual(humanizeDuration(1000), '1 second');
  assert.strictEqual(humanizeDuration(30_000), '30 seconds');
  assert.strictEqual(humanizeDuration(60_000), '1 minute');
  assert.strictEqual(humanizeDuration(30 * 60_000), '30 minutes');
  assert.strictEqual(humanizeDuration(60 * 60_000), '1 hour');
  assert.strictEqual(humanizeDuration(5 * 60 * 60_000), '5 hours');
  assert.strictEqual(humanizeDuration(24 * 60 * 60_000), '1 day');
  assert.strictEqual(humanizeDuration(7 * 24 * 60 * 60_000), '7 days');
});

test('humanizeDuration is safe on bad input', () => {
  assert.strictEqual(humanizeDuration(0), '0 seconds');
  assert.strictEqual(humanizeDuration(-5), '0 seconds');
  assert.strictEqual(humanizeDuration(NaN), '0 seconds');
});
