// Part 1: /try end interruption + personalized main-menu heading.
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const dataDir = path.join(root, 'data');
const backupDir = path.join(os.tmpdir(), 'part1-data-backup');

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

const ADMIN = '127531067904055@lid';
const { toSmallCaps } = await import('../src/utils/smallCaps.js');
const JID = '920000000000001@lid';

const { toSmallCaps: sc } = await import('../src/utils/smallCaps.js');
await import('../src/config/menus/index.js');
const sessionManager = (await import('../src/utils/sessionManager.js')).default;
const { getUserByJid } = await import('../src/services/userService.js');
const userService = await import('../src/services/userService.js');
const { renderMenu } = await import('../src/utils/menuRenderer.js');
const { mainMenuHeading } = await import('../src/utils/menuResolvers.js');
const onboard = await import('../src/handlers/languageOnboardingHandler.js');
const { endTrySession } = await import('../src/handlers/tryCommand.js');
const { menuTransitions } = await import('../src/config/menuConfig.js');

// The router regex, mirrored from src/index.js so a change there has to be
// mirrored here deliberately rather than silently diverging.
const TRY_CONTROL = /^\/try[\s]+(end|exit|stop)$/i;
const TRY_ANY = /^\/try(\s|$)/i;

function makeSock() {
  const sent = [];
  return {
    sent,
    sendMessage: async (jid, content) => {
      sent.push({ jid, text: String(content?.text ?? ''), edit: content?.edit, delete: content?.delete });
      if (content?.edit) return { key: content.edit };
      return { key: { id: 'K' + sent.length } };
    },
    sendPresenceUpdate: async () => {},
    readMessages: async () => true
  };
}

function testSession(overrides = {}) {
  return sessionManager.setState(ADMIN, ADMIN, {
    currentMenu: 'language_selection',
    isLanguageSelectionPending: true,
    isTestActive: true,
    isEndingTestSession: false,
    currentUserJid: JID,
    testSession: { testUserJid: JID, testName: 'Lukewarm123', testUsername: 'test_lukewarm123', adminLanguage: 'en' },
    onboardingStage: 'confirm_detected',
    detectedLanguage: null,
    detectedLanguageRaw: 'en-US',
    awaitingResumeConfirmation: true,
    cooldownJustExpired: false,
    resumeFromStage: 'confirm_detected',
    resumeAttempts: 2,
    languageOnboardingLockedUntil: Date.now() + 60000,
    idleClose: true,
    idleCloseUntil: Date.now() + 60000,
    ...overrides
  });
}

const stateOf = () => sessionManager.getSession(ADMIN, ADMIN) || {};

