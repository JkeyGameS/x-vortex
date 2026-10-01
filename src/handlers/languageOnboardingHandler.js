// Smart first-time language onboarding (Part A) plus the admin notifications
// that go with it (Part B).
//
// A user with no language yet is asked to confirm the language detected from
// their device instead of being dropped straight into the 5-language menu. They
// can accept it, pick another, or just type yes/no in any supported language.
// Three unrecognised replies trigger a cooldown lock so the bot stops answering
// a confused user (and stops logging every message they send).
//
// While `currentMenu === 'language_onboarding'` this handler owns the reply:
// commands, chat rules and fallbacks are all bypassed (A8/C2).
import config from '../config/config.js';
import logger from '../utils/logger.js';
import sessionManager from '../utils/sessionManager.js';
import settingsService from '../services/settingsService.js';
import { t } from '../services/localeService.js';
import { toSmallCaps } from '../utils/smallCaps.js';
import { sendText } from '../services/messageService.js';
import { buildMenu } from '../utils/menuBuilder.js';
import { handleLanguageSelection, buildLanguageMenu } from './languageCommand.js';
import { logAdminAction } from '../services/adminLogService.js';
import { isBotNotifyEnabled } from '../config/notificationToggles.js';
import * as userStats from '../services/userStatsService.js';

export const ONBOARDING_MENU = 'language_onboarding';
export const MAX_ATTEMPTS = 3;
export const COOLDOWN_MS = 5 * 60 * 1000;

const LANGUAGES = ['en', 'fr', 'de', 'es', 'ar'];

// menu number for each language, matching handleLanguageSelection's own map
const NUMBER_BY_LANG = { en: '1', fr: '2', de: '3', es: '4', ar: '5' };

const FLAG_BY_LANG = { en: '🇬🇧', fr: '🇫🇷', de: '🇩🇪', es: '🇪🇸', ar: '🇸🇦' };
const NAME_KEY_BY_LANG = {
  en: 'languageNameEnglish',
  fr: 'languageNameFrench',
  de: 'languageNameGerman',
  es: 'languageNameSpanish',
  ar: 'languageNameArabic'
};

// Human-readable names for device locales we do not support, so the unsupported
// notice reads "Portuguese" instead of "pt-BR".
const DEVICE_LANGUAGE_NAMES = {
  pt: 'Portuguese', it: 'Italian', ru: 'Russian', zh: 'Chinese', ja: 'Japanese',
  ko: 'Korean', tr: 'Turkish', pl: 'Polish', nl: 'Dutch', hi: 'Hindi',
  id: 'Indonesian', vi: 'Vietnamese', th: 'Thai', sv: 'Swedish', da: 'Danish',
  fi: 'Finnish', no: 'Norwegian', uk: 'Ukrainian', ro: 'Romanian', cs: 'Czech',
  el: 'Greek', he: 'Hebrew', hu: 'Hungarian', bn: 'Bengali', ur: 'Urdu'
};

// ---------------------------------------------------------------------------
// Device language
// ---------------------------------------------------------------------------

// Set from connection.update (node.userAgent.localeLanguageIso6391). Baileys only
// sends it on connect, so the last value is kept for the lifetime of the process.
//
// Caveat: the installed Baileys hardcodes localeLanguageIso6391 to 'en' in its
// getUserAgent() and describes the bot's own client, so this is usually absent or
// uninformative. Callers may pass an explicit deviceLocale instead. When nothing
// is known, detection falls back to the default language, which still yields the
// full confirmation flow.
let lastDeviceLocale = null;
let lastDevicePlatform = null;

export function recordDeviceLocale(rawCode) {
  const code = typeof rawCode === 'string' ? rawCode.trim() : '';
  if (code) lastDeviceLocale = code;
}

/**
 * Platform label from connection.update's node.userAgent, e.g. "Android 14" /
 * "iOS". WaWeb/desktop report SMARTPHONE-less values and are left as-is.
 */
export function recordDevicePlatform(rawPlatform, rawOs) {
  const platform = typeof rawPlatform === 'string' ? rawPlatform.trim() : '';
  if (!platform) return;
  const os = typeof rawOs === 'string' ? rawOs.trim() : '';
  // Baileys reports platform "SMARTPHONE" for phones; the useful part is the OS.
  if (platform.toUpperCase() === 'SMARTPHONE' && os) lastDevicePlatform = os;
  else lastDevicePlatform = os ? `${platform} ${os}` : platform;
}

export function getDeviceLocale() {
  return lastDeviceLocale;
}

