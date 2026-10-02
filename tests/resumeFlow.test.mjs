// Speaker coordinator + unified resume flow (Prompt C).
//
// Scenarios A-H from the spec:
//   A  one message after the cooldown expires (the triple-message bug)
//   B  resume -> yes
//   C  resume -> no
//   D  three escalating nudges, then silence
//   E  warmer variant after a long gap
//   F  language names small-capped in the resume-yes prompt
//   G  no regression for a brand-new user
//   H  no regression for a completed user
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const dataDir = path.join(root, 'data');
const backupDir = path.join(os.tmpdir(), 'resumeFlow-data-backup');

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

const MIN = 5 * 60 * 1000;
const H = 60 * 60 * 1000;
const D = 24 * H;

const onboard = await import('../src/handlers/languageOnboardingHandler.js');
const resume = await import('../src/handlers/resumeHandler.js');
const { pickSpeaker } = await import('../src/utils/pickSpeaker.js');
const welcome = await import('../src/services/welcomeBackService.js');
const sessionManager = (await import('../src/utils/sessionManager.js')).default;
const userService = await import('../src/services/userService.js');
const { getUserByJid } = await import('../src/services/userService.js');
const { toSmallCaps } = await import('../src/utils/smallCaps.js');
const { STAGE } = onboard;

const ADMIN = '127531067904055@lid';

const SMALL_TO_PLAIN = new Map();
for (const ch of 'abcdefghijklmnopqrstuvwxyz') {
  const mapped = toSmallCaps(ch);
  if (mapped && mapped.length === 1 && mapped !== ch) SMALL_TO_PLAIN.set(mapped, ch);
}
const dec = (s) => String(s).split('').map((c) => SMALL_TO_PLAIN.get(c) ?? c).join('');
const decf = (s) => dec(s).toLowerCase();

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
const toUser = (sock) => sock.sent.filter((m) => m.jid !== ADMIN);
const texts = (sock) => toUser(sock).map((m) => m.text);

function ctxFor(sock, jid, text, pushName = 'Tester') {
  return { sock, sender: jid, chatId: jid, pushName, text, deviceLocale: 'en-US' };
}

function resetSession(jid) {
  sessionManager.setState(jid, jid, {
    currentMenu: null,
    pendingAction: null,
    pendingData: null,
    languageOnboardingLockedUntil: null,
    onboardingAttempts: 0,
    onboardingLastRetry: -1,
    detectedLanguage: null,
    detectedLanguageRaw: null,
    detectedLanguageSource: null,
    awaitingResumeConfirmation: false,
    cooldownJustExpired: false,
    resumeFromStage: null,
    resumeAttempts: 0,
    idleClose: false,
    idleCloseUntil: null,
    onboardingStage: null
  });
}

async function makeNewUser(jid, language = null) {
  await userService.ensureUserProfile({ jid, name: 'Tester' });
  if (language) await userService.updateUser(jid, { language });
  resetSession(jid);
}

const gate = async (sock, jid, text) => onboard.handleLanguageOnboardingGate(
  ctxFor(sock, jid, text), sessionManager.getSession(jid, jid), await getUserByJid(jid)
);