try {
  // =====================================================================
  // Section 1.4 -- /try end must interrupt anything
  // =====================================================================

  // Control words the intercept accepts.
  for (const cmd of ['/try end', '/try exit', '/try stop', '/TRY END', '/Try End']) {
    check(`recognizes "${cmd}"`, TRY_CONTROL.test(cmd), cmd);
  }
  for (const cmd of ['/try', '/try start', '/try purge', '/tryx end', 'end', '/help']) {
    check(`ignores "${cmd}"`, !TRY_CONTROL.test(cmd), cmd);
  }

  // The broad guard the language gate and onboarding gate use.
  for (const cmd of ['/try end', '/try', '/try anything']) {
    check(`broad guard matches "${cmd}"`, TRY_ANY.test(cmd), cmd);
  }
  for (const cmd of ['/tries', 'try end', '/start']) {
    check(`broad guard spares "${cmd}"`, !TRY_ANY.test(cmd), cmd);
  }

  // 4/6/7/8 -- the same result from the language menu, a live cooldown lock,
  // the onboarding confirmation stage, and a wizard: endTrySession always
  // clears state and restores identity.
  for (const [label, overrides] of [
    ['at the language-selection prompt', { currentMenu: 'language_selection', isLanguageSelectionPending: true }],
    ['while the cooldown lock is active', { currentMenu: 'language_onboarding', onboardingStage: 'locked', languageOnboardingLockedUntil: Date.now() + 300000 }],
    ['at the onboarding confirmation', { currentMenu: 'language_onboarding', onboardingStage: 'confirm_detected' }],
    ['mid-wizard', { currentMenu: 'chat_add_rule', isLanguageSelectionPending: false }]
  ]) {
    const sock = makeSock();
    await userService.ensureUserProfile({ jid: JID, name: 'Lukewarm123' });
    testSession(overrides);
    const before = stateOf();
    const wasTestActive = before.isTestActive === true;

    const res = await endTrySession({ sock, sender: ADMIN, chatId: ADMIN, pushName: 'Admin', text: '/try end' });
    const after = stateOf();

    check(`endTrySession succeeds ${label}`, res?.success === true, JSON.stringify(res));
    check(`try mode is off ${label}`, wasTestActive && after.isTestActive === false);
    check(`the test identity is cleared ${label}`, after.testSession === null, JSON.stringify(after.testSession));
    check(`currentUserJid is restored to the admin ${label}`, after.currentUserJid === ADMIN, after.currentUserJid);
    check(`the main menu is restored ${label}`, after.currentMenu === 'main', after.currentMenu);
    check(`awaitingResumeConfirmation is cleared ${label}`, after.awaitingResumeConfirmation === false, after.awaitingResumeConfirmation);
    check(`resumeFromStage is cleared ${label}`, after.resumeFromStage === null, after.resumeFromStage);
    check(`resumeAttempts is cleared ${label}`, (after.resumeAttempts || 0) === 0, after.resumeAttempts);
    check(`cooldownJustExpired is cleared ${label}`, after.cooldownJustExpired === false);
    check(`onboardingStage is cleared ${label}`, after.onboardingStage === null, after.onboardingStage);
    check(`the cooldown lock is released ${label}`, (after.languageOnboardingLockedUntil ?? 0) <= Date.now(), after.languageOnboardingLockedUntil);
    check(`detectedLanguage is cleared ${label}`, after.detectedLanguage === null, after.detectedLanguage);
    check(`detectedLanguageRaw is cleared ${label}`, after.detectedLanguageRaw === null, after.detectedLanguageRaw);
    check(`idleClose is cleared ${label}`, after.idleClose === false);
    check(`isEndingTestSession is released ${label}`, after.isEndingTestSession === false, after.isEndingTestSession);
    check(`the summary was sent ${label}`, sock.sent.length > 0, sock.sent.length);
    check(`the menu was edited or replaced, not stacked blindly ${label}`,
      sock.sent.some((m) => m.edit || m.delete) || sock.sent.length === 1,
      JSON.stringify(sock.sent.map((m) => ({ edit: Boolean(m.edit), del: Boolean(m.delete) }))));
  }

  // Step C: the end summary must reuse the hybrid transition, so the live
  // language menu is replaced rather than left on screen.
  check('try_end uses the hybrid edit-or-delete transition',
    menuTransitions?.try_end?.mode === 'edit' || menuTransitions?.try_end?.mode === 'hybrid',
    JSON.stringify(menuTransitions?.try_end));

  // 9 -- /start after ending reaches the real admin's main menu.
  {
    const rendered = await renderMenu('main_menu', await getUserByJid(ADMIN), 'en', { sender: ADMIN });
    check('9: the main menu renders for the real admin after /try end',
      rendered.text.startsWith('> *'), rendered.text.split('\n')[0]);
  }

  // 11 -- /try end outside try mode is a no-op that still answers.
  {
    const sock = makeSock();
    sessionManager.setState(ADMIN, ADMIN, { isTestActive: false, testSession: null, currentMenu: 'main', isEndingTestSession: false });
    const res = await endTrySession({ sock, sender: ADMIN, chatId: ADMIN, pushName: 'Admin', text: '/try end' });
    check('11: endTrySession reports failure when no session is active', res?.success === false, JSON.stringify(res));
    check('11: it says there is no active session', sock.sent.some((m) => m.text.length > 0), JSON.stringify(sock.sent.map((m) => m.text)));
    check('11: the router intercept would not fire (isTestActive false)', !(TRY_CONTROL.test('/try end') && stateOf().isTestActive));
  }

  // Step B -- the onboarding gate must hand /try back, not consume it.
  for (const stage of ['confirm_detected', 'awaiting_retry', 'locked']) {
    const sock = makeSock();
    await userService.ensureUserProfile({ jid: JID, name: 'Lukewarm123' });
    sessionManager.setState(JID, JID, {
      currentMenu: 'language_onboarding',
      onboardingStage: stage,
      detectedLanguage: 'en',
      onboardingAttempts: 0,
      languageOnboardingLockedUntil: stage === 'locked' ? Date.now() + 300000 : null
    });
    const consumed = await onboard.handleLanguageOnboardingGate(
      { sock, sender: JID, chatId: JID, pushName: 'Admin', text: '/try end' },
      sessionManager.getSession(JID, JID),
      { ...(await getUserByJid(JID)), language: null }
    );
    check(`the onboarding gate does not consume "/try end" at stage ${stage}`, consumed === false, consumed);
    check(`no onboarding reply is sent at stage ${stage}`, sock.sent.length === 0, JSON.stringify(sock.sent.map((m) => m.text)));
  }

  // =====================================================================
  // Main-menu heading. This was personalised ("Hello @user") when Part 1
  // landed and has since been reverted to the static heading; the assertions
  // below cover the current behaviour plus the renderer support that stays in
  // place for future menus.
  // =====================================================================
  const headingOf = async (user, lang = 'en') => {
    const r = await renderMenu('main_menu', user, lang, { sender: user?.jid || '1@lid' });
    return r.text.split('\n')[0];
  };

  const STATIC_HEADING = '> *' + toSmallCaps('Main Menu') + '*';

  check('2: a username user sees the static heading',
    await headingOf({ jid: '1@lid', username: 'adminuser', name: 'Ignored' }) === STATIC_HEADING,
    await headingOf({ jid: '1@lid', username: 'adminuser', name: 'Ignored' }));
  check('2: a name-only user sees the static heading',
    await headingOf({ jid: '1@lid', username: null, name: 'BAMBA _ 𝕏' }) === STATIC_HEADING,
    await headingOf({ jid: '1@lid', username: null, name: 'BAMBA _ 𝕏' }));
  check('2: a user with neither sees the static heading',
    await headingOf({ jid: '1@lid', username: null, name: '' }) === STATIC_HEADING,
    await headingOf({ jid: '1@lid', username: null, name: '' }));
  check('2: a null user sees the static heading', await headingOf(null) === STATIC_HEADING, await headingOf(null));
  check('2: the heading carries no username', !STATIC_HEADING.includes('adminuser') && !STATIC_HEADING.includes('BAMBA'));
  check('2: mainMenuHeading still exists for future menus',
    typeof mainMenuHeading({ username: 'u' }) === 'string' && mainMenuHeading({ username: 'u' }).length > 0,
    typeof mainMenuHeading);
  check('2: the definition no longer opts into a dynamic heading',
    (await import('../src/config/menus/registry.js')).getMenu('main_menu').dynamicHeading !== true);

  // 6 -- option numbers and labels unchanged. Asserted on the definition
  // rather than the render, because the admin row (A) is feature-gated and
  // legitimately absent for a non-admin user.
  {
    const { getMenu } = await import('../src/config/menus/registry.js');
    const def = getMenu('main_menu');
    check('6: the option numbers are unchanged',
      JSON.stringify(def.options.map((o) => o.number)) === JSON.stringify(['0', '1', '2', '3', '4', '5', '6', '9', 'A']),
      JSON.stringify(def.options.map((o) => o.number)));
    check('6: the option actions are unchanged',
      def.options.every((o) => o.action !== undefined && o.labelKey),
      JSON.stringify(def.options.map((o) => o.action)));
    const r = await renderMenu('main_menu', { jid: '1@lid', username: 'adminuser', name: 'x' }, 'en', { sender: '1@lid' });
    for (const n of ['0.', '1.', '2.', '3.', '4.', '5.', '6.', '9.']) {
      check(`6: option ${n} renders`, r.text.includes('\n' + n), n);
    }
    // The admin row is gated by the adminPanel FEATURE flag only, not
    // adminOnly -- the definition documents that the admin check happens at
    // click time. Its letter is small-capped like other static text.
    const adminOpt = def.options.find((o) => o.number === 'A');
    check('6: the admin row is feature-gated, not adminOnly',
      adminOpt?.adminOnly === undefined && adminOpt?.featureId === 'adminPanel',
      JSON.stringify({ adminOnly: adminOpt?.adminOnly, featureId: adminOpt?.featureId }));
    check('6: the admin row renders while the feature is available',
      r.text.includes('\n' + sc('A') + '. '), r.text.split('\n').pop());
    const adminRender = await renderMenu('main_menu', { jid: ADMIN, username: 'admin', name: 'Admin' }, 'en', { sender: ADMIN });
    check('6: the admin row renders for the admin too',
      adminRender.text.includes('\n' + sc('A') + '. '), adminRender.text.split('\n').pop());
  }

  // 7 -- the heading follows the user language.
  {
    const fr = await headingOf({ jid: '1@lid', username: 'adminuser', name: 'x' }, 'fr');
    const ar = await headingOf({ jid: '1@lid', username: 'adminuser', name: 'x' }, 'ar');
    check('7: the French heading is translated and static',
      fr === '> *' + toSmallCaps('Menu Principal') + '*' && !fr.includes('adminuser'), fr);
    check('7: the Arabic heading is translated and static',
      ar === '> *' + toSmallCaps('القائمة الرئيسية') + '*' && !ar.includes('adminuser'), ar);
  }

  // Backward compatibility: a definition without dynamicHeading keeps the old
  // headingKey path.
  {
    const other = await renderMenu('preferences', { jid: '1@lid', name: 'x' }, 'en', { sender: '1@lid' });
    check('other menus still use their translated heading', other.text.startsWith('> *'), other.text.split('\n')[0]);
    check('the main_menu definition opts out of a dynamic heading',
      (await import('../src/config/menus/registry.js')).getMenu('main_menu').dynamicHeading !== true);
    check('the main_menu definition has no headingResolver',
      (await import('../src/config/menus/registry.js')).getMenu('main_menu').headingResolver === undefined);
    check('the renderer still supports dynamicHeading for other menus',
      fs.readFileSync(path.join(root, 'src/utils/menuRenderer.js'), 'utf8').includes('definition.dynamicHeading === true'));
  }

  // =====================================================================
  // Wiring
  // =====================================================================
  {
    const idx = fs.readFileSync(path.join(root, 'src/index.js'), 'utf8');
    const intercept = idx.indexOf('try end must interrupt');
    const languageGate = idx.indexOf('conversation.languageGate');
    check('the intercept exists in the router', intercept > 0);
    check('the intercept runs before the language gate', intercept > 0 && intercept < languageGate, `intercept=${intercept} gate=${languageGate}`);
    check('the intercept runs before the speaker coordinator', intercept < idx.indexOf('const speaker = pickSpeaker('));
    check('the intercept runs before the onboarding gate', intercept < idx.indexOf('handleLanguageOnboardingGate'));
    check('the intercept ends the try session and returns', /endTrySession[\s\S]{0,200}return;/.test(idx.slice(intercept, intercept + 900)));
    const lo = fs.readFileSync(path.join(root, 'src/handlers/languageOnboardingHandler.js'), 'utf8');
    check('the onboarding gate has the /try guard', /\^\\\/try\(\\s\|\$\)\/i\.test\(input\)/.test(lo));
    const mr = fs.readFileSync(path.join(root, 'src/utils/menuRenderer.js'), 'utf8');
    check('the renderer honours dynamicHeading', mr.includes('definition.dynamicHeading === true'));
    check('the renderer keeps the headingKey fallback', mr.includes('renderTemplate(headingTemplate, headingParams)'));
  }
} finally {
  restoreData();
}

function toLowerSafe(s) { return String(s).toLowerCase(); }

console.log(fails === 0 ? 'ALL PASS' : fails + ' FAILURES');
process.exit(fails === 0 ? 0 : 1);