export function getDevicePlatform() {
  return lastDevicePlatform;
}

export function resetDeviceLocale() {
  lastDeviceLocale = null;
  lastDevicePlatform = null;
}

/** ISO 639-1 -> one of the five supported languages, or null when unsupported. */
export function normalizeLanguage(code) {
  if (!code || typeof code !== 'string') return null;
  const c = code.toLowerCase();
  for (const lang of LANGUAGES) {
    if (c.startsWith(lang)) return lang;
  }
  return null;
}

/** Best-effort human name for an unsupported device locale. */
export function deviceLanguageName(raw) {
  if (!raw) return t('en', 'onboarding.notice.unknown');
  const base = String(raw).toLowerCase().split(/[-_]/)[0];
  return DEVICE_LANGUAGE_NAMES[base] || String(raw);
}

// ---------------------------------------------------------------------------
// Yes / no vocabulary (matched across every supported language)
// ---------------------------------------------------------------------------

const YES_WORDS = {
  en: ['yes', 'y', 'yeah', 'yep', 'yup', 'sure', 'ok', 'okay', 'aye'],
  fr: ['oui', 'ouais', 'y', 'ok', "d'accord", "d accord"],
  de: ['ja', 'j', 'jawohl', 'klar', 'ok'],
  es: ['si', 'sí', 'yes', 'ok', 'vale', 'claro'],
  ar: ['نعم', 'اي', 'أجل', 'اوكي', 'حسنا']
};

const NO_WORDS = {
  en: ['no', 'n', 'nope', 'nah', 'nay'],
  fr: ['non', 'nan', 'nope'],
  de: ['nein', 'n', 'nee'],
  es: ['no', 'nop'],
  ar: ['لا', 'لأ', 'مش']
};

