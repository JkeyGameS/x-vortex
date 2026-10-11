// accountService: reset, delete, snapshots, anonymization, admin safety.
//
// Every store this touches resolves through ACCOUNT_DATA_PATH, so the whole
// suite runs against a temp directory. The real data/users.json, feedback.json
// and blockedUsers.json are never opened -- asserted at the end of the run.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import os from 'os';
import path from 'path';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'account-service-test-'));
process.env.ACCOUNT_DATA_PATH = tmpDir;
process.env.GROUPS_DATA_PATH = path.join(tmpDir, 'groups.json');
process.env.GROUP_STATS_DATA_PATH = path.join(tmpDir, 'groupStats.json');

const account = await import('../src/services/accountService.js');
const userService = await import('../src/services/userService.js');
const config = (await import('../src/config/config.js')).default;

const { SNAPSHOT_DIR, USERS_PATH, GROUPS_PATH, GROUP_STATS_PATH, FEEDBACK_PATH, BLOCKED_PATH } = account.__testing;

const ALICE = '111@lid';
const BOB = '222@lid';

function writeJson(file, value) {
  if (!fs.existsSync(path.dirname(file))) fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2), 'utf8');
}

function readJson(file, fallback = null) {
  if (!fs.existsSync(file)) return fallback;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function snapshotFiles() {
  if (!fs.existsSync(SNAPSHOT_DIR)) return [];
  return fs.readdirSync(SNAPSHOT_DIR).filter((f) => f.endsWith('.json'));
}

/** Seed a user with deliberately non-default data in every resettable field. */
async function seedUser(jid, name) {
  await userService.ensureUserProfile({ jid, name, username: 'uname_' + jid[0] });
  await userService.updateUser(jid, {
    bio: 'a bio',
    language: 'fr',
    profileCompleteness: 80,
    accountType: 'premium',
    level: 42,
    rank: 'gold',
    preferences: {
      notifications: false,
      theme: 'light',
      announcements: false,
      replyStyle: 'friendly',
      privacy: 'nobody',
      tutorialProgress: { profile: true, settings: true },
      messageDisplayMode: 'hybrid',
      typing: { mode: 'on', delayMs: 900 }
    },
    stats: {
      messagesSent: 1234,
      commandsUsed: 99,
      points: 5000,
      commandCounts: { start: 12 },
      lastCommand: 'start',
      lastActive: '2026-01-01T00:00:00.000Z'
    },
    notifyRequests: { statAlerts: true },
    chatReplyHistory: { 'rule-a': ['hello'], 'rule-b': ['hi'] }
  });
}

beforeEach(async () => {
  // userService holds an in-memory Map; reset the world between tests.
  writeJson(USERS_PATH, {});
  writeJson(GROUPS_PATH, {});
  writeJson(GROUP_STATS_PATH, {});
  writeJson(FEEDBACK_PATH, { ratings: [], bugReports: [], suggestions: [] });
  writeJson(BLOCKED_PATH, {});
  for (const f of snapshotFiles()) fs.rmSync(path.join(SNAPSHOT_DIR, f), { force: true });
  // getAllUsers() returns records, not JIDs -- map before deleting or the Map
  // keeps leaking state between tests.
  for (const u of await userService.getAllUsers()) {
    await userService.deleteUserByJid(u.jid);
  }
  assert.strictEqual((await userService.getAllUsers()).length, 0, 'beforeEach must start empty');
});

after(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// 1. resetAccount: identity kept, everything else back to defaults
// ---------------------------------------------------------------------------

test('1. resetAccount keeps jid, language and name', async () => {
  await seedUser(ALICE, 'Alice Original');
  const result = await account.resetAccount(ALICE, { actorJid: 'admin@lid', pushName: 'Alice New' });

  assert.strictEqual(result.success, true, JSON.stringify(result));
  const after = await userService.getUserByJid(ALICE);
  assert.strictEqual(after.jid, ALICE);
  assert.strictEqual(after.language, 'fr', 'language survives a reset');
  assert.strictEqual(after.name, 'Alice New', 'pushName wins over the stored name');
});

test('1b. a reset record has byte-identical keys to a brand new user', async () => {
  await seedUser(ALICE, 'Alice');
  await account.resetAccount(ALICE, { actorJid: 'admin@lid' });

  await userService.ensureUserProfile({ jid: BOB, name: 'Bob' });
  const fresh = await userService.getUserByJid(BOB);
  const reset = await userService.getUserByJid(ALICE);

  assert.deepStrictEqual(
    Object.keys(reset).sort(),
    Object.keys(fresh).sort(),
    'top-level keys diverged from ensureUserProfile'
  );
  assert.deepStrictEqual(
    Object.keys(reset.preferences).sort(),
    Object.keys(fresh.preferences).sort(),
    'preferences keys diverged from ensureUserProfile'
  );
  assert.deepStrictEqual(
    Object.keys(reset.stats).sort(),
    Object.keys(fresh.stats).sort(),
    'stats keys diverged from ensureUserProfile'
  );
  // And the accountService skeleton itself must agree with the real thing.
  const skeleton = userService.defaultUserSkeleton();
  assert.deepStrictEqual(Object.keys(reset).sort(), Object.keys(skeleton).sort());
});

test('1c. resetAccount clears stats, history and preferences', async () => {
  await seedUser(ALICE, 'Alice');
  await account.resetAccount(ALICE, { actorJid: 'admin@lid' });
  const after = await userService.getUserByJid(ALICE);

  assert.strictEqual(after.stats.messagesSent, 0);
  assert.strictEqual(after.stats.commandsUsed, 0);
  assert.strictEqual(after.stats.points, 0);
  assert.deepStrictEqual(after.stats.commandCounts, {});
  assert.strictEqual(after.stats.lastCommand, null);
  assert.strictEqual(after.level, 1);
  assert.strictEqual(after.rank, null);
  assert.strictEqual(after.accountType, 'free');
  assert.strictEqual(after.profileCompleteness, 0);
  assert.strictEqual(after.bio, '');
  assert.strictEqual(after.username, null);

  assert.deepStrictEqual(after.chatReplyHistory, {});
  assert.deepStrictEqual(after.notifyRequests, {});
  assert.strictEqual(after.preferences.theme, 'dark');
  assert.strictEqual(after.preferences.privacy, 'contacts');
  // These two must not come back pinned to a stale personal choice.
  assert.strictEqual(after.preferences.messageDisplayMode, undefined,
    'messageDisplayMode must be back to "use the global default"');
  assert.strictEqual(after.preferences.typing, undefined);
});

test('1d. resetAccount leaves the on-disk users.json consistent', async () => {
  await seedUser(ALICE, 'Alice');
  await account.resetAccount(ALICE, { actorJid: 'admin@lid' });
  const disk = readJson(USERS_PATH);
  assert.ok(disk[ALICE], 'the user must still exist on disk after a reset');
  assert.strictEqual(disk[ALICE].stats.messagesSent, 0);
});

// ---------------------------------------------------------------------------
// 2. Snapshots
// ---------------------------------------------------------------------------

test('2. resetAccount writes a snapshot holding the PRE-reset record', async () => {
  await seedUser(ALICE, 'Alice');
  await account.resetAccount(ALICE, { actorJid: 'admin@lid' });

  const files = snapshotFiles();
  assert.strictEqual(files.length, 1, 'expected exactly one snapshot');
  assert.match(files[0], /^reset-111_lid-/, `unexpected filename: ${files[0]}`);

  const snap = readJson(path.join(SNAPSHOT_DIR, files[0]));
  assert.strictEqual(snap.bio, 'a bio', 'the snapshot must be the old record');
  assert.strictEqual(snap.stats.messagesSent, 1234);
  assert.strictEqual(snap.preferences.theme, 'light');
  assert.strictEqual(snap.language, 'fr');
});

test('2b. deleteAccount snapshots with the "deleted" prefix', async () => {
  await seedUser(ALICE, 'Alice');
  const result = await account.deleteAccount(ALICE, { actorJid: 'admin@lid' });
  assert.strictEqual(result.success, true);
  const files = snapshotFiles();
  assert.strictEqual(files.length, 1);
  assert.match(files[0], /^deleted-111_lid-/);
  assert.strictEqual(readJson(path.join(SNAPSHOT_DIR, files[0])).username, 'uname_1');
});

test('2c. a missing user is refused and writes no snapshot', async () => {
  const result = await account.resetAccount('nobody@lid', { actorJid: 'admin@lid' });
  assert.strictEqual(result.success, false);
  assert.strictEqual(result.error, 'user_not_found');
  assert.strictEqual(snapshotFiles().length, 0);

  const del = await account.deleteAccount('nobody@lid', { actorJid: 'admin@lid' });
  assert.strictEqual(del.success, false);
  assert.strictEqual(del.error, 'user_not_found');
  assert.strictEqual(snapshotFiles().length, 0);
});

test('3. snapshot pruning keeps only the newest retentionCount files', async () => {
  const keep = config.account.snapshotRetentionCount;
  assert.strictEqual(keep, 50);

  // Write more than the cap, oldest first, with explicit mtimes.
  fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });
  const names = [];
  for (let i = 0; i < keep + 7; i++) {
    const name = `reset-111_lid-2026-01-01T00-00-${String(i).padStart(2, '0')}Z.json`;
    const file = path.join(SNAPSHOT_DIR, name);
    fs.writeFileSync(file, '{}', 'utf8');
    const t = new Date(Date.UTC(2026, 0, 1, 0, 0, i));
    fs.utimesSync(file, t, t);
    names.push({ name, t: t.getTime() });
  }
  assert.strictEqual(snapshotFiles().length, keep + 7);

  // A real reset triggers pruning.
  await seedUser(ALICE, 'Alice');
  await account.resetAccount(ALICE, { actorJid: 'admin@lid' });

  const left = snapshotFiles();
  assert.strictEqual(left.length, keep, `pruning should leave ${keep} files, left ${left.length}`);

  // The 7 oldest synthetic ones must be the ones that went.
  const oldest = names.slice(0, 7).map((n) => n.name);
  for (const gone of oldest) {
    assert.ok(!left.includes(gone), `${gone} should have been pruned`);
  }
  const newest = names.slice(-1)[0].name;
  assert.ok(left.includes(newest), 'the newest snapshot must survive');
});

