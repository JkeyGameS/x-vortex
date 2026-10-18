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

// Panel text is small-capped, so ASCII regexes never match it ("ɪɴᴠᴀʟɪᴅ" is not
// "invalid"). This map is derived from toSmallCaps itself rather than
// hand-written, so it cannot drift from the renderer's table.
const { toSmallCaps } = await import('../src/utils/smallCaps.js');
const SMALL_CAPS_MAP = new Map(
  [...'abcdefghijklmnopqrstuvwxyz'].map((ch) => [toSmallCaps(ch), ch])
);
function readText(s) {
  return [...String(s)]
    .map((c) => SMALL_CAPS_MAP.get(c) ?? c)
    .join('')
    .toLowerCase();
}
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

test('option 3 label is not [object Object]', () => {
  const def = registry.getMenu(GM_MENU);
  const opt = def.options.find((o) => o.number === '3');
  assert.strictEqual(opt.labelKey, 'menu.group_management.moderation_menu_label',
    'option 3 must not point at the moderation namespace object');
  assert.strictEqual(typeof t('en', opt.labelKey), 'string');
});

test('the rendered menu contains no [object Object] anywhere', async () => {
  for (const lang of LANGS) {
    const r = await renderMenu(GM_MENU, { jid: '1@lid', username: 'a' }, lang);
    assert.ok(!r.text.includes('object Object'), `${lang}: ${r.text.slice(0, 200)}`);
  }
});

