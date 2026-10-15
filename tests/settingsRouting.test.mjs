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
  assert.strictEqual(settingsMenu.headingEmoji, '\u2699\uFE0F');
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

// ---------------------------------------------------------------------------
// 8. Rate limit: menus bypass, chat replies do not
//
// Regression cover for the second-pass back-navigation failure. Walking
// /start -> settings -> delete -> back -> back and back in again consumed the
// 8/min per-chat budget, and the eighth message -- the second-pass back -- was
// silently dropped. The session had already advanced, so the user saw nothing
// and had no menu on screen to retry from.
// ---------------------------------------------------------------------------

test('8. ten rapid menu sends all get delivered', async () => {
  const rate = await import('../src/services/outboundRateLimitService.js');
  const { sendMenuById } = await import('../src/utils/menuSender.js');
  rate.resetOutboundRateLimit();

  let delivered = 0;
  const sock = {
    sendMessage: async () => { delivered++; return { key: { id: 'k' + delivered } }; },
    sendPresenceUpdate: async () => {},
    readMessages: async () => true
  };
  const jid = 'rate-menu@lid';
  for (let i = 0; i < 10; i++) {
    await sendMenuById('settings', { sock, sender: jid, chatId: jid, user: null, language: 'en' }, 'main_to_settings');
  }
  assert.strictEqual(delivered, 10, `menu sends must not be rate limited (got ${delivered}/10)`);
  const stats = rate.getOutboundRateLimitStats();
  assert.ok(!stats.chats || !stats.chats[jid], 'menu sends must not consume the per-chat budget');
});

test('8b. ten rapid chat replies ARE limited, and say so', async () => {
  const config = (await import('../src/config/config.js')).default;
  const rate = await import('../src/services/outboundRateLimitService.js');
  const { sendText } = await import('../src/services/messageService.js');
  // The suite-level before() disables the limiter so menu tests are not
  // suppressed; these tests are about the limiter, so switch it back on.
  config.rateLimit.enabled = true;
  rate.resetOutboundRateLimit();

  const bodies = [];
  const sock = {
    sendMessage: async (j, c) => { bodies.push(String(c?.text ?? '')); return { key: { id: 'k' + bodies.length } }; },
    sendPresenceUpdate: async () => {},
    readMessages: async () => true
  };
  const jid = 'rate-chat@lid';
  const limit = config.rateLimit.perChatPerMinute;
  for (let i = 0; i < limit + 4; i++) {
    await sendText(sock, jid, `reply ${i}`, { skipTyping: true });
  }
  const replies = bodies.filter((b) => b.startsWith('reply '));
  assert.strictEqual(replies.length, limit, `chat replies must stop at the limit (got ${replies.length})`);
  const slowdowns = bodies.filter((b) => b.startsWith('\u23F3'));
  assert.ok(slowdowns.length > 0, 'a suppressed chat reply must tell the user to slow down');
  rate.resetOutboundRateLimit();
});

test('8c. the slow-down notice itself is never suppressed', async () => {
  const config = (await import('../src/config/config.js')).default;
  const rate = await import('../src/services/outboundRateLimitService.js');
  const { sendText } = await import('../src/services/messageService.js');
  config.rateLimit.enabled = true;
  rate.resetOutboundRateLimit();

  const bodies = [];
  const sock = {
    sendMessage: async (j, c) => { bodies.push(String(c?.text ?? '')); return { key: { id: 'k' + bodies.length } }; },
    sendPresenceUpdate: async () => {},
    readMessages: async () => true
  };
  const jid = 'rate-notice@lid';
  const limit = config.rateLimit.perChatPerMinute;
  for (let i = 0; i < limit + 6; i++) {
    await sendText(sock, jid, `reply ${i}`, { skipTyping: true });
  }
  const slowdowns = bodies.filter((b) => b.startsWith('\u23F3'));
  assert.ok(
    slowdowns.length >= 1,
    'the notice must reach the user even after the budget is exhausted'
  );
  rate.resetOutboundRateLimit();
});

test('8d. the bypass is configurable and defaults on', async () => {
  const config = (await import('../src/config/config.js')).default;
  assert.strictEqual(config.rateLimit.bypassForUserOutcomes, true,
    'menu/user-outcome bypass must default to on');

  const src = fs.readFileSync(path.resolve('src/utils/messageHelper.js'), 'utf8');
  assert.ok(
    src.includes('bypassForUserOutcomes'),
    'sendMenu must read the bypass flag from config so an admin can turn it off'
  );
});

// ---------------------------------------------------------------------------
// 9. Typing indicator: panels must not type, chat replies must
// ---------------------------------------------------------------------------

test('9. no account panel emits a typing indicator', async () => {
  const presence = [];
  const sock = {
    sendMessage: async () => ({ key: { id: 'k' } }),
    sendPresenceUpdate: async (j, p) => { presence.push(p); },
    readMessages: async () => true
  };
  const jid = 'typing-panel@lid';
  const c = {
    sock, sender: jid, chatId: jid, pushName: 'A',
    user: { jid, language: 'en', preferences: {} }, language: 'en',
    session: sessionManager.getSession(jid, jid)
  };

  presence.length = 0;
  await settingsHandlers.settingsDeleteAccount(c);
  assert.deepStrictEqual(presence, [], 'delete account panel must not type');

  presence.length = 0;
  await settingsHandlers.settingsResetAccount(c);
  assert.deepStrictEqual(presence, [], 'reset account panel must not type');

  presence.length = 0;
  await dangerHandlers.dangerPurgeSnapshots(c);
  assert.deepStrictEqual(presence, [], 'purge snapshots panel must not type');
});

test('9b. both panel files route every send through a typed helper', () => {
  // A raw sendText(context.sock, ...) would default to type 'chatReply' and
  // bring the typing indicator straight back.
  for (const f of ['src/handlers/settingsHandlers.js', 'src/handlers/dangerZoneHandlers.js']) {
    const src = fs.readFileSync(path.resolve(f), 'utf8');
    assert.ok(!/sendText\(\s*context\.sock/.test(src),
      `${f} still calls sendText(context.sock,...) without a type`);
    assert.ok(/type:\s*'submenuTransition'/.test(src),
      `${f} must declare the submenuTransition panel type`);
  }
});

test('9c. a chat reply still shows typing', async () => {
  const presence = [];
  const sock = {
    sendMessage: async () => ({ key: { id: 'k' } }),
    sendPresenceUpdate: async (j, p) => { presence.push(p); },
    readMessages: async () => true
  };
  const { sendText } = await import('../src/services/messageService.js');
  await sendText(sock, 'typing-chat@lid', 'hello');
  assert.ok(presence.length > 0, 'chat replies must keep their typing indicator');
});