// ---------------------------------------------------------------------------
// 4. deleteAccount
// ---------------------------------------------------------------------------

test('4. deleteAccount removes the user from the map and from disk', async () => {
  await seedUser(ALICE, 'Alice');
  await seedUser(BOB, 'Bob');
  await account.deleteAccount(ALICE, { actorJid: 'admin@lid' });

  assert.strictEqual(await userService.getUserByJid(ALICE), undefined);
  assert.ok(await userService.getUserByJid(BOB), 'other users must be untouched');
  assert.strictEqual(readJson(USERS_PATH)[ALICE], undefined);
  assert.ok(readJson(USERS_PATH)[BOB]);
});

test('5. deleteAccount anonymizes feedback instead of deleting it', async () => {
  await seedUser(ALICE, 'Alice');
  writeJson(FEEDBACK_PATH, {
    ratings: [
      { id: 'r1', userId: ALICE, rating: 5, comment: 'great', anonymous: false },
      { id: 'r2', userId: BOB, rating: 3, comment: 'ok', anonymous: false }
    ],
    bugReports: [{ id: 'b1', userId: ALICE, category: 'menu', description: 'x' }],
    suggestions: []
  });

  const result = await account.deleteAccount(ALICE, { actorJid: 'admin@lid' });
  assert.strictEqual(result.anonymized, 2, 'one rating and one bug report');

  const fb = readJson(FEEDBACK_PATH);
  assert.strictEqual(fb.ratings.length, 2, 'feedback entries are kept, not deleted');
  assert.strictEqual(fb.ratings[0].userId, null);
  assert.strictEqual(fb.ratings[0].anonymous, true);
  assert.strictEqual(fb.ratings[0].comment, 'great', 'the content itself is preserved');
  assert.strictEqual(fb.ratings[1].userId, BOB, 'other users must be untouched');
  assert.strictEqual(fb.bugReports[0].userId, null);
});

