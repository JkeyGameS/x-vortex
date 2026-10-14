// Settings menu numbering and Danger Zone back navigation.
//
// The two bugs these cover were both user-visible:
//
//  1. Settings showed 4, 5, 9 with 1-3 and 6-8 missing.
//  2. Cancelling a Danger Zone reset/delete dropped the admin into the Settings
//     menu, because the shared confirmation states hard-coded that as their
//     back target and ignored the accountReturnMenu the Danger Zone set on
//     entry.
//
// Plus two more found while tracing: Danger Zone "0" landed in the Admin Panel
// instead of System Settings, and bad input in the Danger Zone ejected the user
// out of the panel entirely.
import { test, before, after } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import os from 'os';
import path from 'path';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'settings-routing-test-'));
process.env.GROUP_DATA_PATH = path.join(tmpDir, 'groups.json');
process.env.GROUP_DEFAULTS_DATA_PATH = path.join(tmpDir, 'groupDefaults.json');
process.env.GROUP_STATS_DATA_PATH = path.join(tmpDir, 'groupStats.json');

await import('../src/config/menus/index.js');
const registry = await import('../src/config/menus/registry.js');
const settingsMenu = (await import('../src/config/menus/settings.js')).default;
const dangerMenu = (await import('../src/config/menus/admin/dangerZone.js')).default;
const sessionManager = (await import('../src/utils/sessionManager.js')).default;
const settingsHandlers = await import('../src/handlers/settingsHandlers.js');
const dangerHandlers = await import('../src/handlers/dangerZoneHandlers.js');

const ADMIN = '999@lid';
let sent = [];

function makeSock() {
  sent = [];
  return {
    sendMessage: async (jid, content) => {
      sent.push({ jid, text: String(content?.text ?? ''), edit: content?.edit ?? null });
      return { key: { id: 'k' + sent.length } };
    },
    sendPresenceUpdate: async () => {},
    readMessages: async () => true,
    user: { id: 'BOT' }
  };
}

function ctx(state, extra = {}) {
  sessionManager.setState(ADMIN, ADMIN, { currentMenu: state, confirmAttempts: 0, ...extra });
  return {
    sock: makeSock(),
    sender: ADMIN,
    chatId: ADMIN,
    pushName: 'Admin',
    user: { jid: ADMIN, language: 'en', preferences: {} },
    language: 'en',
    session: sessionManager.getSession(ADMIN, ADMIN)
  };
}

/** The menu id that was actually re-rendered on the last send. */
const renderedMenu = () => {
  sessionManager.setState(ADMIN, ADMIN, { currentMenu: 'settings' });
  return null;
};

before(async () => {
  const config = (await import('../src/config/config.js')).default;
  config.rateLimit.enabled = false;
});
after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

// ---------------------------------------------------------------------------
// 1. Settings menu numbering
// ---------------------------------------------------------------------------

test('1. settings options are numbered 1, 2, 9 in that order', () => {
  assert.deepStrictEqual(
    settingsMenu.options.map((o) => o.number),
    ['1', '2', '9']
  );
});

test('1b. each settings option points at the right action', () => {
  const byNumber = Object.fromEntries(settingsMenu.options.map((o) => [o.number, o]));
  assert.strictEqual(byNumber['1'].action, 'custom:settings_delete_account');
  assert.strictEqual(byNumber['1'].labelKey, 'menu.settings.delete_account');
  assert.strictEqual(byNumber['2'].action, 'custom:settings_reset_account');
  assert.strictEqual(byNumber['2'].labelKey, 'menu.settings.reset_account');
  assert.strictEqual(byNumber['9'].action, 'custom:settings_help');
  assert.strictEqual(byNumber['9'].labelKey, 'menu.settings.help');
});

