// Smart first-time language onboarding + new-user admin notifications.
//
// Covers Part D of the spec: the confirmation flow, free-text yes/no in every
// supported language, the unsupported-locale path, the three-attempt retry
// rotation, the cooldown lock and its expiry, the admin notifications and their
// toggles, and the regression guarantee that users who already have a language
// are never touched.
//
// data/ is backed up and restored so nothing here can alter real user data,
// settings or stats.
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(here, '..', 'data');
const backupDir = path.join(os.tmpdir(), 'langOnboarding-data-backup');

fs.rmSync(backupDir, { recursive: true, force: true });
fs.cpSync(dataDir, backupDir, { recursive: true });
const restoreData = () => {
  fs.rmSync(dataDir, { recursive: true, force: true });
  fs.cpSync(backupDir, dataDir, { recursive: true });
  fs.rmSync(backupDir, { recursive: true, force: true });
};

let fails = 0;
function check(name, cond, extra = '') {
  console.log((cond ? 'PASS' : 'FAIL') + ' ' + name + (extra && !cond ? ' :: ' + String(extra).slice(0, 300) : ''));
  if (!cond) fails++;
}

const onboard = await import('../src/handlers/languageOnboardingHandler.js');
const sessionManager = (await import('../src/utils/sessionManager.js')).default;
const userService = await import('../src/services/userService.js');
const userStats = await import('../src/services/userStatsService.js');
const settingsService = (await import('../src/services/settingsService.js')).default;
const { getUserByJid } = await import('../src/services/userService.js');

const ADMIN = '127531067904055@lid';

function makeSock() {
  const sent = [];
  return {
    sent,
    sendMessage: async (jid, content) => {
      sent.push({ jid, text: String(content?.text ?? ''), edit: content?.edit, delete: content?.delete });
      if (content?.delete) return;
      if (content?.edit) return { key: content.edit };
      return { key: { id: 'K' + sent.length } };
    },
    sendPresenceUpdate: async () => {},
    readMessages: async () => true
  };
}

const flat = (s) => String(s).toLowerCase();

// Menus render static text in small caps, so a plain substring search for
// "english" can never match. Build the inverse of toSmallCaps and decode first.
const { toSmallCaps } = await import('../src/utils/smallCaps.js');
const SMALL_TO_PLAIN = new Map();
for (const ch of 'abcdefghijklmnopqrstuvwxyz') {
  const mapped = toSmallCaps(ch);
  if (mapped && mapped.length === 1 && mapped !== ch) SMALL_TO_PLAIN.set(mapped, ch);
}
const dec = (s) => String(s).split('').map((c) => SMALL_TO_PLAIN.get(c) ?? c).join('');
const lastText = (sock) => sock.sent.length ? sock.sent[sock.sent.length - 1].text : '';
const toUser = (sock) => sock.sent.filter((m) => m.jid !== ADMIN);
const toAdmin = (sock) => sock.sent.filter((m) => m.jid === ADMIN);

function newContext(sock, jid, text, locale) {
  return { sock, sender: jid, chatId: jid, pushName: 'Tester', text, deviceLocale: locale };
}

function resetSession(jid) {
  sessionManager.setState(jid, jid, {
    currentMenu: null, pendingAction: null, pendingData: null,
    languageOnboardingLockedUntil: null, onboardingAttempts: 0,
    onboardingLastRetry: -1, detectedLanguage: null, detectedLanguageRaw: null
  });
}

async function makeNewUser(jid, language = null) {
  await userService.ensureUserProfile({ jid, name: 'Tester' });
  if (language) await userService.updateUser(jid, { language });
  resetSession(jid);
}

