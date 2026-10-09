// Group Management routing: who owns each input, and when the fall-through
// guard is allowed to fire.
//
// Regression cover for the guard overreach: the guard used to run immediately
// after handleGroupManagementReply, so for the TOP-LEVEL group_management menu
// -- which has no case in that handler -- it fired on every input and answered
// "Something went wrong" instead of letting the menu resolver run options 1-7.
import { test, before, after } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import os from 'os';
import path from 'path';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gm-routing-test-'));
process.env.GROUP_DATA_PATH = path.join(tmpDir, 'groups.json');
process.env.GROUP_DEFAULTS_DATA_PATH = path.join(tmpDir, 'groupDefaults.json');
process.env.GROUP_STATS_DATA_PATH = path.join(tmpDir, 'groupStats.json');

const registry = await import('../src/config/menus/registry.js');
await import('../src/config/menus/index.js');
const gm = await import('../src/handlers/groupManagementHandlers.js');
const menuRouter = await import('../src/utils/menuRouter.js');

const GM_MENU = 'group_management';
const GUARD_MSG = 'something went wrong';

// Dozens of replies go through one sender JID here, which would trip the
// 8/min per-chat outbound cap and make routing look like it did nothing.
before(async () => {
  const config = (await import('../src/config/config.js')).default;
  config.rateLimit.enabled = false;
});
after(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function makeSock() {
  const sent = [];
  return {
    sent,
    sendMessage: async (jid, content) => { sent.push(String(content?.text ?? '')); return { key: { id: 'k' + sent.length } }; },
    sendPresenceUpdate: async () => {},
    readMessages: async () => true
  };
}

function ctx(state, extra = {}) {
  const sock = makeSock();
  return {
    sock,
    sender: '999@lid',
    chatId: '999@lid',
    user: { jid: '999@lid', language: 'en' },
    session: { currentMenu: state, ...extra }
  };
}

const guardFired = (sock) => sock.sent.some((m) => m.toLowerCase().includes(GUARD_MSG));
const chatRuleFired = (sock) => sock.sent.some((m) => m.toLowerCase().includes('hi, sup'));

/**
 * Mirrors the guard's predicate in src/index.js: a group_* state that is not a
 * registered menu AND is not claimed by the handler.
 */
function guardWouldFire(state, handled) {
  if (handled === true) return false;
  return state.startsWith('group_') && !registry.getMenu(state);
}

// ---------------------------------------------------------------------------
// 1. Top-level Group Management menu -- owned by the menu resolver
// ---------------------------------------------------------------------------

test('1. top-level GM menu: the handler declines so the resolver can run it', async () => {
  for (const input of ['1', '2', '3', '4', '5', '6', '7', '0', '99', 'hi']) {
    const c = ctx(GM_MENU);
    const handled = await gm.handleGroupManagementReply(c, input);
    assert.strictEqual(handled, false,
      `input "${input}" must be declined by the GM handler, not handled`);
    assert.strictEqual(guardWouldFire(GM_MENU, handled), false,
      `guard must not fire for the top-level menu on "${input}"`);
    assert.ok(!guardFired(c.sock), `guard message sent on "${input}"`);
  }
});

test('1b. every GM option resolves to a registered custom handler', () => {
  for (const opt of registry.getMenu(GM_MENU).options) {
    const res = menuRouter.resolveMenuOption(GM_MENU, opt.number, { jid: '999@lid' }, 'en');
    assert.strictEqual(res.kind, 'action', `option ${opt.number}`);
    assert.ok(res.action.startsWith('custom:'), `option ${opt.number} is not a custom action`);
  }
});

test('2. top-level GM menu: 0 goes back to the main menu', () => {
  const res = menuRouter.resolveMenuOption(GM_MENU, '0', { jid: '999@lid' }, 'en');
  assert.strictEqual(res.kind, 'back');
  assert.strictEqual(res.to, 'main_menu', '0 must leave Group Management entirely');
});

test('2b. invalid input inside the top-level GM menu is invalid, not a guard', () => {
  for (const input of ['99', 'hi']) {
    const res = menuRouter.resolveMenuOption(GM_MENU, input, { jid: '999@lid' }, 'en');
    assert.strictEqual(res.kind, 'invalid', `"${input}" should resolve as invalid`);
  }
});

// ---------------------------------------------------------------------------
// 2. Sub-panel states -- owned by the GM handler
// ---------------------------------------------------------------------------

test('3. sub-panel states are handled by the GM handler', async () => {
  const states = [
    'group_settings_panel', 'group_settings_language',
    'group_defaults_panel', 'group_stats_about',
    'group_stats_panel', 'group_stats_aggregate', 'group_moderation_log'
  ];
  for (const state of states) {
    const c = ctx(state, { currentGroupJid: 'g@g.us', statsGroupJid: 'g@g.us' });
    const handled = await gm.handleGroupManagementReply(c, '0');
    assert.strictEqual(handled, true, `${state} was not handled`);
    assert.strictEqual(guardWouldFire(state, handled), false);
    assert.ok(c.sock.sent.length > 0, `${state} sent nothing on 0`);
    assert.ok(!guardFired(c.sock), `${state} hit the guard`);
  }
});

test('3b. group_moderation sub-states are handled too', async () => {
  for (const state of ['group_moderation_group', 'group_moderation_user', 'group_moderation_action']) {
    const c = ctx(state, { currentGroupJid: 'g@g.us', pendingGroupJid: 'u@lid' });
    const handled = await gm.handleGroupManagementReply(c, '0');
    assert.notStrictEqual(handled, false, `${state} fell through`);
    assert.ok(!guardFired(c.sock), `${state} hit the guard`);
  }
});

test('4. sub-panel invalid input keeps the panel and never guards', async () => {
  for (const state of ['group_stats_about', 'group_stats_aggregate', 'group_stats_panel', 'group_moderation_log']) {
    const c = ctx(state, { currentGroupJid: 'g@g.us', statsGroupJid: 'g@g.us' });
    const handled = await gm.handleGroupManagementReply(c, '99');
    assert.strictEqual(handled, true, `${state} fell through on invalid input`);
    assert.ok(!guardFired(c.sock), `${state} hit the guard on invalid input`);
    assert.ok(c.sock.sent.length > 0, `${state} sent nothing`);
  }
});

test('a settings toggle is handled and the panel re-renders', async () => {
  const { activateGroup } = await import('../src/services/groupService.js');
  activateGroup('g@g.us', { name: 'Dev', activatedBy: 'a@lid' });
  const c = ctx('group_settings_panel', { currentGroupJid: 'g@g.us' });
  const handled = await gm.handleGroupManagementReply(c, '2');
  assert.strictEqual(handled, true);
  assert.ok(!guardFired(c.sock));
});

// ---------------------------------------------------------------------------
// 3. The guard still catches genuinely unknown states
// ---------------------------------------------------------------------------

test('5. an unknown group_* state fires the guard', async () => {
  for (const input of ['0', 'hi', '99']) {
    const c = ctx('group_unknown_panel');
    const handled = await gm.handleGroupManagementReply(c, input);
    assert.strictEqual(handled, false, 'the handler must decline an unknown state');
    assert.strictEqual(guardWouldFire('group_unknown_panel', handled), true,
      `guard should fire for an unknown state on "${input}"`);
    assert.ok(!registry.getMenu('group_unknown_panel'), 'must not be a registered menu');
  }
});

test('5b. a state that is not group_* is left to the normal DM path', () => {
  assert.strictEqual(guardWouldFire('main_menu', false), false);
  assert.strictEqual(guardWouldFire('settings', false), false);
});

// ---------------------------------------------------------------------------
// 4. Chat rules never fire from any group state
// ---------------------------------------------------------------------------

test('6. no group state lets an input reach chat rules', async () => {
  const states = [
    GM_MENU,
    'group_settings_panel',
    'group_stats_about',
    'group_moderation',
    'group_unknown_panel'
  ];
  for (const state of states) {
    const c = ctx(state, { currentGroupJid: 'g@g.us', statsGroupJid: 'g@g.us' });
    const handled = await gm.handleGroupManagementReply(c, 'hi');
    const fires = guardWouldFire(state, handled);

    // Somebody must own the input. For a sub-panel that is the GM handler; for
    // the top-level registered menu it is the generic menu resolver (which runs
    // later in the router and answers "invalid"); for an unknown group_* state it
    // is the guard. What must never happen is nobody answering and the input
    // reaching chat rules.
    const resolverOwnsIt = !handled && !fires && !!registry.getMenu(state)
      && menuRouter.resolveMenuOption(state, 'hi', { jid: '999@lid' }, 'en').kind === 'invalid';
    const claimed = c.sock.sent.length > 0 || fires || resolverOwnsIt;
    assert.ok(claimed, `${state} produced no reply and no guard`);
    assert.ok(!chatRuleFired(c.sock), `${state} leaked to chat rules`);
  }
});

test('7. the group guard is gated on "no registered menu" in index.js', () => {
  const src = fs.readFileSync(path.resolve('src/index.js'), 'utf8');
  assert.ok(src.includes('[GROUP] handler fell through'), 'guard log line missing');
  assert.ok(
    /!getMenu\(session\.currentMenu\)/.test(src),
    'the guard must be skipped for states that are registered menus'
  );
  // The guard must run AFTER the handler, not instead of it.
  const handlerIdx = src.indexOf('await handleGroupManagementReply(');
  const guardIdx = src.indexOf('[GROUP] handler fell through');
  assert.ok(handlerIdx > -1 && guardIdx > handlerIdx,
    'the handler must be tried before the guard');
});

test('8. the DM menu guard is still after the generic resolver', () => {
  const src = fs.readFileSync(path.resolve('src/index.js'), 'utf8');
  const resolverIdx = src.indexOf('const genericResult = resolveMenuOption(');
  const dmGuardIdx = src.indexOf('[ROUTER] menu state fell through');
  const freeTextIdx = src.indexOf('handleFreeText(');
  assert.ok(resolverIdx > -1 && dmGuardIdx > resolverIdx,
    'the DM guard must sit after the menu resolver');
  assert.ok(freeTextIdx > dmGuardIdx, 'the DM guard must sit before free text');
});

test('9. group_stats prefix fix is still in place', () => {
  const src = fs.readFileSync(path.resolve('src/index.js'), 'utf8');
  assert.ok(src.includes("'group_stats'"), 'index.js lost the group_stats prefix');
  for (const p of ['group_management', 'group_settings', 'group_defaults', 'group_moderation', 'group_stats']) {
    assert.ok(gm.GROUP_STATE_PREFIXES.includes(p), `GROUP_STATE_PREFIXES lost ${p}`);
    assert.ok(src.includes(`'${p}'`), `index.js lost ${p}`);
  }
});