try {
  // =====================================================================
  // pickSpeaker -- the coordinator's decision table
  // =====================================================================
  check('no user record -> onboarding', pickSpeaker({ user: null, session: {}, gap: 0 }) === 'onboarding');
  check('no language, small gap -> onboarding',
    pickSpeaker({ user: { language: null }, session: {}, gap: 60e3 }) === 'onboarding');
  check('no language, gap at min -> resume',
    pickSpeaker({ user: { language: null }, session: {}, gap: MIN }) === 'resume');
  check('no language, big gap -> resume',
    pickSpeaker({ user: { language: null }, session: {}, gap: 3 * D }) === 'resume');
  check('expired lock, no language -> cooldown', pickSpeaker({
    user: { language: null }, session: { languageOnboardingLockedUntil: Date.now() - 1 }, gap: 60e3
  }) === 'cooldown');
  check('cooldownJustExpired -> cooldown', pickSpeaker({
    user: { language: null }, session: { cooldownJustExpired: true }, gap: 60e3
  }) === 'cooldown');
  check('live lock, no language -> onboarding (gate stays silent)',
    pickSpeaker({ user: { language: null }, session: { languageOnboardingLockedUntil: Date.now() + H }, gap: 60e3 }) === 'onboarding');
  check('language set, big gap -> welcomeBack',
    pickSpeaker({ user: { language: 'en' }, session: {}, gap: 3 * D }) === 'welcomeBack');
  check('language set, small gap -> menu',
    pickSpeaker({ user: { language: 'en' }, session: {}, gap: 10e3 }) === 'menu');
  check('cooldown outranks resume', pickSpeaker({
    user: { language: null },
    session: { languageOnboardingLockedUntil: Date.now() - 1 },
    gap: 5 * D
  }) === 'cooldown');
  check('language set never returns resume or cooldown', ['resume', 'cooldown', 'onboarding']
    .every(() => ['welcomeBack', 'menu'].includes(pickSpeaker({
      user: { language: 'fr' }, session: { languageOnboardingLockedUntil: Date.now() - 1, cooldownJustExpired: true }, gap: 5 * D
    }))));
  check('idle-close window suppresses the resume prompt', pickSpeaker({
    user: { language: null }, session: { idleCloseUntil: Date.now() + H }, gap: 5 * D
  }) === 'onboarding');
  check('expired idle-close window allows resume again', pickSpeaker({
    user: { language: null }, session: { idleCloseUntil: Date.now() - 1 }, gap: 5 * D
  }) === 'resume');
  check('pickSpeaker always returns a known speaker',
    ['cooldown', 'resume', 'onboarding', 'welcomeBack', 'menu'].includes(pickSpeaker({ user: { language: 'en' }, session: {}, gap: 0 })));

  // =====================================================================
  // A. Triple-message fix
  // =====================================================================
  {
    const jid = '910000000000001@lid';
    const sock = makeSock();
    await makeNewUser(jid);
    await gate(sock, jid, 'hello');
    check('A: first contact sends exactly one message', toUser(sock).length === 1, toUser(sock).length);

    // Drive the 3-retry cooldown.
    for (const bad of ['aaa', 'bbb', 'ccc']) {
      await gate(sock, jid, bad);
    }
    const locked = sessionManager.getSession(jid, jid);
    check('A: three unclear replies engage the cooldown', locked?.onboardingStage === STAGE.LOCKED, locked?.onboardingStage);
    check('A: the lock has a future expiry', locked?.languageOnboardingLockedUntil > Date.now());

    // Expire it, then let the router coordinate one message.
    sessionManager.setState(jid, jid, { languageOnboardingLockedUntil: Date.now() - 1000 });
    sock.sent.length = 0;
    const session = sessionManager.getSession(jid, jid);
    const speaker = pickSpeaker({ user: await getUserByJid(jid), session, gap: 10 * 60e3 });
    check('A: the speaker after expiry is cooldown', speaker === 'cooldown', speaker);

    sessionManager.setState(jid, jid, {
      awaitingResumeConfirmation: true,
      resumeFromStage: session?.onboardingStage || STAGE.CONFIRM,
      cooldownJustExpired: false,
      languageOnboardingLockedUntil: null
    });
    await resume.sendResumePrompt(ctxFor(sock, jid, 'back again'), session, await getUserByJid(jid), 10 * 60e3);

    check('A: exactly ONE message is sent', toUser(sock).length === 1, JSON.stringify(texts(sock)));
    const only = texts(sock)[0] || '';
    check('A: the single message is the resume prompt', decf(only).includes('we were this close'), decf(only));
    check('A: no welcome-back greeting leaked', !decf(only).includes('welcome back'), decf(only));
    check('A: no full first message leaked', !decf(only).includes('detected your device language'), decf(only));
    check('A: no brand heading leaked', !only.includes('x‑ᴠᴏʀᴛᴇx'), only.slice(0, 60));
  }

  // =====================================================================
  // B. Resume -> yes
  // =====================================================================
  {
    const jid = '910000000000002@lid';
    const sock = makeSock();
    await makeNewUser(jid);
    await gate(sock, jid, 'hello');
    sessionManager.setState(jid, jid, {
      awaitingResumeConfirmation: true,
      resumeFromStage: STAGE.CONFIRM,
      detectedLanguage: 'en',
      detectedLanguageRaw: 'en-US'
    });
    sock.sent.length = 0;
    for (const answer of ['1', 'yes', 'y', '\u{1F44D}', '\u2705', 'oui', 'ja']) {
      sock.sent.length = 0;
      await resume.handleResumeReply(ctxFor(sock, jid, answer, 'Tester'), sessionManager.getSession(jid, jid), await getUserByJid(jid));
      check(`B: "${answer}" is accepted as yes`, toUser(sock).length === 1, JSON.stringify(texts(sock)));
    }
    sock.sent.length = 0;
    await resume.handleResumeReply(ctxFor(sock, jid, 'yes', 'Tester'), sessionManager.getSession(jid, jid), await getUserByJid(jid));
    const out = texts(sock)[0] || '';
    check('B: yes sends exactly one message', toUser(sock).length === 1, toUser(sock).length);
    check('B: the core prompt is headed by Language', out.startsWith('> *\u{1F310}'), out.split('\n')[0]);
    check('B: the brand heading is gone', !out.includes('x‑ᴠᴏʀᴛᴇx'), out.slice(0, 80));
    check('B: the time-of-day greeting is gone', !/ɢᴏᴏᴅ|ɢᴏᴏᴅ|ɢᴏᴏᴅ/.test(out) && !decf(out).includes('good morning'), decf(out).split('\n')[1]);
    check('B: no pushName re-introduction', !out.includes('*Tester*'), out);
    check('B: the detected line is present', decf(out).includes('detected your device language'), decf(out));
    check('B: both options are present', /^1\. /m.test(out) && /^2\. /m.test(out), out);
    check('B: awaitingResumeConfirmation is cleared', sessionManager.getSession(jid, jid)?.awaitingResumeConfirmation === false);
    check('B: cooldownJustExpired is cleared', sessionManager.getSession(jid, jid)?.cooldownJustExpired === false);
    check('B: resumeFromStage is cleared', sessionManager.getSession(jid, jid)?.resumeFromStage === null);
    check('B: the stage is restored to confirm', sessionManager.getSession(jid, jid)?.onboardingStage === STAGE.CONFIRM,
      sessionManager.getSession(jid, jid)?.onboardingStage);
    check('B: the lock is released', (sessionManager.getSession(jid, jid)?.languageOnboardingLockedUntil ?? 0) <= Date.now());

    // The core prompt must still be actionable.
    sock.sent.length = 0;
    await gate(sock, jid, 'yes');
    check('B: yes then yes completes onboarding', (await getUserByJid(jid))?.language === 'en', (await getUserByJid(jid))?.language);
  }

  // =====================================================================
  // C. Resume -> no
  // =====================================================================
  {
    const jid = '910000000000003@lid';
    const sock = makeSock();
    await makeNewUser(jid);
    await gate(sock, jid, 'hello');
    sessionManager.setState(jid, jid, {
      awaitingResumeConfirmation: true, resumeFromStage: STAGE.CONFIRM, detectedLanguage: 'en'
    });
    for (const answer of ['2', 'no', 'n', '\u274C', 'non', 'nein']) {
      sock.sent.length = 0;
      await resume.handleResumeReply(ctxFor(sock, jid, answer), sessionManager.getSession(jid, jid), await getUserByJid(jid));
      check(`C: "${answer}" is accepted as no`, toUser(sock).length === 1, JSON.stringify(texts(sock)));
    }
    sock.sent.length = 0;
    await resume.handleResumeReply(ctxFor(sock, jid, 'no'), sessionManager.getSession(jid, jid), await getUserByJid(jid));
    const out = texts(sock)[0] || '';
    check('C: no sends exactly one message', toUser(sock).length === 1, toUser(sock).length);
    check('C: the close is polite', decf(out).includes('no worries'), decf(out));
    check('C: it promises to be there later', decf(out).includes('here when you are ready'), decf(out));
    check('C: awaitingResumeConfirmation is cleared', sessionManager.getSession(jid, jid)?.awaitingResumeConfirmation === false);
    check('C: idleClose is set', sessionManager.getSession(jid, jid)?.idleClose === true);
    check('C: an idle window is recorded', (sessionManager.getSession(jid, jid)?.idleCloseUntil ?? 0) > Date.now());
    check('C: no language was set', (await getUserByJid(jid))?.language == null, (await getUserByJid(jid))?.language);
  }

  // =====================================================================
  // D. Unclear input
  // =====================================================================
  {
    const jid = '910000000000004@lid';
    const sock = makeSock();
    await makeNewUser(jid);
    await gate(sock, jid, 'hello');
    sessionManager.setState(jid, jid, {
      awaitingResumeConfirmation: true, resumeFromStage: STAGE.CONFIRM, resumeAttempts: 0
    });
    const seen = [];
    for (const junk of ['maybe', 'hmm', 'xyz', 'abc']) {
      sock.sent.length = 0;
      await resume.handleResumeReply(ctxFor(sock, jid, junk), sessionManager.getSession(jid, jid), await getUserByJid(jid));
      seen.push(texts(sock));
    }
    check('D: attempt 1 re-prompts', seen[0].length === 1, JSON.stringify(seen[0]));
    check('D: attempt 2 re-prompts', seen[1].length === 1, JSON.stringify(seen[1]));
    check('D: attempt 3 re-prompts', seen[2].length === 1, JSON.stringify(seen[2]));
    check('D: attempt 4 goes silent', seen[3].length === 0, JSON.stringify(seen[3]));
    check('D: attempt 1 offers yes and no', /1\./.test(seen[0][0]) && /2\./.test(seen[0][0]), seen[0][0]);
    check('D: attempt 2 reads differently from attempt 1', seen[0][0] !== seen[1][0], 'identical nudges');
    check('D: attempt 3 reads differently again', seen[1][0] !== seen[2][0], 'identical nudges');
    check('D: after three unclear attempts the flags are cleared', sessionManager.getSession(jid, jid)?.awaitingResumeConfirmation === false);
    check('D: resumeAttempts is reset', (sessionManager.getSession(jid, jid)?.resumeAttempts || 0) === 0);
  }

  // =====================================================================
  // E. Long gap uses the warmer variant
  // =====================================================================
  {
    const jid = '910000000000005@lid';
    const sock = makeSock();
    await makeNewUser(jid);
    const short = await (async () => { sock.sent.length = 0; await resume.sendResumePrompt(ctxFor(sock, jid), {}, await getUserByJid(jid), 2 * H); return texts(sock)[0]; })();
    const long = await (async () => { sock.sent.length = 0; await resume.sendResumePrompt(ctxFor(sock, jid), {}, await getUserByJid(jid), 5 * D); return texts(sock)[0]; })();
    check('E: a short gap uses the still-there heading', decf(short.split('\n')[0]).includes('still there'), decf(short.split('\n')[0]));
    check('E: a long gap uses the welcome-back heading', decf(long.split('\n')[0]).includes('welcome back'), decf(long.split('\n')[0]));
    check('E: the long variant is warmer', decf(long).includes('been a while'), decf(long));
    check('E: the two variants differ', short !== long);
    check('E: both offer the same two options', /1\./.test(short) && /2\./.test(short) && /1\./.test(long) && /2\./.test(long));
  }

  // =====================================================================
  // F. Language names are small-capped in the resume-yes prompt
  // =====================================================================
  {
    const out = onboard.buildDetectedMessage('en', 'en', { skipGreeting: true });
    const scName = toSmallCaps('English');
    check('F: the detected line shows a small-capped name', out.includes('*' + scName + ' \u{1F1EC}\u{1F1E7}*'), out.split('\n')[2]);
    check('F: the detected line says "is <name>"', decf(out).includes('is *english'), decf(out).split('\n')[2]);
    const opt1 = out.split('\n').find((l) => l.includes('\u2705'));
    check('F: option 1 shows a small-capped name', opt1.includes(scName), opt1);
    check('F: option 1 reads "yes, use <name>"', decf(opt1).includes('yes, use english'), decf(opt1));
    check('F: the raw name is not left in place', !out.includes('English \u{1F1EC}\u{1F1E7}'), out);
    check('F: the prompt has no replacement chars', !out.includes('\uFFFD'), out);
    check('F: the prompt has no brand heading', !out.includes('x‑ᴠᴏʀᴛᴇx'), out.slice(0, 60));
    for (const [lang, native] of [['fr', 'Français'], ['de', 'Deutsch'], ['es', 'Español'], ['ar', 'العربية']]) {
      const code = { fr: 'fr', de: 'de', es: 'es', ar: 'ar' }[lang];
      const built = onboard.buildDetectedMessage(code, code, { skipGreeting: true });
      check(`F: ${lang} name is small-capped`, built.includes(toSmallCaps(native)), built.split('\n')[2]);
    }
  }

  // =====================================================================
  // G. No regression for a brand-new user
  // =====================================================================
  {
    const jid = '910000000000006@lid';
    const sock = makeSock();
    await makeNewUser(jid);
    const user = await getUserByJid(jid);
    check('G: a fresh user has no lastSeen', !user?.lastSeen, user?.lastSeen);
    check('G: a fresh user is routed to onboarding', pickSpeaker({ user, session: {}, gap: 0 }) === 'onboarding');
    sock.sent.length = 0;
    await gate(sock, jid, 'hello');
    const out = texts(sock)[0] || '';
    check('G: the full first message is sent', toUser(sock).length === 1, toUser(sock).length);
    check('G: it carries the brand heading', out.includes('x‑ᴠᴏʀᴛᴇx'), out.slice(0, 60));
    check('G: it carries a time-of-day greeting', /ɢᴏᴏᴅ|ɢᴏᴏᴅ|ᴇᴠᴇɴɪɴɢ|ʜᴇʏ/.test(out), out.split('\n')[2]);
    check('G: it carries the push name', out.includes('*Tester*'), out.split('\n')[2]);
    check('G: no resume prompt appears', !decf(out).includes('we were this close'), decf(out));
    check('G: no Language-only heading', !out.startsWith('> *\u{1F310}'), out.split('\n')[0]);
  }

  // =====================================================================
  // H. No regression for a completed user
  // =====================================================================
  {
    const jid = '910000000000007@lid';
    await makeNewUser(jid, 'en');
    const user = await getUserByJid(jid);
    check('H: a long gap routes to welcomeBack', pickSpeaker({ user, session: {}, gap: 3 * D }) === 'welcomeBack');
    check('H: a short gap routes to menu', pickSpeaker({ user, session: {}, gap: 10e3 }) === 'menu');
    const long = welcome.buildWelcomeBackMessage(user, 3 * D, { jid });
    check('H: the B2 welcome still renders', decf(welcome.renderWelcomeBack(long, 'en')).includes('welcome back'));
    check('H: B1/B2/B3 variants still exist', ['B1', 'B2', 'B3']
      .every((v) => welcome.classifyWelcomeBack(user, v === 'B1' ? 45e3 : v === 'B2' ? 3 * D : 10 * D).variant === v));
    check('H: welcome-back is not offered mid-onboarding',
      pickSpeaker({ user: { ...user, language: null }, session: {}, gap: 3 * D }) === 'resume');
  }

  // =====================================================================
  // Wiring: the router must route through the coordinator
  // =====================================================================
  {
    const idx = fs.readFileSync(path.join(root, 'src/index.js'), 'utf8');
    check('the router imports pickSpeaker', idx.includes("from './utils/pickSpeaker.js'"));
    check('the router imports the resume handler', idx.includes("from './handlers/resumeHandler.js'"));
    check('the router calls pickSpeaker', idx.includes('pickSpeaker({'));
    check('the router checks awaitingResumeConfirmation first', idx.indexOf('awaitingResumeConfirmation === true') < idx.indexOf('speaker === \'welcomeBack\''));
    check('welcome-back is gated on the speaker', idx.includes("if (speaker === 'welcomeBack')"));
    check('the resume prompt consumes the message', /speaker === 'cooldown'[\s\S]{0,900}return;/.test(idx));

    const lo = fs.readFileSync(path.join(root, 'src/handlers/languageOnboardingHandler.js'), 'utf8');
    check('the cooldown branch no longer sends', !/STAGE\.LOCKED\)[\s\S]{0,400}sendText/.test(lo), 'a sendText survived the cooldown branch');
    check('the cooldown branch sets cooldownJustExpired', lo.includes('cooldownJustExpired: true'));
    check('buildDetectedMessage supports skipGreeting', lo.includes('opts.skipGreeting'));
    check('language names are small-capped in the detected message', /toSmallCaps\(name\)/.test(lo));

    const { t } = await import('../src/services/localeService.js');
    for (const lang of ['en', 'fr', 'de', 'es', 'ar']) {
      for (const key of ['resumeHeading', 'resumeBody', 'resumeOptionYes', 'resumeOptionNo', 'resumeReplyHint', 'resumeCloseHeading', 'resumeCloseBody', 'resumeCloseHint', 'resumeLanguageHeading', 'resumeNudge1', 'resumeNudge2', 'resumeNudge3']) {
        check(`${lang}: onboarding.${key} resolves`, t(lang, 'onboarding.' + key) !== 'onboarding.' + key);
      }
    }
  }
} finally {
  restoreData();
}

console.log(fails === 0 ? 'ALL PASS' : fails + ' FAILURES');
process.exit(fails === 0 ? 0 : 1);