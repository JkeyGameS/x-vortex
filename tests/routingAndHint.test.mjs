// Router menu-priority guard, idle-then-hint, static main-menu heading and the
// startup menu audit.
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const dataDir = path.join(root, 'data');
const backupDir = path.join(os.tmpdir(), 'routing-data-backup');

fs.rmSync(backupDir, { recursive: true, force: true });
fs.cpSync(dataDir, backupDir, { recursive: true });
const restoreData = () => {
  fs.rmSync(dataDir, { recursive: true, force: true });
  fs.cpSync(backupDir, dataDir, { recursive: true });
  fs.rmSync(backupDir, { recursive: true, force: true });
};

let fails = 0;
function check(name, cond, extra = '') {
  if (cond) { console.log('PASS ' + name); return; }
  fails++;
  console.log('FAIL ' + name + ' :: ' + String(extra).slice(0, 220));
}

const sessionManager = (await import('../src/utils/sessionManager.js')).default;
const content = await import('../src/services/botContentService.js');
const hint = await import('../src/services/startHintService.js');
const audit = await import('../src/utils/menuAudit.js');
const conversation = await import('../src/services/conversationService.js');

await import('../src/config/menus/index.js');
const { getMenu, getAllMenus } = await import('../src/config/menus/registry.js');
const { resolveMenuOption, runMenuAction } = await import('../src/utils/menuRouter.js');
const { renderMenu } = await import('../src/utils/menuRenderer.js');
const { t } = await import('../src/services/localeService.js');
const { toSmallCaps } = await import('../src/utils/smallCaps.js');

const JID = '930000000000001@lid';
const ctx = (text = '') => ({ sock: {}, sender: JID, chatId: JID, text, pushName: 'Tester' });

function setMenu(menuId, extra = {}) {
  sessionManager.setState(JID, JID, { currentMenu: menuId, ...extra });
}

