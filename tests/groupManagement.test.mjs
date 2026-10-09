// Group Management menu labels, session-state routing and back navigation.
//
// Covers the two bugs found in the full audit:
//   1. option 5's labelKey (menu.group_management.moderation) collided with the
//      moderation submenu NAMESPACE, so the renderer printed "[object Object]".
//   2. group_stats_* states were rejected by GROUP_STATE_PREFIXES before their
//      branch ran, so "0" fell through to the DM chat rules.
import { test, before, after } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import os from 'os';
import path from 'path';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gm-audit-test-'));
process.env.GROUP_DATA_PATH = path.join(tmpDir, 'groups.json');
process.env.GROUP_DEFAULTS_DATA_PATH = path.join(tmpDir, 'groupDefaults.json');
process.env.GROUP_STATS_DATA_PATH = path.join(tmpDir, 'groupStats.json');

const registry = await import('../src/config/menus/registry.js');
await import('../src/config/menus/index.js');
const { renderMenu } = await import('../src/utils/menuRenderer.js');
const { t } = await import('../src/services/localeService.js');
const gm = await import('../src/handlers/groupManagementHandlers.js');

const LANGS = ['en', 'fr', 'de', 'es', 'ar'];
const GM_MENU = 'group_management';

let config;
// The outbound limiter caps 8 sends/min per chat. This suite drives dozens of
// replies through one sender JID, so the limiter would suppress the very sends
// under test and make back-navigation look like it did nothing.
before(async () => {
  config = (await import('../src/config/config.js')).default;
  config.rateLimit.enabled = false;
});

/** A sock that records what was sent, so tests can assert a reply happened. */
function makeSock() {
  const sent = [];
  return {
    sent,
    sendMessage: async (jid, content) => { sent.push(String(content?.text ?? '')); return { key: { id: 'k' + sent.length } }; },
    sendPresenceUpdate: async () => {},
    readMessages: async () => true
  };
}

function makeCtx(state, extra = {}) {
  const sock = makeSock();
  return {
    sock,
    sender: '999@lid',
    chatId: '999@lid',
    user: { jid: '999@lid', language: 'en' },
    session: { currentMenu: state, ...extra },
    state,
    extra
  };
}