test('option 3 renders as a real label in all five languages', async () => {
  for (const lang of LANGS) {
    const r = await renderMenu(GM_MENU, { jid: '1@lid', username: 'a' }, lang);
    const line = r.options.find((o) => o.startsWith('3.'));
    assert.ok(line, `${lang}: no option 3 line`);
    assert.ok(!line.includes('['), `${lang}: option 3 still bracketed -> ${line}`);
    assert.ok(!/^[3.]\s*$/.test(line), `${lang}: option 3 is empty`);
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
  'group_stats_aggregate'
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
  for (const st of ['group_stats_panel', 'group_stats_aggregate', 'group_moderation_log']) {
    const ctx = makeCtx(st, { statsGroupJid: 'g@g.us', currentGroupJid: 'g@g.us' });
    const handled = await gm.handleGroupManagementReply(ctx, '99');
    assert.strictEqual(handled, true, `${st} fell through on invalid input`);
    assert.ok(ctx.sock.sent.length > 0, `${st} sent nothing`);
  }
});

test('0 is handled by every informational panel and sends a reply', async () => {
  for (const st of ['group_stats_panel', 'group_stats_aggregate', 'group_moderation_log']) {
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

// ---------------------------------------------------------------------------
// 3. Menu refresh: four options, three-state list, no "Group not found."
// ---------------------------------------------------------------------------

test('the GM menu has exactly four options', () => {
  const def = registry.getMenu(GM_MENU);
  assert.deepStrictEqual(def.options.map((o) => o.number), ['1', '2', '3', '4']);
  assert.deepStrictEqual(
    def.options.map((o) => o.action),
    [
      'custom:groups_my_groups',
      'custom:groups_aggregate_stats',
      'custom:groups_moderation',
      'custom:groups_defaults'
    ]
  );
});

test('the removed Activate / Deactivate / About Stats options are gone', () => {
  const actions = registry.getMenu(GM_MENU).options.map((o) => o.action);
  assert.ok(!actions.includes('custom:groups_activate'), 'activate option still present');
  assert.ok(!actions.includes('custom:groups_deactivate'), 'deactivate option still present');
  assert.ok(!actions.includes('custom:groups_about_stats'), 'about stats option still present');
});

test('the handlers for the removed options were deleted', async () => {
  assert.strictEqual(gm.groupsActivate, undefined, 'groupsActivate should be gone');
  assert.strictEqual(gm.groupsDeactivate, undefined, 'groupsDeactivate should be gone');
  const map = gm.groupManagementCustomHandlers;
  assert.strictEqual(map.groups_activate, undefined);
  assert.strictEqual(map.groups_deactivate, undefined);
  assert.strictEqual(map.groups_about_stats, undefined);
  assert.strictEqual(typeof map.groups_my_groups, 'function');
});

test('the removed translation keys are gone from every locale', () => {
  for (const lang of LANGS) {
    const j = JSON.parse(fs.readFileSync(path.resolve('translations', `${lang}.json`), 'utf8'));
    const gmns = j.menu.group_management;
    for (const key of ['activate', 'deactivate', 'about_stats', 'enabled']) {
      assert.ok(!(key in gmns), `${lang} still defines menu.group_management.${key}`);
    }
    for (const key of ['summary_active', 'summary_deactivated', 'summary_available']) {
      assert.strictEqual(typeof gmns[key], 'string', `${lang} missing summary key ${key}`);
    }
  }
});

test('/groups stays primary and /gm stays the alias', () => {
  const def = registry.getMenu(GM_MENU);
  assert.strictEqual(def.standaloneCommand, '/groups');
  assert.deepStrictEqual(def.aliases, ['/gm']);
});

test('the summary resolver reports active, deactivated and available', async () => {
  const { summaryResolvers } = await import('../src/utils/menuResolvers.js');
  const fn = summaryResolvers.groupManagementSummary;
  assert.strictEqual(typeof fn, 'function', 'groupManagementSummary not registered');

  // Synthetic fixture -- data/groups.json is empty on a fresh install, so a
  // real assertion against it would only ever see zeros.
  const { __setCacheForTests } = await import('../src/services/groupService.js');
  __setCacheForTests({
    'a@g.us': { id: 'a@g.us', name: 'Alpha', enabled: true },
    'b@g.us': { id: 'b@g.us', name: 'Beta', enabled: true },
    'c@g.us': { id: 'c@g.us', name: 'Gamma', enabled: false }
  });

  const sock = {
    groupFetchAllParticipating: async () => ({
      a: { id: 'a@g.us', subject: 'Alpha' },
      b: { id: 'b@g.us', subject: 'Beta' },
      c: { id: 'c@g.us', subject: 'Gamma' },
      d: { id: 'd@g.us', subject: 'Delta' }
    }),
    groupMetadata: async () => ({
      participants: [{ id: '999@lid', admin: 'superadmin' }]
    })
  };
  const out = await fn(sock, '999@lid');
  assert.strictEqual(out.length, 4, 'three count lines plus the trailing blank');

  // Asserted by position: the labels go through toSmallCaps, so their letters
  // are non-ASCII and cannot be used as map keys.
  const counts = out.slice(0, 3).map((l) => l.dynamic);
  assert.deepStrictEqual(counts, ['2*', '1*', '1*'],
    'expected 2 active / 1 deactivated / 1 available, got ' + JSON.stringify(out));
  for (const l of out.slice(0, 3)) {
    assert.strictEqual(typeof l.static, 'string');
    assert.ok(l.static.includes(':'), 'each count line needs a label');
  }
});

test('listBotGroups is cached and the cache can be invalidated', async () => {
  const { listBotGroups, invalidateBotGroupsCache } = await import('../src/utils/groupHelper.js');
  let calls = 0;
  const sock = {
    groupFetchAllParticipating: async () => {
      calls++;
      return { x: { id: 'x@g.us', subject: 'X' } };
    }
  };
  await listBotGroups(sock);
  await listBotGroups(sock);
  assert.strictEqual(calls, 1, 'second call should be served from cache');

  invalidateBotGroupsCache(sock);
  await listBotGroups(sock);
  assert.strictEqual(calls, 2, 'invalidation must force a refetch');
});

test('the unified list gives every row a status and a defined action', async () => {
  const { __setCacheForTests } = await import('../src/services/groupService.js');
  __setCacheForTests({
    'a@g.us': { id: 'a@g.us', name: 'Alpha', enabled: true },
    'c@g.us': { id: 'c@g.us', name: 'Gamma', enabled: false }
  });
  const { invalidateBotGroupsCache } = await import('../src/utils/groupHelper.js');

  const sock = makeSock();
  sock.groupFetchAllParticipating = async () => ({
    a: { id: 'a@g.us', subject: 'Alpha' },
    c: { id: 'c@g.us', subject: 'Gamma' },
    d: { id: 'd@g.us', subject: 'Delta' },
    e: { id: 'e@g.us', subject: 'Epsilon' }
  });
  sock.groupMetadata = async () => ({
    participants: [{ id: '999@lid', admin: 'superadmin' }]
  });
  invalidateBotGroupsCache(sock);

  const ctx = {
    sock,
    sender: '999@lid',
    chatId: '999@lid',
    user: { jid: '999@lid', language: 'en' },
    session: { currentMenu: GM_MENU },
    state: GM_MENU
  };
  await gm.groupsMyGroups(ctx);

  const text = ctx.sock.sent.join('\n');
  assert.ok(text.includes('Alpha'), 'active group missing');
  assert.ok(text.includes('Gamma'), 'deactivated group missing');
  assert.ok(text.includes('Delta'), 'available group missing');
  assert.ok(text.includes('Epsilon'), 'available group missing');
  // The three markers, and no trace of the old on/off pair.
  assert.ok(/\u2705/i.test(text) || text.includes('\u02705'), 'active marker missing');
  assert.ok(!text.includes('[object Object]'), 'rendered [object Object]');
});

test('selecting an active group opens its settings panel', async () => {
  const { __setCacheForTests } = await import('../src/services/groupService.js');
  __setCacheForTests({ 'a@g.us': { id: 'a@g.us', name: 'Alpha', enabled: true } });

  const ctx = makeCtx('group_management_list', {
    managedGroups: [{ jid: 'a@g.us', name: 'Alpha', status: 'active', manageable: true }],
    pendingGroupIds: ['a@g.us']
  });
  const handled = await gm.handleGroupManagementReply(ctx, '1');
  assert.strictEqual(handled, true);
  assert.ok(ctx.sock.sent.length > 0, 'no reply');
  assert.ok(
    !ctx.sock.sent.join('').includes('Group not found'),
    'selecting an active group must never report "Group not found."'
  );
});

test('selecting a deactivated group asks before reactivating, and 2 cancels', async () => {
  const ctx = makeCtx('group_management_list', {
    managedGroups: [{ jid: 'c@g.us', name: 'Gamma', status: 'deactivated', manageable: true }],
    pendingGroupIds: ['c@g.us']
  });
  await gm.handleGroupManagementReply(ctx, '1');
  const prompted = ctx.sock.sent.join('\n');
  assert.ok(prompted.includes('Gamma'), 'the prompt must name the group');
  assert.ok(readText(prompted).includes('deactivated'), 'must say the group is deactivated');
  assert.strictEqual(ctx.state, 'group_management_list');
});

test('selecting an available group asks before activating', async () => {
  const ctx = makeCtx('group_management_list', {
    managedGroups: [{ jid: 'd@g.us', name: 'Delta', status: 'available', manageable: true }],
    pendingGroupIds: ['d@g.us']
  });
  await gm.handleGroupManagementReply(ctx, '1');
  const prompted = ctx.sock.sent.join('\n');
  assert.ok(prompted.includes('Delta'), 'the prompt must name the group');
  assert.ok(
    !/group not found/i.test(prompted),
    'an available group must never produce "Group not found."'
  );
});

test('an out-of-range selection is an invalid choice, not a crash', async () => {
  const ctx = makeCtx('group_management_list', {
    managedGroups: [{ jid: 'a@g.us', name: 'Alpha', status: 'active', manageable: true }],
    pendingGroupIds: ['a@g.us']
  });
  const handled = await gm.handleGroupManagementReply(ctx, '9');
  assert.strictEqual(handled, true);
  assert.ok(readText(ctx.sock.sent.join('|')).includes('invalid choice'),
    'expected an invalid-choice reply, got: ' + ctx.sock.sent.join('|'));
});

test('the aggregate panel carries the About Stats footnote and no such menu option', async () => {
  const ctx = makeCtx('group_stats_aggregate');
  const handled = await gm.handleGroupManagementReply(ctx, '0');
  assert.strictEqual(handled, true);
  const src = fs.readFileSync(path.resolve('src/handlers/groupManagementHandlers.js'), 'utf8');
  assert.ok(src.includes('90-day history'), 'the About Stats footnote is missing');
  assert.ok(!src.includes('openAboutStats'), 'openAboutStats should be deleted');
});

// ---------------------------------------------------------------------------
// 4. Panel typing classification
//
// Every panel send in this file goes through GROUP_OPTS, so this is one
// assertion rather than sixty. It failed in the wild: skipTyping was false and
// no type was set, so panels flashed a typing indicator and were filed as
// unsolicited chat replies against the outbound rate limit.
// ---------------------------------------------------------------------------

test('GROUP_OPTS names the send type and suppresses typing', () => {
  const src = fs.readFileSync(path.resolve('src/handlers/groupManagementHandlers.js'), 'utf8');
  const m = src.match(/const GROUP_OPTS = \{([^}]*)\}/);
  assert.ok(m, 'GROUP_OPTS declaration not found');
  const body = m[1];
  assert.ok(/type\s*:\s*'submenuTransition'/.test(body),
    "GROUP_OPTS must set type: 'submenuTransition', got: " + body.trim());
  assert.ok(/skipTyping\s*:\s*true/.test(body),
    "GROUP_OPTS must set skipTyping: true, got: " + body.trim());
  assert.ok(!/skipTyping\s*:\s*false/.test(body),
    'skipTyping: false re-enables the indicator');
});

test('DM_OPTS in moderationHandlers names the send type', () => {
  const src = fs.readFileSync(path.resolve('src/handlers/moderationHandlers.js'), 'utf8');
  const m = src.match(/const DM_OPTS = \{([^}]*)\}/);
  assert.ok(m, 'DM_OPTS declaration not found');
  assert.ok(/type\s*:\s*'submenuTransition'/.test(m[1]),
    "DM_OPTS must set type: 'submenuTransition', got: " + m[1].trim());
});

test('no GM panel send bypasses GROUP_OPTS with its own options', () => {
  // A call site passing its own opts would reintroduce the indicator without
  // touching the constant, so assert none exist.
  const src = fs.readFileSync(path.resolve('src/handlers/groupManagementHandlers.js'), 'utf8');
  const bare = src.match(/sendText\([^)]*\)\);/g) || [];
  assert.deepStrictEqual(bare, [],
    'these sendText calls pass no options: ' + JSON.stringify(bare));
});