test('1c. every settings action has a registered custom handler', async () => {
  const { allMenuCustomHandlers } = await import('../src/utils/menuCustomHandlers.js');
  for (const opt of settingsMenu.options) {
    if (!opt.action.startsWith('custom:')) continue;
    const key = opt.action.slice('custom:'.length);
    assert.ok(
      typeof allMenuCustomHandlers[key] === 'function',
      `no handler registered for ${opt.action}`
    );
  }
});

test('1d. settings menu keeps a gear heading and main_menu back', () => {
  assert.strictEqual(settingsMenu.headingEmoji, '⚙️');
  assert.strictEqual(settingsMenu.backTo, 'main_menu');
  assert.strictEqual(settingsMenu.parent, 'main_menu');
});

test('1e. the reset emoji uses the emoji presentation selector', () => {
  // Bare U+267B renders as a text glyph on WhatsApp; U+267B U+FE0F does not.
  const reset = settingsMenu.options.find((o) => o.number === '2');
  assert.strictEqual(reset.emoji, '\u267B\uFE0F');
  assert.strictEqual(dangerMenu.options.find((o) => o.number === '1').emoji, '\u267B\uFE0F');
});

test('1f. no bare U+267B is left anywhere in src or translations', () => {
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return walk(p);
    return /\.(js|mjs|json)$/.test(e.name) ? [p] : [];
  });
  const bare = /(?:\u267B(?![\uFE0E\uFE0F])|\\u267B(?!\\uFE0F))/g;
  const self = path.resolve('tests/settingsRouting.test.mjs');
  const offenders = [];
  for (const dir of ['src', 'translations', 'tests']) {
    for (const f of walk(dir)) {
      // This file necessarily contains a bare U+267B: it is the pattern that
      // detects them. Skipping it stops the scan from matching itself.
      if (path.resolve(f) === self) continue;
      const hits = fs.readFileSync(f, 'utf8').match(bare);
      if (hits) offenders.push(`${f} (${hits.length})`);
    }
  }
  assert.deepStrictEqual(offenders, [], 'bare U+267B found');
});

// ---------------------------------------------------------------------------
// 2. Danger Zone sub-flows return to the Danger Zone
// ---------------------------------------------------------------------------

test('2. cancel from a Danger Zone reset returns to danger_zone', async () => {
  const c = ctx('settings_reset_confirm_intent', { accountReturnMenu: 'danger_zone' });
  const handled = await settingsHandlers.handleAccountConfirmReply(c, 'settings_reset_confirm_intent', '0');
  assert.strictEqual(handled, true);

  const menu = registry.getMenu('danger_zone');
  assert.ok(menu, 'danger_zone must be a registered menu');
  const after = sessionManager.getSession(ADMIN, ADMIN);
  assert.strictEqual(after.currentMenu, 'danger_zone', 'session must land on danger_zone');
  assert.strictEqual(after.accountReturnMenu, null, 'origin must be cleared after use');
});

test('2b. cancel from a Settings reset returns to settings', async () => {
  const c = ctx('settings_reset_confirm_intent');
  await settingsHandlers.handleAccountConfirmReply(c, 'settings_reset_confirm_intent', '0');
  const after = sessionManager.getSession(ADMIN, ADMIN);
  assert.strictEqual(after.currentMenu, 'settings');
  assert.strictEqual(after.accountReturnMenu, null);
});

test('2c. explicit origin "settings" also returns to settings', async () => {
  const c = ctx('settings_delete_confirm_intent', { accountReturnMenu: 'settings' });
  await settingsHandlers.handleAccountConfirmReply(c, 'settings_delete_confirm_intent', '2');
  const after = sessionManager.getSession(ADMIN, ADMIN);
  assert.strictEqual(after.currentMenu, 'settings');
  assert.strictEqual(after.accountReturnMenu, null);
});

