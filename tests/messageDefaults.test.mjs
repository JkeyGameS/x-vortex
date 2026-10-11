// Global menu/typing defaults: send_new everywhere, typing only for chat replies.
//
// The defaults moved from 'hybrid' (a sentinel that left every transition on
// its own legacy edit/delete behavior) to 'send_new'. This suite pins:
//
//   1. the committed data stores really do say send_new / chat-reply-only,
//   2. resolveMessageMode() turns that into a real display mode,
//   3. the migration actually nulls the user overrides that would shadow it,
//   4. typing targeting gates per message type with the master flag on,
//   5. the "My Groups -> 0" back navigation sends a NEW message, not an edit.
import { test, before, after } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'msg-defaults-test-'));
process.env.GROUP_DATA_PATH = path.join(tmpDir, 'groups.json');
process.env.GROUP_DEFAULTS_DATA_PATH = path.join(tmpDir, 'groupDefaults.json');
process.env.GROUP_STATS_DATA_PATH = path.join(tmpDir, 'groupStats.json');

const ROOT = path.resolve('.');
const msgSvc = await import('../src/services/messageSettingsService.js');
const typingSvc = await import('../src/services/typingSettingsService.js');
const typingResolver = await import('../src/utils/typingResolver.js');

before(async () => {
  // Every menu send goes through one JID here; the outbound cap would otherwise
  // suppress replies and make the assertions meaningless.
  const config = (await import('../src/config/config.js')).default;
  config.rateLimit.enabled = false;
});
after(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// 1. The committed defaults
// ---------------------------------------------------------------------------

test('1. config.js default is send_new', async () => {
  const config = (await import('../src/config/config.js')).default;
  assert.strictEqual(config.messageDisplay.defaultMode, 'send_new');
  assert.strictEqual(config.messageDisplay.allowUserOverride, true);
});

test('1b. messageSettingsService DEFAULTS.defaultMode is send_new', () => {
  assert.strictEqual(msgSvc.DEFAULTS.defaultMode, 'send_new');
});

test('1c. data/messageSettings.json says send_new and the service reads it', async () => {
  const raw = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/messageSettings.json'), 'utf8'));
  assert.strictEqual(raw.defaultMode, 'send_new');
  const runtime = msgSvc.loadSettings();
  assert.strictEqual(runtime.defaultMode, 'send_new',
    'the runtime must read send_new from disk, not fall back to code defaults');
});

test('1d. a fresh menu resolves to send_new with no user preference', () => {
  const settings = msgSvc.getSettings();
  assert.strictEqual(msgSvc.resolveMessageMode(undefined, undefined, settings), 'send_new');
  assert.strictEqual(msgSvc.resolveMessageMode(null, { preferences: {} }, settings), 'send_new');
});

test('1e. send_new means "always a new message" -- never hybrid', () => {
  // 'hybrid' is the sentinel meaning "keep the legacy transition behavior",
  // so resolveMessageMode must never hand it back now that it is not the default.
  const s = { defaultMode: 'send_new', allowUserOverride: true, perMenuOverrideEnabled: true };
  for (const user of [undefined, { preferences: {} }, { preferences: { messageDisplayMode: null } }]) {
    assert.notStrictEqual(msgSvc.resolveMessageMode(null, user, s), null,
      'send_new must be an explicit mode, not "fall back to legacy"');
  }
});

// ---------------------------------------------------------------------------
// 2. User overrides are reset so the global default applies
// ---------------------------------------------------------------------------

test('2. the migration nulls messageDisplayMode and typing overrides', () => {
  const dataDir = path.join(tmpDir, 'migration');
  fs.mkdirSync(dataDir, { recursive: true });
  const usersPath = path.join(dataDir, 'users.json');
  fs.writeFileSync(usersPath, JSON.stringify({
    'a@lid': { name: 'A', preferences: { language: 'en', messageDisplayMode: 'hybrid', typing: { mode: 'on', delayMs: 1000 } } },
    'b@lid': { name: 'B', preferences: { language: 'fr', messageDisplayMode: 'edit' } },
    'c@lid': { name: 'C', preferences: { language: 'de' } }
  }), 'utf8');

  const run = () => execFileSync(process.execPath, [path.join(ROOT, 'scripts/refreshMenuDefaults.js')], {
    cwd: ROOT,
    env: { ...process.env, MENU_DEFAULTS_DATA_DIR: dataDir },
    encoding: 'utf8'
  });

  const out = run();
  const users = JSON.parse(fs.readFileSync(usersPath, 'utf8'));

  assert.strictEqual(users['a@lid'].preferences.messageDisplayMode, null);
  assert.strictEqual(users['a@lid'].preferences.typing, null);
  assert.strictEqual(users['b@lid'].preferences.messageDisplayMode, null);
  assert.strictEqual(users['c@lid'].preferences.messageDisplayMode, undefined,
    'a user with no override must not gain one');
  assert.match(out, /users touched\s+: 2/);

  // Nothing else about the user record may change -- this is real user data.
  assert.deepStrictEqual(Object.keys(users).sort(), ['a@lid', 'b@lid', 'c@lid']);
  assert.strictEqual(users['b@lid'].name, 'B');
  assert.strictEqual(users['a@lid'].preferences.language, 'en');

  // Re-running must be a no-op, not a second destructive pass.
  const second = run();
  assert.match(second, /users touched\s+: 0/);
});

test('2b. the migration snapshots the files it is about to rewrite', () => {
  const dataDir = path.join(tmpDir, 'snapcheck');
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(path.join(dataDir, 'users.json'), JSON.stringify({
    'x@lid': { preferences: { messageDisplayMode: 'delete_send', typing: { mode: 'on' } } }
  }), 'utf8');

  execFileSync(process.execPath, [path.join(ROOT, 'scripts/refreshMenuDefaults.js')], {
    cwd: ROOT,
    env: { ...process.env, MENU_DEFAULTS_DATA_DIR: dataDir },
    encoding: 'utf8'
  });

  // A dedicated subdirectory with a non-"botContent-" prefix: the botContent
  // snapshot service scans data/snapshots for `botContent-*.json` and would
  // otherwise list these foreign files and displace its own.
  const snapDir = path.join(dataDir, 'snapshots', 'menu-defaults');
  const snaps = fs.readdirSync(snapDir).filter((f) => f.startsWith('menuDefaults-users-pre-refresh-'));
  assert.strictEqual(snaps.length, 1, 'expected exactly one users snapshot');
  assert.ok(
    !snaps.some((f) => f.startsWith('botContent-')),
    'migration snapshots must not collide with the botContent snapshot prefix'
  );
  const snap = JSON.parse(fs.readFileSync(path.join(snapDir, snaps[0]), 'utf8'));
  assert.strictEqual(snap['x@lid'].preferences.messageDisplayMode, 'delete_send',
    'the snapshot must hold the PRE-refresh value');
  assert.ok(snap['x@lid'].preferences.typing, 'the snapshot must hold the pre-refresh typing prefs');
});

test('2c. a reset user resolves to send_new; a null preference does not shadow it', () => {
  const settings = { defaultMode: 'send_new', allowUserOverride: true, perMenuOverrideEnabled: true };
  const migrated = { preferences: { messageDisplayMode: null, typing: null } };
  assert.strictEqual(msgSvc.resolveMessageMode(null, migrated, settings), 'send_new');
});

test('2d. a user who is NOT reset would still override the default (the bug we fixed)', () => {
  // This is why the migration exists: an override always beats the global
  // default, so without the reset a stale 'hybrid' silently survives.
  const settings = { defaultMode: 'send_new', allowUserOverride: true, perMenuOverrideEnabled: true };
  assert.strictEqual(
    msgSvc.resolveMessageMode(null, { preferences: { messageDisplayMode: 'hybrid' } }, settings),
    'hybrid'
  );
});

// ---------------------------------------------------------------------------
// 3. Typing: master flag on, targeting gates per message type
// ---------------------------------------------------------------------------

test('3. typingSettings.json uses SINGULAR admin keys, chat reply only', () => {
  const raw = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/typingSettings.json'), 'utf8'));
  assert.strictEqual(raw.globalEnabled, true, 'master flag must stay true');
  const t = raw.defaults.targeting;
  assert.deepStrictEqual(Object.keys(t).sort(),
    ['chatReply', 'confirmation', 'error', 'mainMenu', 'submenuTransition'],
    'typingSettings.json must use the singular admin key names');
  assert.strictEqual(t.chatReply, true);
  for (const k of ['mainMenu', 'submenuTransition', 'confirmation', 'error']) {
    assert.strictEqual(t[k], false, `${k} must be off`);
  }
});

test('3b. botContent.json uses PLURAL keys, chat replies only', () => {
  const content = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/botContent.json'), 'utf8'));
  assert.strictEqual(content.timing.typingIndicatorEnabled, true);
  const t = content.timing.typingTargeting;
  assert.deepStrictEqual(Object.keys(t).sort(),
    ['chatReplies', 'confirmations', 'errors', 'mainMenu', 'submenuTransitions'],
    'botContent.json must use the plural key names');
  assert.strictEqual(t.chatReplies, true);
  for (const k of ['mainMenu', 'submenuTransitions', 'confirmations', 'errors']) {
    assert.strictEqual(t[k], false, `${k} must be off`);
  }
});

test('3c. the runtime typing service agrees with the file', () => {
  typingSvc.reloadTypingSettings();
  const s = typingSvc.getTypingSettings();
  assert.strictEqual(s.globalEnabled, true);
  assert.strictEqual(s.defaults.targeting.chatReply, true);
  assert.strictEqual(s.defaults.targeting.mainMenu, false);
  assert.strictEqual(s.defaults.targeting.submenuTransition, false);
});

test('3d. targeting gates typing per message type', () => {
  const noTypingUser = { preferences: {} };
  const show = (messageType) => typingResolver.shouldShowTyping({ user: noTypingUser, messageType, textLength: 40 }).show;

  assert.strictEqual(show('chatReply'), true, 'chat replies must still show typing');
  assert.strictEqual(show('mainMenu'), false, 'main menu must not show typing');
  assert.strictEqual(show('submenuTransition'), false, 'submenu transitions must not show typing');
  assert.strictEqual(show('confirmation'), false, 'confirmations must not show typing');
  assert.strictEqual(show('error'), false, 'errors must not show typing');
  assert.strictEqual(show('silent'), false, 'silent must never show typing');
});

test('3e. the master flag gates the whole system, targeting gates within it', () => {
  // This is the distinction the spec asked to confirm: with globalEnabled the
  // resolver reaches the targeting block (and chatReply survives), rather than
  // hard-returning before it.
  const user = { preferences: {} };
  const chat = typingResolver.shouldShowTyping({ user, messageType: 'chatReply', textLength: 40 });
  assert.strictEqual(chat.show, true);
  assert.ok(chat.delayMs > 0, 'adaptive mode should compute a delay');
  assert.strictEqual(chat.presenceType, 'composing');
  const menu = typingResolver.shouldShowTyping({ user, messageType: 'mainMenu', textLength: 40 });
  assert.strictEqual(menu.show, false);
  assert.strictEqual(menu.delayMs, 0);
});

// ---------------------------------------------------------------------------
// 4. Group Management 0-back sends a NEW message
// ---------------------------------------------------------------------------

function makeSock() {
  const sent = [];
  const presence = [];
  return {
    sent,
    presence,
    sendMessage: async (jid, content) => {
      sent.push({ text: String(content?.text ?? ''), edit: content?.edit ?? null });
      return { key: { id: 'k' + sent.length } };
    },
    sendPresenceUpdate: async (jid, presenceType) => { presence.push(presenceType); },
    readMessages: async () => true
  };
}

test('4. 0 from group_management_list sends a NEW GM menu, not an edit', async () => {
  const { activateGroup } = await import('../src/services/groupService.js');
  activateGroup('g1@g.us', { name: 'Dev', activatedBy: '999@lid' });

  const gm = await import('../src/handlers/groupManagementHandlers.js');
  const sock = makeSock();
  const sessionManager = (await import('../src/utils/sessionManager.js')).default;

  sessionManager.setState('999@lid', '999@lid', {
    currentMenu: 'group_management_list',
    pendingGroupIds: ['g1@g.us'],
    currentGroupJid: null
  });

  const handled = await gm.handleGroupManagementReply({
    sock,
    sender: '999@lid',
    chatId: '999@lid',
    user: { jid: '999@lid', language: 'en', preferences: {} },
    session: sessionManager.getSession('999@lid', '999@lid')
  }, '0');

  assert.strictEqual(handled, true, 'the GM handler must own the back press');

  // Compare against the real renderer rather than a regex: the menu title is
  // small-caps unicode, so an ASCII match would silently never hit.
  const { renderMenu } = await import('../src/utils/menuRenderer.js');
  const expected = await renderMenu('group_management', { jid: '999@lid', language: 'en', preferences: {} }, 'en', {});

  assert.strictEqual(sock.sent.length, 1, `expected exactly one outbound message, got ${sock.sent.length}`);
  assert.strictEqual(sock.sent[0].text, expected.text, 'the back press must render the GM menu');
  assert.strictEqual(sock.sent[0].edit, null, 'the GM menu must be a NEW message, not an edit');
  assert.strictEqual(
    sock.sent.filter((m) => m.edit !== null).length,
    0,
    'send_new must never attach an edit target'
  );

  // And the menu send itself must not flash a typing indicator.
  assert.deepStrictEqual(sock.presence, [], 'menu sends must not show typing');
});

test('4b. the GM menu definition itself declares send_new', async () => {
  await import('../src/config/menus/index.js');
  const registry = await import('../src/config/menus/registry.js');
  const def = registry.getMenu('group_management');
  assert.ok(def, 'group_management must be a registered menu');
  const resolved = msgSvc.resolveMessageMode(def, undefined, msgSvc.getSettings());
  assert.strictEqual(resolved, 'send_new');
});

test('5. the fall-through guard from the previous fix is untouched', () => {
  const src = fs.readFileSync(path.join(ROOT, 'src/index.js'), 'utf8');
  const handlerIdx = src.indexOf('await handleGroupManagementReply(');
  const guardIdx = src.indexOf('[GROUP] handler fell through');
  assert.ok(handlerIdx > -1 && guardIdx > handlerIdx, 'handler must run before the guard');
  assert.ok(/!getMenu\(session\.currentMenu\)/.test(src), 'guard must still be gated on getMenu');
});