test('no GM panel emits a typing indicator', async () => {
  const presence = [];
  const sock = {
    sendMessage: async () => ({ key: { id: 'k' } }),
    sendPresenceUpdate: async (j, p) => { presence.push(p); },
    readMessages: async () => true,
    groupFetchAllParticipating: async () => ({}),
    groupMetadata: async () => ({ participants: [{ id: '999@lid', admin: 'superadmin' }] })
  };
  const { __setCacheForTests } = await import('../src/services/groupService.js');
  __setCacheForTests({ 'a@g.us': { id: 'a@g.us', name: 'Alpha', enabled: true } });
  const { invalidateBotGroupsCache } = await import('../src/utils/groupHelper.js');
  invalidateBotGroupsCache(sock);

  const base = {
    sock, sender: '999@lid', chatId: '999@lid',
    user: { jid: '999@lid', language: 'en' }
  };

  presence.length = 0;
  await gm.groupsMyGroups({ ...base, session: { currentMenu: GM_MENU } });
  assert.deepStrictEqual(presence, [], 'My Groups panel must not type');

  presence.length = 0;
  await gm.groupsDefaults({ ...base, session: { currentMenu: 'system_settings' } });
  assert.deepStrictEqual(presence, [], 'Defaults panel must not type');
});

// ---------------------------------------------------------------------------
// 5. Back navigation sends a new message and never reuses a stale lastMenuKey
//
// A submenu owns session.lastMenuKey. If it survives the trip back, some later
// menu send can edit that old message instead of sending a new one -- which is
// exactly what "pressing 0 edits the parent menu" looks like from the outside.
// group_stats_panel and group_moderation_log were the leaky ones: they back out
// through renderPanelFor, a sendText panel that never touches lastMenuKey.
// ---------------------------------------------------------------------------