test('6. deleteAccount removes the JID from blockedUsers.json', async () => {
  await seedUser(ALICE, 'Alice');
  writeJson(BLOCKED_PATH, {
    [ALICE]: { jid: ALICE, reason: 'spam', timestamp: '2026-01-01T00:00:00.000Z' },
    [BOB]: { jid: BOB, reason: 'spam', timestamp: '2026-01-01T00:00:00.000Z' }
  });

  await account.deleteAccount(ALICE, { actorJid: 'admin@lid' });
  const blocked = readJson(BLOCKED_PATH);
  assert.strictEqual(blocked[ALICE], undefined);
  assert.ok(blocked[BOB], 'other blocks must survive');
});

test('6b. removeFromIgnoreList also handles the legacy array shape', async () => {
  await seedUser(ALICE, 'Alice');
  writeJson(BLOCKED_PATH, [ALICE, BOB]);
  await account.deleteAccount(ALICE, { actorJid: 'admin@lid' });
  assert.deepStrictEqual(readJson(BLOCKED_PATH), [BOB]);
});

test('7. deleteAccount clears moderation entries across all groups', async () => {
  await seedUser(ALICE, 'Alice');
  writeJson(GROUPS_PATH, {
    'g1@g.us': {
      enabled: true,
      moderation: {
        warnings: { [ALICE]: { count: 2, reasons: [] }, [BOB]: { count: 1, reasons: [] } },
        mutes: { [ALICE]: { until: 1, reason: 'x', durationMs: 1 } },
        bans: { [ALICE]: { reason: 'y', bannedAt: 'z' } }
      }
    },
    'g2@g.us': {
      enabled: true,
      moderation: { warnings: { [ALICE]: { count: 1, reasons: [] } }, mutes: {}, bans: {} }
    },
    'g3@g.us': { enabled: true }
  });

  await account.deleteAccount(ALICE, { actorJid: 'admin@lid' });
  const groups = readJson(GROUPS_PATH);
  assert.strictEqual(groups['g1@g.us'].moderation.warnings[ALICE], undefined);
  assert.strictEqual(groups['g1@g.us'].moderation.mutes[ALICE], undefined);
  assert.strictEqual(groups['g1@g.us'].moderation.bans[ALICE], undefined);
  assert.strictEqual(groups['g2@g.us'].moderation.warnings[ALICE], undefined);
  assert.ok(groups['g1@g.us'].moderation.warnings[BOB], 'other users must survive');
  assert.strictEqual(groups['g3@g.us'].enabled, true, 'groups without moderation are left alone');
});