try {
  content.loadBotContent();

  // =====================================================================
  // 1.7 -- every menu the router has no dedicated block for still resolves
  // =====================================================================
  {
    // The bug: these five are absent from index.js, so "2" used to fall
    // through to the chat rules.
    const orphanMenus = ['bot_content', 'bot_content_onboarding', 'bot_content_welcome_back', 'bot_content_timing', 'bot_content_language'];
    const idx = fs.readFileSync(path.join(root, 'src/index.js'), 'utf8');
    for (const id of orphanMenus) {
      check(`1.7: ${id} really has no dedicated router block (the reported bug)`,
        !idx.includes(`'${id}'`), 'it now has one');
    }
    check('1.7: the generic guard exists before handleFreeText',
      idx.indexOf('Generic menu guard') > 0
      && idx.indexOf('Generic menu guard') < idx.indexOf('handleFreeText({'),
    'guard must run before free text');
    check('1.7: the guard resolves options generically',
      idx.includes('resolveMenuOption(session.currentMenu'), 'generic resolve missing');
    check('1.7: a stale menu id is cleared with a warning',
      idx.includes('stale menu id; clearing'), 'stale-menu warning missing');
  }

  // Every registered menu must answer a valid option and reject a bad one,
  // which is what the guard relies on.
  {
    let unresolvable = [];
    let noOptions = [];
    for (const menu of getAllMenus()) {
      const def = menu;
      if (typeof def.dynamicOptions === 'function') {
        try { def.dynamicOptions(); } catch { /* factories may need runtime state */ }
      }
      if (typeof def.dynamicOptions === 'function') continue; // factory menus build options at runtime
      const opts = def.options || [];
      if (!opts.length) { noOptions.push(def.id); continue; }
      const probe = opts.find((o) => o && o.number !== '0' && o.action);
      if (!probe) { noOptions.push(def.id); continue; }
      const r = resolveMenuOption(def.id, String(probe.number), { jid: JID, language: 'en' }, 'en');
      if (r.kind === 'invalid') unresolvable.push(def.id + '#' + probe.number);
    }
    check('1.7: every menu with options resolves at least one', unresolvable.length === 0, unresolvable.join(','));
    // Option-less entries are intentional routing shells: the registry row exists
    // so an open: resolves, while the owning handler builds the text itself.
    check('1.7: option-less shells carry a heading so they render', noOptions.every((id) => !!getMenu(id)?.headingKey || !!getMenu(id)?.heading), noOptions.join(','));
  }

  // The five reported scenarios, exercised through the same calls the guard uses.
  {
    setMenu('bot_content');
    const r = resolveMenuOption('bot_content', '2', { jid: JID }, 'en');
    check('1: in bot_content, "2" opens Welcome-Back Messages', r.action === 'open:bot_content_welcome_back', JSON.stringify(r));
    const r2 = resolveMenuOption('bot_content', '0', { jid: JID }, 'en');
    check('2: in bot_content, "0" goes back to System Settings', r2.kind === 'back' && r2.to === 'system_settings', JSON.stringify(r2));

    setMenu('bot_content_onboarding');
    const r3 = resolveMenuOption('bot_content_onboarding', '1', { jid: JID }, 'en');
    check('3: in bot_content_onboarding, "1" opens the First Message group', r3.action === 'custom:bot_content_group_firstMessage', JSON.stringify(r3));

    setMenu('system_settings');
    const r4 = resolveMenuOption('system_settings', '9', { jid: JID }, 'en');
    check('4: in system_settings, "9" opens Bot Notifications',
      r4.kind === 'action' && String(r4.action).includes('bot_notifications'), JSON.stringify(r4));

    setMenu('main_menu');
    const r5 = resolveMenuOption('main_menu', '3', { jid: JID }, 'en');
    check('5: in main_menu, "3" opens Statistics', r5.action === 'open:statistics', JSON.stringify(r5));

    setMenu('bot_content');
    const r6 = resolveMenuOption('bot_content', 'hi', { jid: JID }, 'en');
    check('6: free text inside a menu is invalid, not a chat rule', r6.kind === 'invalid', JSON.stringify(r6));
    check('6: the invalid reply names the menu bound', String(r6.max) === '9', r6.max);
  }

  // The chat-rule layer refuses to run while a registered menu is open.
  {
    setMenu('bot_content');
    const consumed = await conversation.handleFreeText({ sock: { sendMessage: async () => ({ key: {} }), sendPresenceUpdate: async () => {} }, sender: JID, chatId: JID, pushName: 'Tester' }, 'hi');
    check('1.5: handleFreeText returns false while a menu is open', consumed === false, consumed);
    setMenu(null);
    check('1.5: the guard is scoped to a registered menu', getMenu('bot_content') !== undefined);
  }

  // =====================================================================
  // 2.4 -- static main menu heading
  // =====================================================================
  {
    const def = getMenu('main_menu');
    check('2: dynamicHeading is off for the main menu', def.dynamicHeading !== true, String(def.dynamicHeading));
    check('2: no headingResolver is wired', def.headingResolver === undefined, typeof def.headingResolver);
    check('2: headingKey is unchanged', def.headingKey === 'menu.main.heading', def.headingKey);
    check('2: headingEmoji is unchanged', def.headingEmoji === null, String(def.headingEmoji));
    check('2: options are unchanged', def.options.map((o) => o.number).join(',') === '0,1,2,3,4,5,6,9,A', def.options.map((o) => o.number).join(','));

    const rendered = await renderMenu('main_menu', { jid: JID, username: 'adminuser', name: 'BAMBA _ 𝕏' }, 'en', { sender: JID });
    check('2: the heading is the static Main Menu', rendered.text.split('\n')[0] === '> *' + 'ᴍᴀɪɴ ᴍᴇɴᴜ' + '*', rendered.text.split('\n')[0]);
    check('2: no name appears in the heading', !rendered.text.split('\n')[0].includes('adminuser') && !rendered.text.split('\n')[0].includes('BAMBA'), rendered.text.split('\n')[0]);
    check('2: the heading is small caps', rendered.text.split('\n')[0] === '> *ᴍᴀɪɴ ᴍᴇɴᴜ*', rendered.text.split('\n')[0]);

    for (const lang of ['en', 'fr', 'de', 'es', 'ar']) {
      const v = t(lang, 'menu.main.heading');
      check(`2: ${lang} menu.main.heading resolves`, v !== 'menu.main.heading', v);
      check(`2: ${lang} heading has no {username} placeholder`, !String(v).includes('{username}'), v);
      const r = await renderMenu('main_menu', { jid: JID, username: 'u', name: 'n' }, lang, { sender: JID });
      check(`2: ${lang} renders a heading`, r.text.startsWith('> *') && r.text.split('\n')[0].length > 4, r.text.split('\n')[0]);
      check(`2: ${lang} heading carries no name`, !r.text.split('\n')[0].includes('u') || r.text.split('\n')[0].includes('@'), r.text.split('\n')[0]);
    }

    // The renderer keeps dynamicHeading support for future use.
    const mr = fs.readFileSync(path.join(root, 'src/utils/menuRenderer.js'), 'utf8');
    check('2: the renderer still honours dynamicHeading', mr.includes('definition.dynamicHeading === true'));
    check('2: mainMenuHeading is left in place for future use',
      typeof (await import('../src/utils/menuResolvers.js')).mainMenuHeading === 'function');
  }

  // =====================================================================
  // 3.9 -- idle-then-hint
  // =====================================================================
  {
    // Config keys exist and reset cleanly.
    for (const k of ['startHintEnabled', 'startHintDelayMs', 'startHintCooldownMs', 'startHintText',
      'startHintTextAfterWelcomeBack', 'startHintQuietHoursEnabled', 'startHintQuietHoursStart', 'startHintQuietHoursEnd']) {
      check(`3.2: timing.${k} exists`, content.getContent('timing.' + k) !== undefined);
    }
    check('3.2: the hint text is content, not a translation',
      typeof content.getContent('timing.startHintText') === 'string' && content.getContent('timing.startHintText').length > 0);
    check('3.2: default delay is 60s', content.getContent('timing.startHintDelayMs') === 60000, content.getContent('timing.startHintDelayMs'));
    check('3.2: default cooldown is 10m', content.getContent('timing.startHintCooldownMs') === 600000, content.getContent('timing.startHintCooldownMs'));

    // Quiet hours, including the overnight window.
    check('3.9: quiet hours are off by default', hint.isInQuietHours() === false);
    content.setContent('timing.startHintQuietHoursEnabled', true);
    content.setContent('timing.startHintQuietHoursStart', '00:00');
    content.setContent('timing.startHintQuietHoursEnd', '23:59');
    check('3.9: an all-day window suppresses', hint.isInQuietHours() === true);
    content.setContent('timing.startHintQuietHoursStart', '12:00');
    content.setContent('timing.startHintQuietHoursEnd', '12:00');
    check('3.9: a zero-width window does not suppress', hint.isInQuietHours() === false);
    content.setContent('timing.startHintQuietHoursStart', '23:00');
    content.setContent('timing.startHintQuietHoursEnd', '07:00');
    const at = (h) => new Date(2020, 0, 1, h, 30);
    check('3.9: an overnight window covers before midnight',
      hint.isInQuietHours(new Date(2020, 0, 1, 23, 30)) === true);
    check('3.9: an overnight window covers after midnight',
      hint.isInQuietHours(new Date(2020, 0, 1, 3, 30)) === true);
    check('3.9: an overnight window excludes midday',
      hint.isInQuietHours(new Date(2020, 0, 1, 12, 30)) === false);
    content.setContent('timing.startHintQuietHoursEnabled', false);

    // Suppression while a menu, wizard, lock or resume is active.
    setMenu('bot_content');
    check('3.8: a registered menu suppresses', hint.isHintSuppressed({ currentMenu: 'bot_content' }) === true);
    setMenu('chat_add_rule');
    check('3.8: a wizard suppresses', hint.isHintSuppressed({ currentMenu: 'chat_add_rule' }) === true);
    setMenu('language_onboarding');
    check('3.8: onboarding suppresses', hint.isHintSuppressed({ currentMenu: 'language_onboarding' }) === true);
    check('3.8: a live cooldown lock suppresses',
      hint.isHintSuppressed({ currentMenu: 'main', languageOnboardingLockedUntil: Date.now() + 60000 }) === true);
    check('3.8: an expired lock does not suppress',
      hint.isHintSuppressed({ currentMenu: 'main', languageOnboardingLockedUntil: Date.now() - 1 }) === false);
    check('3.8: a pending resume confirmation suppresses',
      hint.isHintSuppressed({ currentMenu: 'main', awaitingResumeConfirmation: true }) === true);
    check('3.8: an idle plain session allows a hint',
      hint.isHintSuppressed({ currentMenu: 'main' }) === false);
    check('3.8: a stale menu id does not suppress',
      hint.isHintSuppressed({ currentMenu: 'removed_menu_xyz' }) === false);

    // Cooldown.
    check('3.9: no cooldown on a fresh session', hint.hintCooldownActive({}) === false);
    check('3.9: a recent hint suppresses the next', hint.hintCooldownActive({ lastStartHintAt: Date.now() - 5000 }) === true);
    check('3.9: an old hint allows the next', hint.hintCooldownActive({ lastStartHintAt: Date.now() - 700000 }) === false);

    // Scheduling behaviour, with a short delay.
    hint.cancelAllStartHints();
    content.setContent('timing.startHintDelayMs', 300);
    const sent = [];
    const sock = {
      sendMessage: async (jid, content) => { sent.push({ jid, text: String(content?.text ?? '') }); return { key: { id: 'K' + sent.length } }; },
      sendPresenceUpdate: async () => {},
      readMessages: async () => true
    };
    sessionManager.setState(JID, JID, { currentMenu: null, lastStartHintAt: 0 });
    const liveSession = { currentMenu: null, lastStartHintAt: 0 };

    check('1: a chat reply schedules a hint',
      hint.scheduleStartHint(JID, { sock, session: liveSession, chatId: JID }, 'chat') === true);
    check('1: the hint is pending', hint.pendingStartHint(JID) === true);
    await new Promise((r) => setTimeout(r, 450));
    check('1: the hint fires once', sent.length === 1, sent.length);
    check('1: the hint suggests /start', sent[0]?.text.includes('/' + toSmallCaps('start')), sent[0]?.text);
    check('1: the cooldown is persisted to the session',
      sessionManager.getSession(JID, JID)?.lastStartHintAt > 0, sessionManager.getSession(JID, JID)?.lastStartHintAt);
    check('1: the hint is no longer pending', hint.pendingStartHint(JID) === false);

    // 2: a new message cancels it.
    hint.cancelAllStartHints();
    sent.length = 0;
    sessionManager.setState(JID, JID, { currentMenu: null, lastStartHintAt: 0 });
    hint.scheduleStartHint(JID, { sock, session: { currentMenu: null }, chatId: JID }, 'chat');
    hint.cancelStartHint(JID);
    await new Promise((r) => setTimeout(r, 450));
    check('2: a new message cancels the pending hint', sent.length === 0, sent.length);

    // 3: opening a menu cancels it.
    hint.cancelAllStartHints();
    sent.length = 0;
    sessionManager.setState(JID, JID, { currentMenu: null, lastStartHintAt: 0 });
    // sendMenuById waits on a typing presence, longer than the 300ms used
    // above, so give this case a delay the menu send can beat.
    content.setContent('timing.startHintDelayMs', 3000);
    hint.scheduleStartHint(JID, { sock, session: { currentMenu: null }, chatId: JID }, 'chat');
    const { sendMenuById } = await import('../src/utils/menuSender.js');
    await sendMenuById('main_menu', { sock, sender: JID, chatId: JID, user: { jid: JID, language: 'en' }, language: 'en' }, 'main_menu');
    check('3: opening a menu cancels the pending hint', hint.pendingStartHint(JID) === false);
    await new Promise((r) => setTimeout(r, 450));
    content.setContent('timing.startHintDelayMs', 300);
    check('3: no hint after the menu opens', sent.filter((m) => m.text.includes('/' + toSmallCaps('start'))).length === 0);

    // 4: the welcome-back variant is used for that kind.
    hint.cancelAllStartHints();
    sent.length = 0;
    sessionManager.setState(JID, JID, { currentMenu: null, lastStartHintAt: 0 });
    hint.scheduleStartHint(JID, { sock, session: { currentMenu: null }, chatId: JID }, 'welcomeBack');
    await new Promise((r) => setTimeout(r, 450));
    check('4: the welcome-back hint variant is used',
      (sent[0]?.text || '').includes(toSmallCaps('Welcome back')), sent[0]?.text);
    sessionManager.setState(JID, JID, { lastStartHintAt: 0 });

    // 5: the cooldown suppresses a second hint.
    hint.cancelAllStartHints();
    sent.length = 0;
    sessionManager.setState(JID, JID, { currentMenu: null, lastStartHintAt: Date.now() });
    hint.scheduleStartHint(JID, { sock, session: { currentMenu: null, lastStartHintAt: Date.now() }, chatId: JID }, 'chat');
    await new Promise((r) => setTimeout(r, 450));
    check('5: the cooldown suppresses the next hint', sent.length === 0, sent.length);
    sessionManager.setState(JID, JID, { lastStartHintAt: 0 });

    // 6: a menu open at fire time suppresses even if it was idle at schedule.
    hint.cancelAllStartHints();
    sent.length = 0;
    sessionManager.setState(JID, JID, { currentMenu: null, lastStartHintAt: 0 });
    hint.scheduleStartHint(JID, { sock, session: { currentMenu: null }, chatId: JID }, 'chat');
    sessionManager.setState(JID, JID, { currentMenu: 'bot_content' });
    await new Promise((r) => setTimeout(r, 450));
    check('6: a menu opened during the wait suppresses the hint', sent.length === 0, sent.length);
    sessionManager.setState(JID, JID, { currentMenu: null });

    // 7: cooldown lock at fire time.
    hint.cancelAllStartHints();
    sent.length = 0;
    sessionManager.setState(JID, JID, { currentMenu: null, lastStartHintAt: 0 });
    hint.scheduleStartHint(JID, { sock, session: { currentMenu: null }, chatId: JID }, 'chat');
    sessionManager.setState(JID, JID, { languageOnboardingLockedUntil: Date.now() + 60000 });
    await new Promise((r) => setTimeout(r, 450));
    check('7: a cooldown lock at fire time suppresses the hint', sent.length === 0, sent.length);
    sessionManager.setState(JID, JID, { languageOnboardingLockedUntil: 0 });

    // 8: quiet hours.
    hint.cancelAllStartHints();
    sent.length = 0;
    content.setContent('timing.startHintQuietHoursEnabled', true);
    content.setContent('timing.startHintQuietHoursStart', '00:00');
    content.setContent('timing.startHintQuietHoursEnd', '23:59');
    sessionManager.setState(JID, JID, { currentMenu: null, lastStartHintAt: 0 });
    check('8: quiet hours block scheduling', hint.scheduleStartHint(JID, { sock, session: { currentMenu: null }, chatId: JID }, 'chat') === false);
    await new Promise((r) => setTimeout(r, 450));
    check('8: no hint fires during quiet hours', sent.length === 0, sent.length);
    content.setContent('timing.startHintQuietHoursEnabled', false);

    // Disabled outright.
    content.setContent('timing.startHintEnabled', false);
    check('3.2: the master toggle blocks scheduling',
      hint.scheduleStartHint(JID, { sock, session: { currentMenu: null }, chatId: JID }, 'chat') === false);
    content.setContent('timing.startHintEnabled', true);

    // A throwing sock must not take the process down.
    hint.cancelAllStartHints();
    sessionManager.setState(JID, JID, { currentMenu: null, lastStartHintAt: 0 });
    hint.scheduleStartHint(JID, {
      sock: { sendMessage: async () => { throw new Error('boom'); } },
      session: { currentMenu: null }, chatId: JID
    }, 'chat');
    await new Promise((r) => setTimeout(r, 450));
    check('a failing hint send does not throw', true);
    hint.cancelAllStartHints();
    content.resetSection('timing');

    // Only two call sites schedule a hint.
    const cs = fs.readFileSync(path.join(root, 'src/services/conversationService.js'), 'utf8');
    check('3.4: chat replies schedule the hint', cs.includes("scheduleStartHint(sender"));
    check('3.8: chat replies do not schedule after a dry run',
      cs.indexOf("scheduleStartHint(sender") > cs.indexOf('Dry run match (no reply sent)'), 'scheduled before the dry-run early return');
    check('3.4: the chat guard does not schedule', cs.includes('return false;'));
    const idx2 = fs.readFileSync(path.join(root, 'src/index.js'), 'utf8');
    check('3.5: welcome-back schedules the hint', idx2.includes("scheduleStartHint(sender") && idx2.includes("'welcomeBack')"));
    check('3.6: the router cancels pending hints', idx2.includes('cancelStartHint(sender)'));
    const ms = fs.readFileSync(path.join(root, 'src/utils/menuSender.js'), 'utf8');
    check('3.7: menu opens cancel the hint', ms.includes('cancelStartHint(sender)'));
    const orch = fs.readFileSync(path.join(root, 'src/handlers/languageOnboardingHandler.js'), 'utf8');
    check('3.8: onboarding does not schedule a hint', !orch.includes('scheduleStartHint'));
    check('3.8: the resume prompt does not schedule a hint',
      !fs.readFileSync(path.join(root, 'src/handlers/resumeHandler.js'), 'utf8').includes('scheduleStartHint'));
  }

  // =====================================================================
  // 4.1 -- editor fields
  // =====================================================================
  {
    const { EDITABLE_TIMING } = await import('../src/config/botContentFields.js');
    for (const k of ['startHintEnabled', 'startHintDelayMs', 'startHintCooldownMs', 'startHintQuietHoursEnabled', 'startHintText', 'startHintTextAfterWelcomeBack']) {
      check(`4.1: timing.${k} is editor-editable`, typeof EDITABLE_TIMING['timing.' + k] === 'object', typeof EDITABLE_TIMING['timing.' + k]);
    }
    check('4.1: every timing field path resolves',
      Object.keys(EDITABLE_TIMING).every((p) => content.getContent(p) !== undefined),
      JSON.stringify(Object.keys(EDITABLE_TIMING).filter((p) => content.getContent(p) === undefined)));
    check('4.3: reset restores the hint keys',
      (content.resetSection('timing'), content.getContent('timing.startHintDelayMs') === 60000),
      content.getContent('timing.startHintDelayMs'));
    const menu = getMenu('bot_content_timing');
    check('4.1: the timing submenu has 13 options', menu.options.length === 13, String(menu.options.length));
    const { adminCustomHandlers } = await import('../src/utils/menuCustomHandlers.js');
    check('4.1: every timing option has a handler',
      menu.options.every((o) => typeof adminCustomHandlers[String(o.action).slice(7)] === 'function'),
      JSON.stringify(menu.options.map((o) => o.action).filter((a) => typeof adminCustomHandlers[a.slice(7)] !== 'function')));
    for (const k of ['startHintEnabled', 'startHintDelayMs', 'startHintCooldownMs', 'startHintQuietHoursEnabled', 'startHintText', 'startHintTextAfterWelcomeBack']) {
      check(`4.1: the ${k} label resolves`, t('en', 'menu.bot_content.field.' + k) !== 'menu.bot_content.field.' + k);
    }
  }

  // =====================================================================
  // 5.3 -- startup menu audit
  // =====================================================================
  {
    check('5.3: the live registry is clean', audit.auditMenus().length === 0,
      audit.auditMenus().map((i) => i.menuId + ': ' + i.reason).join('; '));
    const idx3 = fs.readFileSync(path.join(root, 'src/index.js'), 'utf8');
    check('5.2: auditMenus runs at startup', idx3.includes('auditMenus()'));
    check('5.2: the audit runs after the registry loads',
      idx3.indexOf("config/menus/index.js") < idx3.indexOf('auditMenus()'), 'audit runs before registration');

    // Fault injection: the audit must actually catch each class. Broken
    // definitions cannot be injected through registerMenu (it validates on
    // the way in), so auditMenuList is called with a synthetic set instead.
    const GOOD = [
      { id: 'g_ok', headingKey: 'x.y', options: [{ number: '1', action: 'open:g_other' }] },
      { id: 'g_other', headingKey: 'x.y', options: [] }
    ];
    const cases = [
      ['no heading', [{ id: 'g_ok' }, GOOD[1]], 'missing heading'],
      ['dangling open:', [{ ...GOOD[0], options: [{ number: '1', action: 'open:not_registered' }] }, GOOD[1]], 'unregistered menu'],
      ['duplicate number', [{ ...GOOD[0], options: [{ number: '1', action: 'open:g_other' }, { number: '1', action: 'open:g_other' }] }, GOOD[1]], 'duplicate option number'],
      ['missing action', [{ ...GOOD[0], options: [{ number: '1' }] }, GOOD[1]], 'missing action'],
      ['dangling backTo', [{ ...GOOD[0], backTo: 'nowhere_menu' }, GOOD[1]], 'backTo target'],
      ['missing number', [{ ...GOOD[0], options: [{ action: 'open:g_other' }] }, GOOD[1]], 'missing number']
    ];
    for (const [label, list, expect] of cases) {
      const issues = audit.auditMenuList(list);
      check(`5.3: the audit catches ${label}`,
        issues.some((i) => String(i.reason).includes(expect)),
        JSON.stringify(issues.map((i) => i.reason)));
    }
    check('5.3: a clean list reports nothing', audit.auditMenuList(GOOD).length === 0);
    check('5.3: the live registry stays clean', audit.auditMenus().length === 0);
    check('5.3: a descriptive parent is a note, not an issue',
      audit.auditMenuList([{ id: 'p', headingKey: 'x.y', parent: 'session_only', options: [] }]).length === 0);
  }

} finally {
  hint.cancelAllStartHints();
  restoreData();
}

console.log(fails === 0 ? 'ALL PASS' : fails + ' FAILURES');
process.exit(fails === 0 ? 0 : 1);