const NORMALIZE_STRIP = /[.!?,;:¿¡"'`~^*_\-–—()[\]{}]/g;

/** Lowercase, trim and drop punctuation, keeping Arabic letters intact. */
export function normalizeReply(text) {
  return String(text ?? '').trim().toLowerCase().replace(NORMALIZE_STRIP, '').replace(/\s+/g, ' ');
}

export function isYesReply(text) {
  const v = normalizeReply(text);
  if (!v) return false;
  return Object.values(YES_WORDS).some((list) => list.includes(v));
}

export function isNoReply(text) {
  const v = normalizeReply(text);
  if (!v) return false;
  return Object.values(NO_WORDS).some((list) => list.includes(v));
}

// ---------------------------------------------------------------------------
// Message builders
// ---------------------------------------------------------------------------

const L = (language, key, params) => toSmallCaps(t(language, key, params));

function brandGreeting() {
  return '👋🏼 *' + toSmallCaps(settingsService.getBotName() || 'X-Vortex') + '*';
}

/** A2: supported device language, ask to confirm. */
export function buildDetectedMessage(language, detectedLang) {
  const name = t(language, 'onboarding.' + NAME_KEY_BY_LANG[detectedLang]);
  return [
    brandGreeting(),
    '',
    // {language} is substituted before small-capping, so the bolded name comes
    // out in small caps exactly like the surrounding sentence.
    L(language, 'onboarding.langDetectHello', { language: name }),
    '',
    L(language, 'onboarding.langDetectQuestion'),
    '',
    '1. ✅ ' + L(language, 'onboarding.langDetectYes', { language: name }),
    '2. 🌐 ' + L(language, 'onboarding.langDetectChoose'),
    '',
    '_' + L(language, 'onboarding.langDetectPrompt') + '_'
  ].join('\n');
}

/** A4: device language is not one we support; ask for a number 1-5 in English. */
export function buildUnsupportedMessage(rawName) {
  return [
    brandGreeting(),
    '',
    L('en', 'onboarding.langUnsupportedNotice', { raw: rawName }),
    '',
    L('en', 'onboarding.langUnsupportedPlease'),
    '',
    '1. ' + L('en', 'onboarding.languageEnglish'),
    '2. ' + L('en', 'onboarding.languageFrench'),
    '3. ' + L('en', 'onboarding.languageGerman'),
    '4. ' + L('en', 'onboarding.languageSpanish'),
    '5. ' + L('en', 'onboarding.languageArabic'),
    '',
    '_' + L('en', 'onboarding.languageReplyPrompt') + '_'
  ].join('\n');
}

/** A5: one of three rotating "I didn't get that" prompts. */
export function buildRetryMessage(language, attemptIndex) {
  return L(language || 'en', 'onboarding.langRetry' + ((attemptIndex % MAX_ATTEMPTS) + 1));
}

/** A6: cooldown lock notice. */
export function buildCooldownMessage(language, minutes) {
  return [
    '⏳ *' + L(language || 'en', 'onboarding.langCooldownTitle') + '*',
    '',
    L(language || 'en', 'onboarding.langCooldownBody', { minutes: String(minutes) })
  ].join('\n');
}

/** A7: reminder once the cooldown expires. */
export function buildWelcomeBackMessage(language) {
  return [
    '👋🏼 *' + L(language || 'en', 'onboarding.langWelcomeBackTitle') + '*',
    '',
    L(language || 'en', 'onboarding.langWelcomeBackBody')
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Session helpers
// ---------------------------------------------------------------------------

export function isOnboardingLocked(session) {
  const until = Number(session?.languageOnboardingLockedUntil || 0);
  return Number.isFinite(until) && until > Date.now();
}

function clearOnboarding(session) {
  return session?.currentMenu === ONBOARDING_MENU;
}

// ---------------------------------------------------------------------------
// Admin notifications (Part B)
// ---------------------------------------------------------------------------

function relativeTime(iso) {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return '';
  const secs = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

const N = (key, params) => toSmallCaps(t('en', 'onboarding.notice.' + key, params));

async function broadcastToAdmins(sock, text) {
  const admins = config.adminJids || [];
  if (!admins.length) return 0;
  let sent = 0;
  for (const jid of admins) {
    try {
      const ok = await sendText(sock, jid, text, { type: 'silent' });
      if (ok !== false) sent++;
    } catch (err) {
      logger.error({ err, jid }, '[ONBOARD] admin notification failed');
    }
  }
  return sent;
}

export async function notifyNewUser(sock, meta) {
  const stats = userStats.getAllStats();
  const supported = meta.detectedLanguage;
  const flag = supported ? FLAG_BY_LANG[supported] : '';
  const langLine = supported
    ? `${flag} ${toSmallCaps(t('en', 'onboarding.' + NAME_KEY_BY_LANG[supported]))}`
    : `${N('unsupported')}: ${meta.deviceLanguageRaw || N('unknown')}`;
  const text = [
    toSmallCaps('🤖') + ' *' + N('newUserTitle') + '*',
    '',
    toSmallCaps('👤') + ' ' + N('name') + ': ' + (meta.pushName || N('unknown')),
    toSmallCaps('🆔') + ' ' + N('id') + ': ' + meta.jid,
    toSmallCaps('🌐') + ' ' + N('deviceLanguage') + ': ' + langLine,
    toSmallCaps('📱') + ' ' + N('platform') + ': ' + (meta.platform || N('unknown')),
    toSmallCaps('🕒') + ' ' + N('time') + ': ' + relativeTime(meta.firstSeen) + ' (' + meta.firstSeen + ')',
    '',
    toSmallCaps('📊') + ' ' + N('totalUsers') + ': ' + stats.totalUsers +
      ' | ' + toSmallCaps('🆕') + ' ' + N('today') + ': ' + userStats.getNewToday() +
      ' | ' + toSmallCaps('📅') + ' ' + N('thisWeek') + ': ' + userStats.getNewThisWeek(),
    '',
    toSmallCaps('🎯') + ' ' + N('statusStarted'),
    '',
    '_' + N('footer') + '_'
  ].join('\n');
  return broadcastToAdmins(sock, text);
}

export async function notifyOnboardingComplete(sock, meta) {
  const stats = userStats.getAllStats();
  const text = [
    toSmallCaps('🤖') + ' *' + N('completeTitle') + '*',
    '',
    toSmallCaps('👤') + ' ' + N('name') + ': ' + (meta.pushName || N('unknown')),
    toSmallCaps('🆔') + ' ' + N('id') + ': ' + meta.jid,
    toSmallCaps('🌐') + ' ' + N('chosenLanguage') + ': ' +
      (FLAG_BY_LANG[meta.chosenLanguage] || '') + ' ' +
      toSmallCaps(t('en', 'onboarding.' + (NAME_KEY_BY_LANG[meta.chosenLanguage] || 'languageNameEnglish'))),
    toSmallCaps('🕒') + ' ' + N('gotThroughIn') + ': ' + meta.attempts + ' ' + N('attempts'),
    '',
    toSmallCaps('📊') + ' ' + N('totalUsers') + ': ' + stats.totalUsers +
      ' | ' + toSmallCaps('🆕') + ' ' + N('today') + ': ' + userStats.getNewToday(),
    '',
    toSmallCaps('🎯') + ' ' + N('statusCompleted'),
    '',
    '_' + N('footer') + '_'
  ].join('\n');
  return broadcastToAdmins(sock, text);
}

export async function notifyOnboardingAbandoned(sock, meta) {
  const text = [
    toSmallCaps('🤖') + ' *' + N('abandonedTitle') + '*',
    '',
    toSmallCaps('👤') + ' ' + N('name') + ': ' + (meta.pushName || N('unknown')),
    toSmallCaps('🆔') + ' ' + N('id') + ': ' + meta.jid,
    toSmallCaps('🕒') + ' ' + N('gotThroughIn') + ': ' + meta.attempts + ' ' + N('attempts'),
    '',
    toSmallCaps('🎯') + ' ' + N('statusAbandoned'),
    '',
    '_' + N('footer') + '_'
  ].join('\n');
  return broadcastToAdmins(sock, text);
}

// ---------------------------------------------------------------------------
// Flow control
// ---------------------------------------------------------------------------

async function startOnboarding(context, session) {
  const { sock, sender, chatId, pushName } = context;
  const rawLocale = context.deviceLocale || getDeviceLocale();
  const platform = context.platform || getDevicePlatform();
  const detected = normalizeLanguage(rawLocale) || config.defaultLanguage;
  const supported = normalizeLanguage(rawLocale) !== null || !rawLocale;

  const recorded = userStats.recordNewUser(sender, {
    pushName,
    deviceLanguage: supported ? detected : null,
    deviceLanguageRaw: rawLocale || null,
    platform
  });

  sessionManager.setState(sender, chatId, {
    currentMenu: ONBOARDING_MENU,
    detectedLanguage: supported ? detected : null,
    detectedLanguageRaw: rawLocale || null,
    onboardingAttempts: 0,
    onboardingLastRetry: -1,
    languageOnboardingLockedUntil: null,
    onboardingLanguageChoice: null
  });

  const language = supported ? detected : 'en';
  await sendText(sock, sender, supported
    ? buildDetectedMessage(language, detected)
    : buildUnsupportedMessage(deviceLanguageName(rawLocale)));

  logAdminAction(sender, 'onboarding_started',
    `deviceLanguage=${rawLocale || 'unknown'} -> ${supported ? detected : 'unsupported'}`);
  logger.info({ sender, deviceLocale: rawLocale, detected: supported ? detected : null, firstTime: recorded.firstTime }, '[ONBOARD] started');

  if (recorded.firstTime && isBotNotifyEnabled('onNewUser')) {
    await notifyNewUser(sock, {
      jid: sender,
      pushName,
      detectedLanguage: supported ? detected : null,
      deviceLanguageRaw: rawLocale,
      platform,
      firstSeen: recorded.entry.firstSeen
    });
  }
  return true;
}

async function openLanguageChooser(context) {
  const { sock, sender, chatId } = context;
  sessionManager.setState(sender, chatId, {
    currentMenu: 'language_selection',
    isLanguageSelectionPending: true,
    onboardingAttempts: 0,
    languageOnboardingLockedUntil: null
  });
  await sendText(sock, sender, buildLanguageMenu());
  return true;
}

async function completeOnboarding(context, chosenLanguage, attempts) {
  const { sock, sender, chatId, pushName } = context;
  const number = NUMBER_BY_LANG[chosenLanguage];
  if (!number) return openLanguageChooser(context);

  userStats.recordOnboardingCompleted(sender, chosenLanguage, attempts);
  sessionManager.setState(sender, chatId, {
    currentMenu: null,
    isLanguageSelectionPending: false,
    onboardingAttempts: 0,
    onboardingLanguageChoice: chosenLanguage,
    languageOnboardingLockedUntil: null,
    detectedLanguage: null,
    detectedLanguageRaw: null
  });
  logAdminAction(sender, 'onboarding_completed', `chosenLanguage=${chosenLanguage}; attempts=${attempts}`);
  logger.info({ sender, chosenLanguage, attempts }, '[ONBOARD] completed');

  // Reuse the standard selection flow so the confirmation text, persistence and
  // welcome intro stay identical to the pre-existing path.
  await handleLanguageSelection({ sock, sender, chatId, pushName }, number);

  if (isBotNotifyEnabled('onOnboardingComplete')) {
    await notifyOnboardingComplete(sock, { jid: sender, pushName, chosenLanguage, attempts });
  }
  return true;
}

async function applyCooldown(context, session, attempts) {
  const { sock, sender, chatId } = context;
  const until = Date.now() + COOLDOWN_MS;
  const minutes = Math.round(COOLDOWN_MS / 60000);
  const language = session.detectedLanguage || config.defaultLanguage;

  sessionManager.setState(sender, chatId, {
    currentMenu: ONBOARDING_MENU,
    onboardingAttempts: attempts,
    languageOnboardingLockedUntil: until
  });
  await sendText(sock, sender, buildCooldownMessage(language, minutes));

  userStats.recordOnboardingAbandoned(sender, attempts);
  logAdminAction(sender, 'onboarding_abandoned', `attempts=${attempts}; lockedFor=${COOLDOWN_MS}ms`);
  logger.info({ sender, attempts, until }, '[ONBOARD] cooldown lock engaged');

  if (isBotNotifyEnabled('onOnboardingComplete')) {
    await notifyOnboardingAbandoned(sock, { jid: sender, pushName: context.pushName, attempts });
  }
  return true;
}

/**
 * Handle one message while onboarding is active.
 * @returns {Promise<boolean>} true when the message was consumed.
 */
async function handleOnboardingReply(context, session) {
  const { sender, chatId } = context;
  const text = String(context.text ?? '').trim();
  const detected = session.detectedLanguage;
  const language = detected || config.defaultLanguage;

  // 1. Yes / no in any supported language.
  if (isYesReply(text) && detected) {
    return completeOnboarding(context, detected, session.onboardingAttempts || 0);
  }
  if (isNoReply(text)) {
    return openLanguageChooser(context);
  }

  // 2. Numbers. "1" only means "accept" when something was detected; otherwise
  //    1-5 is the language chooser.
  if (/^[0-5]$/.test(text)) {
    if (text === '1' && detected) {
      return completeOnboarding(context, detected, session.onboardingAttempts || 0);
    }
    if (text === '0') {
      return openLanguageChooser(context);
    }
    const map = { 1: 'en', 2: 'fr', 3: 'de', 4: 'es', 5: 'ar' };
    const chosen = map[text];
    if (session.onboardingLanguageChoice !== undefined && detected === null) {
      // unsupported device language: the greeting asked for 1-5
      return completeOnboarding(context, chosen, session.onboardingAttempts || 0);
    }
    if (detected) {
      // detected language greeting only offers 1 (accept) and 2 (choose another)
      return openLanguageChooser(context);
    }
  }

  // 3. Retry, rotating the three prompts.
  const attempts = (session.onboardingAttempts || 0) + 1;
  userStats.recordOnboardingAttempt(sender, attempts);
  if (attempts >= MAX_ATTEMPTS) {
    return applyCooldown(context, session, attempts);
  }
  let index = (session.onboardingLastRetry ?? -1) + 1;
  if (index >= MAX_ATTEMPTS) index = 0;
  if (index === session.onboardingLastRetry) index = (index + 1) % MAX_ATTEMPTS;
  sessionManager.setState(sender, chatId, { onboardingAttempts: attempts, onboardingLastRetry: index });
  await sendText(context.sock, sender, buildRetryMessage(language, index));
  return true;
}

/**
 * Entry point placed ahead of command dispatch. Returns true when the message
 * must not fall through to any other flow.
 */
export async function handleLanguageOnboardingGate(context, session, user) {
  const { sock, sender, chatId } = context;

  // Cooldown lock: silently ignore everything until it expires (C3).
  if (isOnboardingLocked(session)) {
    return true;
  }

  if (clearOnboarding(session)) {
    // Lock has just expired -> reminder, then the greeting again (A7).
    const lockCleared = session.languageOnboardingLockedUntil;
    if (lockCleared) {
      const detected = session.detectedLanguage;
      const language = detected || config.defaultLanguage;
      sessionManager.setState(sender, chatId, {
        languageOnboardingLockedUntil: null,
        onboardingAttempts: 0,
        onboardingLastRetry: -1,
        currentMenu: ONBOARDING_MENU
      });
      await sendText(sock, sender, buildWelcomeBackMessage(language));
      await sendText(sock, sender, detected
        ? buildDetectedMessage(language, detected)
        : buildUnsupportedMessage(deviceLanguageName(session.detectedLanguageRaw)));
      return true;
    }
    return handleOnboardingReply(context, session);
  }

  // First-ever message from a user who has no language yet.
  if (!user?.language) {
    return startOnboarding(context, session);
  }
  return false;
}