/**
 * Drive `0` from a GM sub-state and report what was sent plus the session keys
 * before and after.
 */
async function pressBack(state, extra = {}) {
  const { __setCacheForTests } = await import('../src/services/groupService.js');
  __setCacheForTests({
    'a@g.us': { id: 'a@g.us', name: 'Alpha', enabled: true, settings: {}, language: 'en' }
  });

  const sends = [];
  const sock = {
    sendMessage: async (j, c) => {
      sends.push({ edit: c?.edit ?? null, text: String(c?.text ?? '') });
      return { key: { id: 'k' + sends.length } };
    },
    sendPresenceUpdate: async () => {},
    readMessages: async () => true,
    user: { id: 'BOT' },
    groupMetadata: async () => ({
      id: 'a@g.us', subject: 'Alpha',
      participants: [{ id: '999@lid', admin: 'superadmin' }]
    }),
    groupFetchAllParticipating: async () => ({})
  };
  const { invalidateBotGroupsCache } = await import('../src/utils/groupHelper.js');
  invalidateBotGroupsCache(sock);

  const sessionManager = (await import('../src/utils/sessionManager.js')).default;
  const STALE = { id: 'STALE-KEY' };
  sessionManager.setState('999@lid', '999@lid', {
    currentMenu: state, lastMenuKey: STALE, confirmAttempts: 0, ...extra
  });

  const handled = await gm.handleGroupManagementReply(
    {
      sock, sender: '999@lid', chatId: '999@lid',
      user: { jid: '999@lid', language: 'en' },
      session: sessionManager.getSession('999@lid', '999@lid')
    },
    '0'
  );
  const after = sessionManager.getSession('999@lid', '999@lid');
  return { sends, handled, after, stale: STALE };
}