test('3. all four settings states honour the origin on cancel', async () => {
  const states = [
    settingsHandlers.RESET_INTENT,
    settingsHandlers.RESET_WORD,
    settingsHandlers.DELETE_INTENT,
    settingsHandlers.DELETE_WORD
  ];
  assert.deepStrictEqual(states, [
    'settings_reset_confirm_intent',
    'settings_reset_confirm_word',
    'settings_delete_confirm_intent',
    'settings_delete_confirm_word'
  ]);

  for (const state of states) {
    const c = ctx(state, { accountReturnMenu: 'danger_zone' });
    await settingsHandlers.handleAccountConfirmReply(c, state, '0');
    const after = sessionManager.getSession(ADMIN, ADMIN);
    assert.strictEqual(after.currentMenu, 'danger_zone', `${state} did not return to danger_zone`);
    assert.strictEqual(after.accountReturnMenu, null, `${state} left a stale origin`);
  }
});

test('3b. the two-strike wrong-word limit cancels back to the origin', async () => {
  const c = ctx('settings_reset_confirm_word', { accountReturnMenu: 'danger_zone' });
  await settingsHandlers.handleAccountConfirmReply(c, 'settings_reset_confirm_word', 'NOPE');

  let after = sessionManager.getSession(ADMIN, ADMIN);
  assert.strictEqual(after.currentMenu, 'settings_reset_confirm_word', 'first wrong word must re-prompt');
  assert.strictEqual(after.confirmAttempts, 1);

  const c2 = ctx('settings_reset_confirm_word', { accountReturnMenu: 'danger_zone', confirmAttempts: 1 });
  await settingsHandlers.handleAccountConfirmReply(c2, 'settings_reset_confirm_word', 'STILL_NOPE');

  after = sessionManager.getSession(ADMIN, ADMIN);
  assert.strictEqual(after.currentMenu, 'danger_zone', 'second wrong word must cancel to the origin');
  assert.strictEqual(after.confirmAttempts, 0);
});

test('3c. the origin is read from the live session, not a stale snapshot', async () => {
  // The caller's context.session is captured when the message arrived. If the
  // flow sets the origin later, reading context would miss it.
  const c = ctx('settings_reset_confirm_intent');
  c.session = { ...c.session, accountReturnMenu: undefined };  // deliberately stale
  sessionManager.setState(ADMIN, ADMIN, { accountReturnMenu: 'danger_zone' });
  await settingsHandlers.handleAccountConfirmReply(c, 'settings_reset_confirm_intent', '0');
  assert.strictEqual(sessionManager.getSession(ADMIN, ADMIN).currentMenu, 'danger_zone');
});

// ---------------------------------------------------------------------------
// 4. Danger Zone back navigation
// ---------------------------------------------------------------------------

test('4. danger_zone 0 lands on system_settings, not the admin panel', async () => {
  const c = ctx('danger_zone');
  await dangerHandlers.handleDangerZoneReply(c, 'danger_zone', '0');
  const after = sessionManager.getSession(ADMIN, ADMIN);
  assert.strictEqual(after.currentMenu, 'system_settings');
  assert.ok(registry.getMenu('system_settings'), 'system_settings must be a registered menu');
});

test('4b. purge cancel returns to danger_zone', async () => {
  const c = ctx(dangerHandlers.PURGE_INTENT);
  await dangerHandlers.handleDangerZoneReply(c, dangerHandlers.PURGE_INTENT, '2');
  const after = sessionManager.getSession(ADMIN, ADMIN);
  assert.strictEqual(after.currentMenu, 'danger_zone');
});

test('4c. purge success returns to danger_zone', async () => {
  const c = ctx(dangerHandlers.PURGE_INTENT);
  await dangerHandlers.handleDangerZoneReply(c, dangerHandlers.PURGE_INTENT, '1');
  const after = sessionManager.getSession(ADMIN, ADMIN);
  assert.strictEqual(after.currentMenu, 'danger_zone');
});

// ---------------------------------------------------------------------------
// 5. Bad input preserves the panel
// ---------------------------------------------------------------------------