test('7b. reset also clears moderation entries', async () => {
  await seedUser(ALICE, 'Alice');
  writeJson(GROUPS_PATH, {
    'g1@g.us': { enabled: true, moderation: { warnings: { [ALICE]: { count: 3 } }, mutes: {}, bans: {} } }
  });
  await account.resetAccount(ALICE, { actorJid: 'admin@lid' });
  assert.strictEqual(readJson(GROUPS_PATH)['g1@g.us'].moderation.warnings[ALICE], undefined);
});

test('7c. delete clears topMembers in groupStats.json', async () => {
  await seedUser(ALICE, 'Alice');
  writeJson(GROUP_STATS_PATH, {
    'g1@g.us': { topMembers: { [ALICE]: { messages: 100 }, [BOB]: { messages: 50 } } },
    'g2@g.us': { topMembers: { [ALICE]: { messages: 10 } } }
  });
  await account.deleteAccount(ALICE, { actorJid: 'admin@lid' });
  const stats = readJson(GROUP_STATS_PATH);
  assert.strictEqual(stats['g1@g.us'].topMembers[ALICE], undefined);
  assert.strictEqual(stats['g2@g.us'].topMembers[ALICE], undefined);
  assert.ok(stats['g1@g.us'].topMembers[BOB]);
});

// ---------------------------------------------------------------------------
// 8. Last-admin protection
// ---------------------------------------------------------------------------

test('8. isLastBotAdmin is true only for the sole admin', async () => {
  const admins = config.adminJids;
  assert.ok(Array.isArray(admins) && admins.length >= 1);

  if (admins.length === 1) {
    assert.strictEqual(account.isLastBotAdmin(admins[0]), true);
    assert.strictEqual(account.isLastBotAdmin('someone-else@lid'), false);
  } else {
    // With several admins nobody is "the last" one.
    for (const jid of admins) assert.strictEqual(account.isLastBotAdmin(jid), false);
  }
  assert.strictEqual(account.isLastBotAdmin(undefined), false);
});

// ---------------------------------------------------------------------------
// 9. Snapshot listing / purge
// ---------------------------------------------------------------------------

test('9. listUserSnapshots returns newest first and purge clears them', async () => {
  await seedUser(ALICE, 'Alice');
  await account.resetAccount(ALICE, { actorJid: 'admin@lid' });
  await account.deleteAccount(ALICE, { actorJid: 'admin@lid' });
  // Re-seed so the second call has a user to snapshot.
  await seedUser(ALICE, 'Alice');
  await account.resetAccount(ALICE, { actorJid: 'admin@lid' });

  const list = account.listUserSnapshots();
  assert.strictEqual(list.length, 3);
  const times = list.map((name) => name.split('-').pop());
  assert.ok(times[0] >= times[1], 'list must be newest first');

  const removed = account.purgeUserSnapshots();
  assert.strictEqual(removed, 3);
  assert.strictEqual(account.listUserSnapshots().length, 0);
});

test('10. purge is safe on an empty or missing snapshot dir', () => {
  for (const f of snapshotFiles()) fs.rmSync(path.join(SNAPSHOT_DIR, f), { force: true });
  assert.strictEqual(account.purgeUserSnapshots(), 0);
  assert.doesNotThrow(() => account.purgeUserSnapshots());
});

// ---------------------------------------------------------------------------
// 11. Isolation: the real stores must never be touched
// ---------------------------------------------------------------------------

test('11. ACCOUNT_DATA_PATH is what all three services read', async () => {
  const real = path.resolve('data');
  for (const file of [USERS_PATH, FEEDBACK_PATH, BLOCKED_PATH, GROUPS_PATH, GROUP_STATS_PATH]) {
    assert.ok(
      path.resolve(file).startsWith(path.resolve(tmpDir) + path.sep),
      `${file} escaped the temp dir`
    );
    assert.ok(!path.resolve(file).startsWith(path.resolve(real) + path.sep),
      `${file} points at the live data/ folder`);
  }
  assert.ok(path.resolve(SNAPSHOT_DIR).startsWith(path.resolve(tmpDir) + path.sep));
});