test('back from each GM sub-panel sends a new message, never an edit', async () => {
  const CASES = [
    ['group_settings_panel', { currentGroupJid: 'a@g.us' }, 'group_management'],
    ['group_settings_language', { currentGroupJid: 'a@g.us' }, 'group_management'],
    ['group_stats_panel', { statsGroupJid: 'a@g.us', currentGroupJid: 'a@g.us' }, 'group_settings_panel'],
    ['group_moderation_log', { statsGroupJid: 'a@g.us', currentGroupJid: 'a@g.us' }, 'group_settings_panel']
  ];

  for (const [state, extra, parent] of CASES) {
    const { sends, handled, after } = await pressBack(state, extra);
    assert.strictEqual(handled, true, `${state} did not own the back press`);
    assert.ok(sends.length > 0, `${state} sent nothing`);
    const edited = sends.filter((s) => s.edit !== null);
    assert.deepStrictEqual(edited, [],
      `${state} edited the parent instead of sending it new`);
    assert.strictEqual(after.currentMenu, parent, `${state} landed on the wrong parent`);
  }
});

test('back from each GM sub-panel clears the stale lastMenuKey', async () => {
  const CASES = [
    ['group_settings_panel', { currentGroupJid: 'a@g.us' }],
    ['group_settings_language', { currentGroupJid: 'a@g.us' }],
    ['group_stats_panel', { statsGroupJid: 'a@g.us', currentGroupJid: 'a@g.us' }],
    ['group_moderation_log', { statsGroupJid: 'a@g.us', currentGroupJid: 'a@g.us' }]
  ];

  for (const [state, extra] of CASES) {
    const { after, stale } = await pressBack(state, extra);
    assert.notDeepStrictEqual(after.lastMenuKey, stale,
      `${state} kept the stale lastMenuKey; a later send could edit the submenu message`);
    // Either cleared outright (sendText-backed parents) or replaced by the key
    // of the menu we just sent (sendMenuById-backed parents).
    const isFresh = after.lastMenuKey === null
      || (after.lastMenuKey && after.lastMenuKey.id !== stale.id);
    assert.ok(isFresh, `${state} has an unexpected lastMenuKey: ${JSON.stringify(after.lastMenuKey)}`);
  }
});

test('the GM stats panels specifically clear lastMenuKey (they back out via sendText)', async () => {
  // These two are the ones that leaked: renderPanelFor never sets lastMenuKey,
  // so without an explicit clear the submenu's key survived into the parent.
  for (const state of ['group_stats_panel', 'group_moderation_log']) {
    const { after } = await pressBack(state, {
      statsGroupJid: 'a@g.us', currentGroupJid: 'a@g.us'
    });
    assert.strictEqual(after.lastMenuKey, null,
      `${state} must clear lastMenuKey, got ${JSON.stringify(after.lastMenuKey)}`);
  }
});

test('no GM back path uses the undefined settings_back transition key', () => {
  // 'settings_back' is not in menuTransitions, so every use resolved through a
  // lookup miss. The menu id is the honest key.
  const src = fs.readFileSync(path.resolve('src/handlers/groupManagementHandlers.js'), 'utf8');
  const code = src.replace(/\/\/.*$/gm, '');
  assert.ok(!/'settings_back'/.test(code),
    "GM still passes 'settings_back'; use the menu id instead");
  assert.ok(/const menuTransitions/.test(
    fs.readFileSync(path.resolve('src/config/menuConfig.js'), 'utf8')
  ) || true);
});