test('5. bad input in danger_zone keeps the user on the Danger Zone menu', async () => {
  for (const bad of ['99', 'hi', 'abc']) {
    const c = ctx('danger_zone');
    await dangerHandlers.handleDangerZoneReply(c, 'danger_zone', bad);
    const after = sessionManager.getSession(ADMIN, ADMIN);
    assert.strictEqual(after.currentMenu, 'danger_zone', `"${bad}" ejected the user`);
  }
});

test('5b. bad input in the purge panel preserves the purge panel', async () => {
  for (const bad of ['99', 'hi', 'maybe']) {
    const c = ctx(dangerHandlers.PURGE_INTENT);
    await dangerHandlers.handleDangerZoneReply(c, dangerHandlers.PURGE_INTENT, bad);
    const after = sessionManager.getSession(ADMIN, ADMIN);
    assert.strictEqual(after.currentMenu, dangerHandlers.PURGE_INTENT, `"${bad}" ejected the user`);
  }
});

test('5c. bad input never reaches chat rules', async () => {
  // The intercepted block returns before the generic resolver either way; this
  // asserts the state is still one the router owns.
  const c = ctx('danger_zone');
  await dangerHandlers.handleDangerZoneReply(c, 'danger_zone', 'hi');
  assert.strictEqual(sessionManager.getSession(ADMIN, ADMIN).currentMenu, 'danger_zone');
});

// ---------------------------------------------------------------------------
// 6. Router interception covers every state either flow can set
// ---------------------------------------------------------------------------

test('6. the router intercepts every danger_* and settings_* state', () => {
  const src = fs.readFileSync(path.resolve('src/index.js'), 'utf8');
  assert.ok(src.includes('isAccountConfirmState'), 'account confirm intercept block missing');
  assert.ok(src.includes('handleDangerZoneReply'), 'danger zone intercept block missing');

  // Both confirm states must come from the shared four-state list.
  assert.deepStrictEqual(
    [...settingsHandlers.CONFIRM_STATES].sort(),
    [
      'settings_delete_confirm_intent',
      'settings_delete_confirm_word',
      'settings_reset_confirm_intent',
      'settings_reset_confirm_word'
    ]
  );
  for (const s of settingsHandlers.CONFIRM_STATES) {
    assert.strictEqual(settingsHandlers.isAccountConfirmState(s), true, `${s} not recognised`);
  }
  assert.strictEqual(settingsHandlers.isAccountConfirmState('danger_zone'), false);
  assert.strictEqual(settingsHandlers.isAccountConfirmState('main'), false);
});

test('6b. the settings dispatcher routes 1 and 2 to the account flows', () => {
  const src = fs.readFileSync(path.resolve('src/index.js'), 'utf8');
  const block = src.slice(src.indexOf("if (session.currentMenu === 'settings')"));
  const slice = block.slice(0, block.indexOf("await handleProfileReply"));
  assert.ok(slice.includes('trimmedText === \'1\''), 'no route for option 1');
  assert.ok(slice.includes('trimmedText === \'2\''), 'no route for option 2');
  assert.ok(slice.includes('trimmedText === \'9\''), 'no route for option 9');
  assert.ok(slice.includes('trimmedText === \'0\''), 'no route for back');
  assert.ok(slice.includes('settingsDeleteAccount'), 'option 1 must open the delete flow');
  assert.ok(slice.includes('settingsResetAccount'), 'option 2 must open the reset flow');
  assert.ok(slice.includes("tr('common.invalidChoiceValid')"), 'invalid-choice fallback missing');
});

test('7. danger zone menu still has three options, purge last', () => {
  assert.deepStrictEqual(dangerMenu.options.map((o) => o.number), ['1', '2', '3']);
  assert.strictEqual(dangerMenu.parent, 'system_settings');
  assert.strictEqual(dangerMenu.backTo, 'system_settings');
  assert.strictEqual(dangerMenu.adminOnly, true);
});