after(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// 1. Label rendering
// ---------------------------------------------------------------------------

test('every group_management option labelKey resolves to a string', () => {
  const def = registry.getMenu(GM_MENU);
  for (const opt of def.options) {
    const v = t('en', opt.labelKey);
    assert.strictEqual(typeof v, 'string', `${opt.labelKey} is ${typeof v}`);
  }
});

test('option 5 label is not [object Object]', () => {
  const def = registry.getMenu(GM_MENU);
  const opt5 = def.options.find((o) => o.number === '5');
  assert.strictEqual(opt5.labelKey, 'menu.group_management.moderation_menu_label',
    'option 5 must not point at the moderation namespace object');
  assert.strictEqual(typeof t('en', opt5.labelKey), 'string');
});

test('the rendered menu contains no [object Object] anywhere', async () => {
  for (const lang of LANGS) {
    const r = await renderMenu(GM_MENU, { jid: '1@lid', username: 'a' }, lang);
    assert.ok(!r.text.includes('object Object'), `${lang}: ${r.text.slice(0, 200)}`);
  }
});

test('option 5 renders as a real label in all five languages', async () => {
  for (const lang of LANGS) {
    const r = await renderMenu(GM_MENU, { jid: '1@lid', username: 'a' }, lang);
    const line = r.options.find((o) => o.startsWith('5.'));
    assert.ok(line, `${lang}: no option 5 line`);
    assert.ok(!line.includes('['), `${lang}: option 5 still bracketed -> ${line}`);
    assert.ok(!/^[5.]\s*$/.test(line), `${lang}: option 5 is empty`);
  }
});

test('the moderation namespace is still an object and still usable', () => {
  // The collision was resolved by moving the label, not by flattening the
  // namespace, so submenu keys must survive.
  assert.strictEqual(typeof t('en', 'menu.group_management.moderation'), 'object');
  for (const k of ['heading', 'warn', 'mute', 'kick', 'ban', 'duration_custom']) {
    assert.strictEqual(typeof t('en', 'menu.group_management.moderation.' + k), 'string', k);
  }
});

test('the deleted duplicate key is gone from every locale', () => {
  for (const lang of LANGS) {
    const j = JSON.parse(fs.readFileSync(path.resolve('translations', `${lang}.json`), 'utf8'));
    assert.ok(!('moderation_entry' in j.menu.group_management),
      `${lang} still has moderation_entry`);
    assert.strictEqual(typeof j.menu.group_management.moderation_menu_label, 'string', lang);
  }
});

test('menu option numbers are unique', () => {
  for (const id of [GM_MENU, 'bot_content_group_messages', 'bot_content_moderation']) {
    const nums = registry.getMenu(id).options.map((o) => o.number);
    assert.strictEqual(new Set(nums).size, nums.length, `${id} has duplicate numbers`);
  }
});

// ---------------------------------------------------------------------------
// 2. State routing: every GM sub-state is claimed by the handler
// ---------------------------------------------------------------------------

const GM_STATES = [
  'group_management_list',
  'group_management_activate',
  'group_management_activate_confirm',
  'group_management_deactivate',
  'group_management_deactivate_confirm',
  'group_settings_panel',
  'group_settings_language',
  'group_settings_deactivate_confirm',
  'group_defaults_panel',
  'group_moderation_group',
  'group_moderation_user',
  'group_moderation_action',
  'group_moderation_duration',
  'group_moderation_duration_custom',
  'group_moderation_log',
  'group_stats_panel',
  'group_stats_aggregate',
  'group_stats_about'
];

test('GROUP_STATE_PREFIXES covers every GM state', () => {
  for (const st of GM_STATES) {
    assert.ok(
      gm.GROUP_STATE_PREFIXES.some((p) => st.startsWith(p)),
      `${st} is rejected by GROUP_STATE_PREFIXES`
    );
  }
});

test('index.js prefix predicate and GROUP_STATE_PREFIXES agree', () => {
  const src = fs.readFileSync(path.resolve('src/index.js'), 'utf8');
  for (const p of gm.GROUP_STATE_PREFIXES) {
    assert.ok(src.includes(`'${p}'`), `index.js predicate is missing '${p}'`);
  }
  assert.ok(src.includes("'group_stats'"), 'index.js predicate must include group_stats');
});

test('every informational panel handles invalid input instead of falling through', async () => {
  for (const st of ['group_stats_panel', 'group_stats_aggregate', 'group_stats_about', 'group_moderation_log']) {
    const ctx = makeCtx(st, { statsGroupJid: 'g@g.us', currentGroupJid: 'g@g.us' });
    const handled = await gm.handleGroupManagementReply(ctx, '99');
    assert.strictEqual(handled, true, `${st} fell through on invalid input`);
    assert.ok(ctx.sock.sent.length > 0, `${st} sent nothing`);
  }
});

test('0 is handled by every informational panel and sends a reply', async () => {
  for (const st of ['group_stats_panel', 'group_stats_aggregate', 'group_stats_about', 'group_moderation_log']) {
    const ctx = makeCtx(st, { statsGroupJid: 'g@g.us', currentGroupJid: 'g@g.us' });
    const handled = await gm.handleGroupManagementReply(ctx, '0');
    assert.strictEqual(handled, true, `${st} did not handle 0`);
    assert.ok(ctx.sock.sent.length > 0, `${st} sent nothing on 0`);
  }
});

test('a stats panel with no group falls back to the group management menu', async () => {
  const ctx = makeCtx('group_stats_panel', { statsGroupJid: null, currentGroupJid: null });
  const handled = await gm.handleGroupManagementReply(ctx, '0');
  assert.strictEqual(handled, true);
  assert.ok(ctx.sock.sent.length > 0);
});

// ---------------------------------------------------------------------------
// 3. Back navigation reaches the right parent
// ---------------------------------------------------------------------------

test('group_stats_panel "0" re-renders the settings panel, not the GM menu', async () => {
  const { activateGroup, setGroupSetting } = await import('../src/services/groupService.js');
  activateGroup('g@g.us', { name: 'Dev', activatedBy: 'a@lid' });
  setGroupSetting('g@g.us', 'welcome', true);
  const ctx = makeCtx('group_stats_panel', { statsGroupJid: 'g@g.us', currentGroupJid: 'g@g.us' });
  const handled = await gm.handleGroupManagementReply(ctx, '0');
  assert.strictEqual(handled, true);
  const out = ctx.sock.sent.join('\n');
  assert.ok(!out.includes('Group Stats'), 'did not leave the stats panel');
});

test('the GM menu is reachable by "0" from the settings panel', async () => {
  const ctx = makeCtx('group_settings_panel', { currentGroupJid: null });
  const handled = await gm.handleGroupManagementReply(ctx, '0');
  assert.strictEqual(handled, true);
  assert.ok(ctx.sock.sent.length > 0, 'no reply on 0');
});

test('clearing 0 from the defaults panel returns to the GM menu', async () => {
  const ctx = makeCtx('group_defaults_panel');
  const handled = await gm.handleGroupManagementReply(ctx, '0');
  assert.ok(ctx.sock.sent.length > 0);
});

// ---------------------------------------------------------------------------
// 4. Fall-through guard
// ---------------------------------------------------------------------------

test('an unknown group_* state does not reach chat rules', async () => {
  const ctx = makeCtx('group_unknown_panel');
  // The handler must decline; the index.js guard is what stops chat rules.
  const handled = await gm.handleGroupManagementReply(ctx, 'hi');
  assert.strictEqual(handled, false, 'handler correctly declines an unknown state');
  // The guard exists in index.js and keys off the group_ prefix.
  const src = fs.readFileSync(path.resolve('src/index.js'), 'utf8');
  assert.ok(src.includes('[GROUP] handler fell through'), 'guard log line missing');
  // The guard must be gated on the state having NO registered menu, otherwise it
  // fires for the top-level group_management menu and eats valid options.
  assert.ok(
    /!getMenu\(session\.currentMenu\)/.test(src),
    'group guard must skip states that are registered menus'
  );
  assert.ok(src.includes("'group_stats'"), "the group_stats prefix must remain in the dispatch");
});

test('the general DM menu fall-through guard exists', () => {
  const src = fs.readFileSync(path.resolve('src/index.js'), 'utf8');
  assert.ok(src.includes('[ROUTER] menu state fell through'), 'DM menu guard missing');
  assert.ok(src.includes("getMenu(session.currentMenu)"), 'DM guard should key off a registered menu');
});

test('GROUP_STATE_PREFIXES includes group_stats', () => {
  assert.ok(gm.GROUP_STATE_PREFIXES.includes('group_stats'));
});