try {
  // -------------------------------------------------------------------------
  // Pure helpers
  // -------------------------------------------------------------------------
  check('normalize en-US -> en', onboard.normalizeLanguage('en-US') === 'en');
  check('normalize FR -> fr', onboard.normalizeLanguage('FR') === 'fr');
  check('normalize de -> de', onboard.normalizeLanguage('de') === 'de');
  check('normalize es-419 -> es', onboard.normalizeLanguage('es-419') === 'es');
  check('normalize ar -> ar', onboard.normalizeLanguage('ar') === 'ar');
  check('normalize pt-BR -> null (unsupported)', onboard.normalizeLanguage('pt-BR') === null);
  check('normalize null -> null', onboard.normalizeLanguage(null) === null);

  check('isYesReply english', onboard.isYesReply('YES'));
  check('isYesReply french', onboard.isYesReply('oui'));
  check('isYesReply german', onboard.isYesReply('Jawohl'));
  check('isYesReply spanish accented', onboard.isYesReply('sí'));
  check('isYesReply arabic', onboard.isYesReply('نعم'));
  check('isYesReply punctuation tolerant', onboard.isYesReply('  Yes!  '));
  check('isNoReply english', onboard.isNoReply('no'));
  check('isNoReply french', onboard.isNoReply('non'));
  check('isNoReply arabic', onboard.isNoReply('لا'));
  check('gibberish is not yes or no', !onboard.isYesReply('asdkjh') && !onboard.isNoReply('asdkjh'));

  check('unsupported locale has a readable name', onboard.deviceLanguageName('pt-BR') === 'Portuguese');
  check('unknown locale falls back to the raw code', onboard.deviceLanguageName('xx') === 'xx');

  // Retry prompts must not repeat the same text twice in a row.
  const r0 = onboard.buildRetryMessage('en', 0);
  const r1 = onboard.buildRetryMessage('en', 1);
  const r2 = onboard.buildRetryMessage('en', 2);
  check('three distinct retry prompts', r0 !== r1 && r1 !== r2 && r0 !== r2);

  // -------------------------------------------------------------------------
  // D1.1 English device -> greeting -> "yes" -> language set
  // -------------------------------------------------------------------------
  {
    const jid = '900000000000001@lid';
    const sock = makeSock();
    await makeNewUser(jid);

    const consumed = await onboard.handleLanguageOnboardingGate(newContext(sock, jid, 'hello there', 'en-US'), sessionManager.getSession(jid, jid), await getUserByJid(jid));
    check('D1.1 first message is consumed by onboarding', consumed === true);
    const greeting = toUser(sock).map((m) => m.text).join('\n');
    check('D1.1 greets and names the detected language', dec(greeting).includes('english'), greeting.slice(0, 160));
    check('D1.1 offers yes / choose another', greeting.includes('1.') && greeting.includes('2.'));
    check('D1.1 admin got the new-user notification', toAdmin(sock).length === 1, 'admin msgs=' + toAdmin(sock).length);
    const notice = toAdmin(sock)[0]?.text || '';
    check('D1.1 notification has id, device language and totals', /900000000000001/.test(notice) && dec(notice).includes('device language') && dec(notice).includes('total users'), notice.slice(0, 200));

    const statsEntry = userStats.getUserStatsEntry(jid);
    check('D1.1 stats recorded the user', !!statsEntry && statsEntry.deviceLanguage === 'en');

    sock.sent.length = 0;
    const consumed2 = await onboard.handleLanguageOnboardingGate(newContext(sock, jid, 'yes', 'en-US'), sessionManager.getSession(jid, jid), await getUserByJid(jid));
    check('D1.1 "yes" is consumed', consumed2 === true);
    check('D1.1 language persisted as en', (await getUserByJid(jid))?.language === 'en', (await getUserByJid(jid))?.language);
    check('D1.1 onboarding marked completed', userStats.getUserStatsEntry(jid)?.onboardingStatus === 'completed');
    const out = toUser(sock).map((m) => m.text).join('\n');
    check('D1.1 welcome/intro follows the confirmation', out.length > 0);
    check('D1.1 admin got the completion notification', toAdmin(sock).some((m) => dec(m.text).includes('onboarding completed')));
  }

  // -------------------------------------------------------------------------
  // D1.2 / D1.3 French and Arabic devices
  // -------------------------------------------------------------------------
  for (const [locale, word, expected, label] of [
    ['fr-FR', 'oui', 'fr', 'D1.2'],
    ['ar', 'نعم', 'ar', 'D1.3']
  ]) {
    const jid = '90000000000001' + expected + '@lid';
    const sock = makeSock();
    await makeNewUser(jid);
    await onboard.handleLanguageOnboardingGate(newContext(sock, jid, 'hi', locale), sessionManager.getSession(jid, jid), await getUserByJid(jid));
    const greeting = toUser(sock).map((m) => m.text).join('\n');
    check(label + ' greeting is localized', !dec(greeting).includes('would you like me to use this'), greeting.slice(0, 120));
    sock.sent.length = 0;
    await onboard.handleLanguageOnboardingGate(newContext(sock, jid, word, locale), sessionManager.getSession(jid, jid), await getUserByJid(jid));
    check(label + ' ' + word + ' sets language to ' + expected, (await getUserByJid(jid))?.language === expected, (await getUserByJid(jid))?.language);
  }

  // -------------------------------------------------------------------------
  // D1.4 Portuguese device -> unsupported notice -> pick 3 (Deutsch)
  // -------------------------------------------------------------------------
  {
    const jid = '900000000000004@lid';
    const sock = makeSock();
    await makeNewUser(jid);
    await onboard.handleLanguageOnboardingGate(newContext(sock, jid, 'oi', 'pt-BR'), sessionManager.getSession(jid, jid), await getUserByJid(jid));
    const greeting = toUser(sock).map((m) => m.text).join('\n');
    check('D1.4 unsupported notice names the language', dec(greeting).includes('portuguese'), greeting.slice(0, 160));
    check('D1.4 unsupported notice is in English', dec(greeting).includes('please choose'));
    check('D1.4 stats mark the device language unsupported', userStats.getUserStatsEntry(jid)?.deviceLanguage === null);
    sock.sent.length = 0;
    await onboard.handleLanguageOnboardingGate(newContext(sock, jid, '3', 'pt-BR'), sessionManager.getSession(jid, jid), await getUserByJid(jid));
    check('D1.4 picking 3 sets German', (await getUserByJid(jid))?.language === 'de', (await getUserByJid(jid))?.language);
  }

  // -------------------------------------------------------------------------
  // D1.5-D1.8 retries then cooldown
  // -------------------------------------------------------------------------
  {
    const jid = '900000000000005@lid';
    const sock = makeSock();
    await makeNewUser(jid);
    await onboard.handleLanguageOnboardingGate(newContext(sock, jid, 'start', 'en'), sessionManager.getSession(jid, jid), await getUserByJid(jid));
    const seen = [];
    for (const bad of ['qwerty', 'zzz', 'hmm']) {
      sock.sent.length = 0;
      await onboard.handleLanguageOnboardingGate(newContext(sock, jid, bad, 'en'), sessionManager.getSession(jid, jid), await getUserByJid(jid));
      seen.push(toUser(sock).map((m) => m.text).join('\n'));
    }
    check('D1.5 first retry sent', seen[0].length > 0, seen[0]);
    check('D1.6 second retry differs from the first', seen[1] !== seen[0], seen[1]);
    check('D1.7 third retry differs from the second', seen[2] !== seen[1], seen[2]);
    check('D1.8 cooldown notice after the third unclear reply', dec(seen[2]).includes('come back later'), seen[2]);

    const session = sessionManager.getSession(jid, jid);
    check('D1.8 lock is set into the future', Number(session.languageOnboardingLockedUntil) > Date.now());
    check('D1.8 stats marked abandoned', userStats.getUserStatsEntry(jid)?.onboardingStatus === 'abandoned');

    // Locked: further messages are ignored entirely.
    sock.sent.length = 0;
    const consumed = await onboard.handleLanguageOnboardingGate(newContext(sock, jid, 'hello?', 'en'), session, await getUserByJid(jid));
    check('D1.8 locked message is consumed but not answered', consumed === true && sock.sent.length === 0, 'sent=' + sock.sent.length);
  }

  // -------------------------------------------------------------------------
  // D1.9 cooldown expiry -> welcome back, flow restarts
  // -------------------------------------------------------------------------
  {
    const jid = '900000000000006@lid';
    const sock = makeSock();
    await makeNewUser(jid);
    await onboard.handleLanguageOnboardingGate(newContext(sock, jid, 'start', 'en'), sessionManager.getSession(jid, jid), await getUserByJid(jid));
    for (const bad of ['aaa', 'bbb', 'ccc']) {
      sock.sent.length = 0;
      await onboard.handleLanguageOnboardingGate(newContext(sock, jid, bad, 'en'), sessionManager.getSession(jid, jid), await getUserByJid(jid));
    }
    // Expire the lock by rewinding it.
    sessionManager.setState(jid, jid, { languageOnboardingLockedUntil: Date.now() - 1000 });
    sock.sent.length = 0;
    await onboard.handleLanguageOnboardingGate(newContext(sock, jid, 'back again', 'en'), sessionManager.getSession(jid, jid), await getUserByJid(jid));
    const out = toUser(sock).map((m) => m.text).join('\n');
    check('D1.9 welcome back after cooldown', dec(out).includes('welcome back'), out.slice(0, 160));
    check('D1.9 greeting repeated after the reminder', dec(out).includes('detected your device language'));
    check('D1.9 attempts reset to 0', (sessionManager.getSession(jid, jid)?.onboardingAttempts || 0) === 0);

    sock.sent.length = 0;
    await onboard.handleLanguageOnboardingGate(newContext(sock, jid, 'yes', 'en'), sessionManager.getSession(jid, jid), await getUserByJid(jid));
    check('D1.9 can complete after the lock', (await getUserByJid(jid))?.language === 'en');
  }

  // -------------------------------------------------------------------------
  // D1.10 / D1.11 choosing another language, and accepting with "1"
  // -------------------------------------------------------------------------
  {
    const jid = '900000000000007@lid';
    const sock = makeSock();
    await makeNewUser(jid);
    await onboard.handleLanguageOnboardingGate(newContext(sock, jid, 'start', 'en'), sessionManager.getSession(jid, jid), await getUserByJid(jid));
    sock.sent.length = 0;
    await onboard.handleLanguageOnboardingGate(newContext(sock, jid, '2', 'en'), sessionManager.getSession(jid, jid), await getUserByJid(jid));
    check('D1.10 option 2 opens the language chooser', sessionManager.getSession(jid, jid)?.currentMenu === 'language_selection', sessionManager.getSession(jid, jid)?.currentMenu);
    check('D1.10 chooser lists five languages', toUser(sock).some((m) => m.text.includes('5.')));
  }
  {
    const jid = '900000000000008@lid';
    const sock = makeSock();
    await makeNewUser(jid);
    await onboard.handleLanguageOnboardingGate(newContext(sock, jid, 'start', 'de'), sessionManager.getSession(jid, jid), await getUserByJid(jid));
    sock.sent.length = 0;
    await onboard.handleLanguageOnboardingGate(newContext(sock, jid, '1', 'de'), sessionManager.getSession(jid, jid), await getUserByJid(jid));
    check('D1.11 "1" accepts the detected language (de)', (await getUserByJid(jid))?.language === 'de', (await getUserByJid(jid))?.language);
  }
  {
    const jid = '900000000000009@lid';
    const sock = makeSock();
    await makeNewUser(jid);
    await onboard.handleLanguageOnboardingGate(newContext(sock, jid, 'start', 'en'), sessionManager.getSession(jid, jid), await getUserByJid(jid));
    sock.sent.length = 0;
    await onboard.handleLanguageOnboardingGate(newContext(sock, jid, '0', 'en'), sessionManager.getSession(jid, jid), await getUserByJid(jid));
    check('D1.10 "0" also opens the chooser (not stuck)', sessionManager.getSession(jid, jid)?.currentMenu === 'language_selection');
  }

  // -------------------------------------------------------------------------
  // D2.4 / D2.5 notification toggles
  // -------------------------------------------------------------------------
  {
    const { isBotNotifyEnabled } = await import('../src/config/notificationToggles.js');
    const before = settingsService.getSettings().botNotifyOnNewUser;
    settingsService.updateSettings({ botNotifyOnNewUser: false });
    check('D2.4 onNewUser toggle reads false', isBotNotifyEnabled('onNewUser') === false);
    const jid = '900000000000010@lid';
    const sock = makeSock();
    await makeNewUser(jid);
    await onboard.handleLanguageOnboardingGate(newContext(sock, jid, 'start', 'en'), sessionManager.getSession(jid, jid), await getUserByJid(jid));
    check('D2.4 no new-user notification when toggled off', toAdmin(sock).length === 0, 'admin msgs=' + toAdmin(sock).length);
    check('D2.4 the user still got the greeting', toUser(sock).length > 0);
    settingsService.updateSettings({ botNotifyOnNewUser: before });

    const before2 = settingsService.getSettings().botNotifyOnOnboardingComplete;
    settingsService.updateSettings({ botNotifyOnOnboardingComplete: false });
    const jid2 = '900000000000011@lid';
    const sock2 = makeSock();
    await makeNewUser(jid2);
    await onboard.handleLanguageOnboardingGate(newContext(sock2, jid2, 'start', 'en'), sessionManager.getSession(jid2, jid2), await getUserByJid(jid2));
    sock2.sent.length = 0;
    await onboard.handleLanguageOnboardingGate(newContext(sock2, jid2, 'yes', 'en'), sessionManager.getSession(jid2, jid2), await getUserByJid(jid2));
    check('D2.5 no completion notification when toggled off', !toAdmin(sock2).some((m) => dec(m.text).includes('onboarding completed')));
    check('D2.5 language still persisted', (await getUserByJid(jid2))?.language === 'en');
    settingsService.updateSettings({ botNotifyOnOnboardingComplete: before2 });
  }

  // -------------------------------------------------------------------------
  // D2.6 several new users each notify separately (no aggregation)
  // -------------------------------------------------------------------------
  {
    const ids = ['900000000000020@lid', '900000000000021@lid', '900000000000022@lid'];
    const seen = [];
    for (const jid of ids) {
      const sock = makeSock();
      await makeNewUser(jid);
      await onboard.handleLanguageOnboardingGate(newContext(sock, jid, 'hi', 'en'), sessionManager.getSession(jid, jid), await getUserByJid(jid));
      seen.push(toAdmin(sock).length);
    }
    check('D2.6 each new user triggers its own notification', seen.every((n) => n === 1), JSON.stringify(seen));
  }

  // -------------------------------------------------------------------------
  // D2.1/2.2 repeated first messages from a known user do not re-notify
  // -------------------------------------------------------------------------
  {
    const jid = '900000000000030@lid';
    const sock = makeSock();
    await makeNewUser(jid);
    await onboard.handleLanguageOnboardingGate(newContext(sock, jid, 'hi', 'en'), sessionManager.getSession(jid, jid), await getUserByJid(jid));
    check('D2.1 first sighting notifies admins', toAdmin(sock).length === 1);
    sock.sent.length = 0;
    // Abandon the session without completing, then re-open onboarding.
    resetSession(jid);
    await onboard.handleLanguageOnboardingGate(newContext(sock, jid, 'again', 'en'), sessionManager.getSession(jid, jid), await getUserByJid(jid));
    check('D2.1 known user does not notify again', toAdmin(sock).length === 0, 'admin msgs=' + toAdmin(sock).length);
  }

  // -------------------------------------------------------------------------
  // D3. Regression: existing users are untouched
  // -------------------------------------------------------------------------
  {
    const jid = '900000000000040@lid';
    const sock = makeSock();
    await makeNewUser(jid, 'es');
    sessionManager.setState(jid, jid, { currentMenu: 'main' });
    const consumed = await onboard.handleLanguageOnboardingGate(newContext(sock, jid, '/start', 'es'), sessionManager.getSession(jid, jid), await getUserByJid(jid));
    check('D3.1 existing user is never onboarded', consumed === false);
    check('D3.1 no admin notification for an existing user', toAdmin(sock).length === 0);
    check('D3.2 language untouched', (await getUserByJid(jid))?.language === 'es');

    const sock2 = makeSock();
    const consumed2 = await onboard.handleLanguageOnboardingGate(newContext(sock2, jid, 'hola', 'es'), sessionManager.getSession(jid, jid), await getUserByJid(jid));
    check('D3.3 free text from an onboarded user falls through', consumed2 === false);
  }

  // -------------------------------------------------------------------------
  // Bot Notifications menu gained the two new rows
  // -------------------------------------------------------------------------
  {
    const { getMenu } = await import('../src/config/menus/registry.js');
    await import('../src/config/menus/index.js');
    const menu = getMenu('bot_notifications');
    const numbers = menu.options.map((o) => String(o.number));
    check('bot_notifications has seven options', numbers.join(',') === '1,2,3,4,5,6,7', numbers.join(','));
    check('option 5 is onNewUser', menu.options[4]?.labelKey === 'menu.bot_notifications.onNewUser', menu.options[4]?.labelKey);
    check('option 6 is onOnboardingComplete', menu.options[5]?.labelKey === 'menu.bot_notifications.onOnboardingComplete', menu.options[5]?.labelKey);
    const { dynamicSuffixResolvers } = await import('../src/utils/menuResolvers.js');
    check('option 5 suffix resolver exists', typeof dynamicSuffixResolvers.botNotifs_onNewUserState === 'function');
    check('option 6 suffix resolver exists', typeof dynamicSuffixResolvers.botNotifs_onOnboardingCompleteState === 'function');
    const { botNotificationCustomHandlers } = await import('../src/utils/menuCustomHandlers.js');
    check('option 5 handler exists', typeof botNotificationCustomHandlers.botnotifs_new_user === 'function');
    check('option 6 handler exists', typeof botNotificationCustomHandlers.botnotifs_onboarding_complete === 'function');
  }
  // -------------------------------------------------------------------------
  // Stage routing: the 5-language menu must not bounce back to the confirmation
  // prompt. These mirror index.js: the gate runs first, then the pre-existing
  // 'language_selection' branch handles 1-5.
  // -------------------------------------------------------------------------
  const { handleLanguageSelection } = await import('../src/handlers/languageCommand.js');
  async function message(sock, jid, text) {
    const session = sessionManager.getSession(jid, jid) || {};
    const consumed = await onboard.handleLanguageOnboardingGate(newContext(sock, jid, text), session, await getUserByJid(jid));
    if (consumed) return 'gate';
    if (session.currentMenu === 'language_selection' && /^[1-5]$/.test(text)) {
      await handleLanguageSelection({ sock, sender: jid, chatId: jid, pushName: 'Tester' }, text);
      return 'language_selection';
    }
    return 'fallthrough';
  }

  // Drive a brand-new user from the greeting to the 5-language menu.
  async function startAtChooser(sock, jid) {
    await message(sock, jid, 'hello');
    await message(sock, jid, '2');
    return sessionManager.getSession(jid, jid)?.currentMenu === 'language_selection';
  }

  // Each number 1-5 from the chooser must apply that language.
  for (const [digit, expected] of [['1', 'en'], ['2', 'fr'], ['3', 'de'], ['4', 'es'], ['5', 'ar']]) {
    const jid = '9000000000001' + expected + '0@lid';
    const sock = makeSock();
    await makeNewUser(jid);
    const reached = await startAtChooser(sock, jid);
    check('chooser: ' + digit + ' reached the 5-language menu', reached, sessionManager.getSession(jid, jid)?.currentMenu);
    sock.sent.length = 0;
    const route = await message(sock, jid, digit);
    check('chooser: ' + digit + ' routed to language_selection', route === 'language_selection', route);
    check('chooser: ' + digit + ' sets ' + expected, (await getUserByJid(jid))?.language === expected, (await getUserByJid(jid))?.language);
    const out = toUser(sock).map((m) => m.text).join('\n');
    check('chooser: ' + digit + ' did not re-show the confirmation', !dec(out).includes('detected your device language'), out.slice(0, 140));
    check('chooser: ' + digit + ' cleared the onboarding session', sessionManager.getSession(jid, jid)?.onboardingStage === null, String(sessionManager.getSession(jid, jid)?.onboardingStage));
  }

  // "0" on the chooser returns to the confirmation prompt.
  {
    const jid = '900000000000150@lid';
    const sock = makeSock();
    await makeNewUser(jid);
    await startAtChooser(sock, jid);
    sock.sent.length = 0;
    const route = await message(sock, jid, '0');
    const out = toUser(sock).map((m) => m.text).join('\n');
    check('chooser: "0" returns to the confirmation', route === 'gate' && dec(out).includes('detected your device language'), out.slice(0, 140));
    check('chooser: "0" restores the confirm stage', sessionManager.getSession(jid, jid)?.onboardingStage === 'confirm_detected', String(sessionManager.getSession(jid, jid)?.onboardingStage));
  }

  // "9" on the chooser falls through so the existing help interception runs.
  {
    const jid = '900000000000151@lid';
    const sock = makeSock();
    await makeNewUser(jid);
    await startAtChooser(sock, jid);
    const route = await message(sock, jid, '9');
    check('chooser: "9" falls through for help handling', route === 'fallthrough', route);
  }

  // Stage transitions on the confirmation prompt.
  {
    const jid = '900000000000152@lid';
    const sock = makeSock();
    await makeNewUser(jid);
    await message(sock, jid, 'hello');
    check('stage: confirm_detected on the greeting', sessionManager.getSession(jid, jid)?.onboardingStage === 'confirm_detected', String(sessionManager.getSession(jid, jid)?.onboardingStage));
    await message(sock, jid, '???');
    check('stage: awaiting_retry after an unclear reply', sessionManager.getSession(jid, jid)?.onboardingStage === 'awaiting_retry', String(sessionManager.getSession(jid, jid)?.onboardingStage));
    for (const bad of ['zzz', 'abc']) await message(sock, jid, bad);
    check('stage: locked after three unclear replies', sessionManager.getSession(jid, jid)?.onboardingStage === 'locked', String(sessionManager.getSession(jid, jid)?.onboardingStage));
  }

  // Short yes/no synonyms behave like the full words.
  {
    const jid = '900000000000153@lid';
    const sock = makeSock();
    await makeNewUser(jid);
    await message(sock, jid, 'hi');
    await message(sock, jid, 'y');
    check('"y" is accepted as yes', (await getUserByJid(jid))?.language === 'en', (await getUserByJid(jid))?.language);
  }
  {
    const jid = '900000000000154@lid';
    const sock = makeSock();
    await makeNewUser(jid);
    await message(sock, jid, 'hi');
    await message(sock, jid, 'n');
    check('"n" opens the 5-language menu', sessionManager.getSession(jid, jid)?.currentMenu === 'language_selection');
  }
  {
    const jid = '900000000000155@lid';
    const sock = makeSock();
    await makeNewUser(jid);
    await message(sock, jid, 'hi');
    await message(sock, jid, '0');
    check('"0" on the confirmation opens the 5-language menu', sessionManager.getSession(jid, jid)?.currentMenu === 'language_selection');
  }

  // A user already inside a language flow must not be re-onboarded.
  {
    const jid = '900000000000156@lid';
    const sock = makeSock();
    await makeNewUser(jid);
    sessionManager.setState(jid, jid, { currentMenu: 'language_selection', isLanguageSelectionPending: true });
    const route = await message(sock, jid, '3');
    check('gate defers while the chooser is open', route === 'language_selection', route);
    check('no duplicate confirmation was sent', !toUser(sock).some((m) => dec(m.text).includes('detected your device language')));
  }
} finally {
  restoreData();
}

console.log(fails === 0 ? 'ALL PASS' : fails + ' FAILURES');
process.exit(fails === 0 ? 0 : 1);
