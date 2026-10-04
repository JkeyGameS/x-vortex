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
import { getTimeOfDay } from '../utils/timeOfDay.js';
import { sanitizePushName } from '../utils/pushNameHelper.js';
import { getContent } from '../services/botContentService.js';
import { resolvePlaceholders } from '../utils/placeholderResolver.js';
import { getLanguageDisplay } from '../utils/languageHelper.js';
import { cooldownLockMs, retryMaxAttempts } from '../utils/botTiming.js';

// Re-exported so existing callers keep a single import site for the greeting
// name validator; the implementation now lives in utils/pushNameHelper.js.
export { sanitizePushName };
import { sendText } from '../services/messageService.js';
import { buildMenu } from '../utils/menuBuilder.js';
import { handleLanguageSelection, buildLanguageMenu } from './languageCommand.js';
import { logAdminAction } from '../services/adminLogService.js';
import { isBotNotifyEnabled } from '../config/notificationToggles.js';
import * as userStats from '../services/userStatsService.js';

export const ONBOARDING_MENU = 'language_onboarding';
// Admin-editable via System Settings -> Bot Content -> Timing. These are the
// code fallbacks; botTiming prefers the content store when it has a value.
export const MAX_ATTEMPTS = retryMaxAttempts();
export const COOLDOWN_MS = cooldownLockMs();

// Explicit sub-states. Without these, "no language yet" alone was enough for the
// gate to restart onboarding, so a user who had already been handed the
// 5-language menu got the confirmation prompt again instead of picking a
// language.
export const STAGE = {
  CONFIRM: 'confirm_detected',
  CHOOSE: 'choose_language',
  RETRY: 'awaiting_retry',
  LOCKED: 'locked'
};

// Sessions that are already inside a language flow. The gate must not restart
// onboarding for these, otherwise the confirmation prompt is re-sent and the
// chosen language is never applied.
const IN_LANGUAGE_FLOW = new Set(['language_selection', 'pref_language_selection', 'language_onboarding']);

// How long the bot shows "composing" before the first onboarding message.
const TYPING_DELAY_MS = 1200;

// Native language names and flags, kept in code (never in translations) so
// they render correctly regardless of the UI language.
export const LANGUAGES = ['en', 'fr', 'de', 'es', 'ar'];

export const LANGUAGE_NAMES = {
  en: 'English',
  fr: 'Français',
  de: 'Deutsch',
  es: 'Español',
  ar: 'العربية'
};

export const LANGUAGE_FLAGS = {
  en: '🇬🇧',
  fr: '🇫🇷',
  de: '🇩🇪',
  es: '🇪🇸',
  ar: '🇸🇦'
};

export const LANGUAGES_WITH_FLAGS = LANGUAGES.map((l) => `${LANGUAGE_FLAGS[l]} ${LANGUAGE_NAMES[l]}`);

// First-message keyword hints. A greeting in the user's own language is a
// stronger signal about what they want than the device locale.
export const LANG_KEYWORDS = {
  en: ['hello', 'hi', 'hey', 'help'],
  fr: ['bonjour', 'salut', 'merci', 'aide'],
  de: ['hallo', 'guten', 'hilfe'],
  es: ['hola', 'buenos', 'ayuda'],
  ar: ['مرحبا', 'سلام', 'مساعدة']
};

// Emoji-only shortcuts, matched on the whole trimmed message.
const EMOJI_YES = new Set(['\u{1F44D}', '✅']);
const EMOJI_NO = new Set(['\u{1F310}', '\u{1F501}']);

/**
 * Match a first message against LANG_KEYWORDS.
 * @returns {string|null} supported language code, or null
 */
export function detectLanguageFromText(text) {
  const value = normalizeReply(text);
  if (!value) return null;
  let best = null;
  let bestLen = 0;
  for (const [lang, words] of Object.entries(LANG_KEYWORDS)) {
    for (const word of words) {
      if (value === word || value.includes(word)) {
        // Longest match wins so "bonjour" beats a stray "hi".
        if (word.length > bestLen) { best = lang; bestLen = word.length; }
      }
    }
  }
  return best;
}

/**
 * Greeting line for a time of day.
 * @param {string} language UI language (the greeting is localized)
 * @param {string} bucket one of morning/afternoon/evening/night
 * @param {boolean} hasName whether a usable push name was supplied
 */
export function greetingFor(language, bucket, hasName) {
  const key = {
    morning: 'onboarding.langGreetingMorning',
    afternoon: 'onboarding.langGreetingAfternoon',
    evening: 'onboarding.langGreetingEvening',
    night: 'onboarding.langGreetingHey'
  }[bucket] || 'onboarding.langGreetingHey';
  if (hasName) return { prefix: L(language, key), fallback: false };
  return { prefix: L(language, 'onboarding.langGreetingHello'), fallback: true };
}

/** True when the trimmed message is exactly one of the emoji shortcuts. */
export function emojiShortcut(text) {
  const value = String(text ?? '').replace(/\s+/g, '');
  if (!value) return null;
  if (EMOJI_YES.has(value)) return 'yes';
  if (EMOJI_NO.has(value)) return 'no';
  return null;
}


// menu number for each language, matching handleLanguageSelection's own map
const NUMBER_BY_LANG = { en: '1', fr: '2', de: '3', es: '4', ar: '5' };

// Single source for the flag emoji: the admin notifications use them too.
const FLAG_BY_LANG = LANGUAGE_FLAGS;
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

/**
 * A2: supported device language, ask to confirm.
 * @param {string} language UI language for the static text
 * @param {string} detectedLang the language being suggested
 * @param {{ pushName?: string, timezone?: string, now?: Date }} opts
 */
export function buildDetectedMessage(language, detectedLang, opts = {}) {
  // Name and flag are admin-editable (botContent.languageDisplay); the code
  // constants stay as the fallback. getLanguageDisplay applies the cap.
  const display = getLanguageDisplay(detectedLang);
  const withFlag = display.full || detectedLang;
  const clean = sanitizePushName(opts.pushName, opts.jid);

  const lines = [];

  if (opts.skipGreeting) {
    // Resume flow: the user already met the bot, so drop the brand heading and
    // the time-of-day greeting and keep only the core language prompt.
    lines.push(`> *\u{1F310} ${L(language, 'onboarding.resumeLanguageHeading')}*`, '');
  } else {
    const bucket = getTimeOfDay(opts.now || new Date(), opts.timezone || 'UTC');
    const { prefix, fallback } = greetingFor(language, bucket, Boolean(clean));
    const greeting = resolvePlaceholders(getContent('onboarding.firstMessage.greeting'), {
      timeOfDay: prefix,
      pushName: clean || ''
    });
    lines.push(brandGreeting(), '', greeting, '');
  }

  // The templates reference {languageName} / {languageFlag}, so pass the
  // display parts (not the joined string) as the context.
  const ctx = { languageName: display.name, languageFlag: display.flag };
  lines.push(
    detectedLineFor(language, display),
    '',
    resolvePlaceholders(getContent('onboarding.firstMessage.languagesPreview'), ctx),
    '',
    resolvePlaceholders(getContent('onboarding.firstMessage.question'), ctx),
    '',
    // The option NUMBERS stay in code: input handling accepts "1" and "2", so
    // they are behaviour, not content.
    '1. ' + resolvePlaceholders(getContent('onboarding.firstMessage.option1'), ctx),
    '2. ' + resolvePlaceholders(getContent('onboarding.firstMessage.option2'), ctx),
    '',
    resolvePlaceholders(getContent('onboarding.firstMessage.notSupportedHint'), ctx),
    '',
    '_' + resolvePlaceholders(getContent('onboarding.firstMessage.replyHint'), ctx) + '_'
  );
  return lines.join('\n');
}

/**
 * "I detected your device language is *Français 🇫🇷*."
 *
 * The template owns its own emoji and bolding. resolvePlaceholders caps the
 * static runs and splices the name and flag in already-capped. `display` may be
 * a {name, flag} object or a pre-joined "name flag" string.
 */
export function detectedLineFor(language, display) {
  const parts = typeof display === 'string'
    ? { name: display, flag: '' }
    : (display || { name: '', flag: '' });
  return resolvePlaceholders(getContent('onboarding.firstMessage.detectedLine'), {
    languageName: parts.name,
    languageFlag: parts.flag
  });
}

/** A4: device language is not one we support; ask for a number 1-5 in English. */
export function buildUnsupportedMessage(rawName) {
  return [
    brandGreeting(),
    '',
    resolvePlaceholders(getContent('onboarding.unsupportedLanguage.message'), { detectedRaw: rawName }),
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
  return resolvePlaceholders(
    getContent(`onboarding.retry.attempt${(attemptIndex % MAX_ATTEMPTS) + 1}`)
  );
}

/** A6: cooldown lock notice. */
export function buildCooldownMessage(language, minutes) {
  return [
    '> *' + resolvePlaceholders(getContent('onboarding.cooldownLock.heading'), {}) + '*',
    '',
    resolvePlaceholders(getContent('onboarding.cooldownLock.body'), { cooldownMinutes: minutes })
  ].join('\n');
}

/**
 * The cooldown-expiry reminder this used to render is gone (Prompt C). The lock
 * now expires silently and resumeHandler sends one resume prompt on the next
 * message. Its name was also colliding with welcomeBackService's builder of the
 * same name, so removing it leaves one unambiguous entry point.
 */

// ---------------------------------------------------------------------------
// Session helpers
// ---------------------------------------------------------------------------

export function isOnboardingLocked(session) {
  const until = Number(session?.languageOnboardingLockedUntil || 0);
  return Number.isFinite(until) && until > Date.now();
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
      // bypassRateLimit: a new-user notification is a system notification. It must
        // still reach the admin while the limiter is throttling ordinary chat.
        const ok = await sendText(sock, jid, text, { type: 'silent', bypassRateLimit: true });
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
  const deviceLang = normalizeLanguage(rawLocale);
  const supported = deviceLang !== null || !rawLocale;

  // A first message in the user's own language beats the device locale: someone
  // typing "bonjour" wants French even on an English phone. A bare "hi" is not
  // proof of English though -- it is what people type on any phone, so it must
  // not drag a French phone back to English.
  const hinted = supported ? detectLanguageFromText(context.text) : null;
  const override = Boolean(hinted) && (hinted !== 'en' || !deviceLang);
  const detected = override ? hinted : deviceLang || config.defaultLanguage;
  const source = override ? 'message' : 'device';

  const recorded = userStats.recordNewUser(sender, {
    pushName,
    deviceLanguage: supported ? detected : null,
    deviceLanguageRaw: rawLocale || null,
    platform
  });

  sessionManager.setState(sender, chatId, {
    currentMenu: ONBOARDING_MENU,
    onboardingStage: STAGE.CONFIRM,
    detectedLanguage: supported ? detected : null,
    detectedLanguageRaw: rawLocale || null,
    detectedLanguageSource: supported ? source : null,
    onboardingAttempts: 0,
    onboardingLastRetry: -1,
    languageOnboardingLockedUntil: null,
    onboardingLanguageChoice: null
  });

  const language = supported ? detected : 'en';

  // A brief "composing" presence so the first message does not feel abrupt.
  const typingMs = Number.isFinite(context.typingDelayMs) ? context.typingDelayMs : TYPING_DELAY_MS;
  try {
    await sock.sendPresenceUpdate('composing', sender);
    if (typingMs > 0) await new Promise((resolve) => setTimeout(resolve, typingMs));
  } catch (err) {
    logger.debug({ err, sender }, '[ONBOARD] typing presence failed');
  }

  await sendText(sock, sender, supported
    ? buildDetectedMessage(language, detected, {
      pushName,
      jid: sender,
      timezone: context.timezone,
      now: context.now
    })
    : buildUnsupportedMessage(deviceLanguageName(rawLocale)));

  logAdminAction(sender, 'onboarding_started',
    `deviceLanguage=${rawLocale || 'unknown'} -> ${supported ? detected : 'unsupported'} (${source})`);
  logger.info({ sender, deviceLocale: rawLocale, detected: supported ? detected : null, source, firstTime: recorded.firstTime }, '[ONBOARD] started');

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

/**
 * Hand off to the standard 5-language menu.
 * The session records stage 'choose_language' while currentMenu becomes
 * 'language_selection', so the pre-existing language flow handles 1-5, 9 (help)
 * and invalid input. The stage is what stops the gate from restarting
 * onboarding for a user who still has no language.
 */
async function openLanguageChooser(context) {
  const { sock, sender, chatId } = context;
  sessionManager.setState(sender, chatId, {
    currentMenu: 'language_selection',
    onboardingStage: STAGE.CHOOSE,
    isLanguageSelectionPending: true,
    onboardingAttempts: 0,
    onboardingLastRetry: -1,
    languageOnboardingLockedUntil: null
  });
  await sendText(sock, sender, buildLanguageMenu());
  return true;
}

/**
 * Drop every onboarding field while leaving currentMenu alone, so the handler
 * that completes the language pick keeps routing normally.
 */
function clearOnboardingFlags(sender, chatId) {
  sessionManager.setState(sender, chatId, {
    onboardingStage: null,
    onboardingAttempts: 0,
    onboardingLastRetry: -1,
    onboardingLanguageChoice: null,
    languageOnboardingLockedUntil: null,
    detectedLanguage: null,
    detectedLanguageRaw: null,
    detectedLanguageSource: null
  });
}

/** "0" on the 5-language menu returns to the detection confirmation. */
async function returnToConfirmation(context) {
  const { sock, sender, chatId } = context;
  const session = sessionManager.getSession(sender, chatId) || {};
  const detected = session.detectedLanguage;
  sessionManager.setState(sender, chatId, {
    currentMenu: ONBOARDING_MENU,
    onboardingStage: STAGE.CONFIRM,
    isLanguageSelectionPending: false,
    onboardingAttempts: 0,
    onboardingLastRetry: -1,
    languageOnboardingLockedUntil: null
  });
  await sendText(sock, sender, detected
    ? buildDetectedMessage(detected, detected, {
      pushName: context.pushName,
      jid: sender,
      timezone: context.timezone,
      now: context.now
    })
    : buildUnsupportedMessage(deviceLanguageName(session.detectedLanguageRaw)));
  return true;
}

async function completeOnboarding(context, chosenLanguage, attempts) {
  const { sock, sender, chatId, pushName } = context;
  const number = NUMBER_BY_LANG[chosenLanguage];
  if (!number) return openLanguageChooser(context);

  userStats.recordOnboardingCompleted(sender, chosenLanguage, attempts);
  sessionManager.setState(sender, chatId, {
    currentMenu: null,
    onboardingStage: null,
    isLanguageSelectionPending: false,
    onboardingAttempts: 0,
    onboardingLastRetry: -1,
    onboardingLanguageChoice: chosenLanguage,
    languageOnboardingLockedUntil: null,
    detectedLanguage: null,
    detectedLanguageRaw: null,
    detectedLanguageSource: null
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
    onboardingStage: STAGE.LOCKED,
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
 * Handle one message while the user is in stage 'confirm_detected',
 * 'awaiting_retry' or 'locked'.
 * @returns {Promise<boolean>} true when the message was consumed.
 */
async function handleOnboardingReply(context, session) {
  const { sender, chatId } = context;
  const text = String(context.text ?? '').trim();
  const detected = session.detectedLanguage;
  const language = detected || config.defaultLanguage;
  const stage = session.onboardingStage || STAGE.CONFIRM;

  // 1. Emoji shortcuts and yes/no, in any supported language.
  const shortcut = emojiShortcut(text);
  if (shortcut === 'yes' && detected) {
    return completeOnboarding(context, detected, session.onboardingAttempts || 0);
  }
  if (shortcut === 'no' || isNoReply(text)) {
    return openLanguageChooser(context);
  }
  if (isYesReply(text) && detected) {
    return completeOnboarding(context, detected, session.onboardingAttempts || 0);
  }

  // 2. Numbers. With a detected language the prompt offers 1 (accept) and
  //    2 (choose another). Without one, the unsupported-locale prompt asks for
  //    a number 1-5 directly.
  if (/^[0-5]$/.test(text)) {
    if (!detected) {
      if (text === '0') return openLanguageChooser(context);
      return completeOnboarding(context, { 1: 'en', 2: 'fr', 3: 'de', 4: 'es', 5: 'ar' }[text], session.onboardingAttempts || 0);
    }
    if (text === '1') return completeOnboarding(context, detected, session.onboardingAttempts || 0);
    // 0 and 2 both mean "pick another"; any other number is not on the prompt,
    // so treat it as unclear and retry rather than silently navigating.
    if (text === '0' || text === '2') return openLanguageChooser(context);
  }

  // 3. Unclear: rotate the three retry prompts, then lock.
  const attempts = (session.onboardingAttempts || 0) + 1;
  userStats.recordOnboardingAttempt(sender, attempts);
  if (attempts >= MAX_ATTEMPTS) {
    return applyCooldown(context, session, attempts);
  }
  let index = (session.onboardingLastRetry ?? -1) + 1;
  if (index >= MAX_ATTEMPTS) index = 0;
  if (index === session.onboardingLastRetry) index = (index + 1) % MAX_ATTEMPTS;
  sessionManager.setState(sender, chatId, {
    currentMenu: ONBOARDING_MENU,
    onboardingStage: STAGE.RETRY,
    onboardingAttempts: attempts,
    onboardingLastRetry: index
  });
  await sendText(context.sock, sender, buildRetryMessage(language, index));
  logger.debug({ sender, stage, attempts }, '[ONBOARD] retry sent');
  return true;
}

/**
 * Entry point placed ahead of command dispatch. Returns true when the message
 * must not fall through to any other flow.
 */
export async function handleLanguageOnboardingGate(context, session, user) {
  const { sock, sender, chatId } = context;
  const stage = session?.onboardingStage || null;
  const input = String(context.text ?? '').trim();
  logger.debug({ sender, stage, currentMenu: session?.currentMenu, input }, '[ONBOARD] input');

  // Safety net for the /try control commands (Part 1). The router intercept
  // handles these first, but if it ever misses, onboarding must not consume the
  // message -- otherwise the admin is locked out of try mode by a prompt asking
  // them to pick a language. Covers the cooldown lock too, since it lives here.
  if (/^\/try(\s|$)/i.test(input)) return false;

  // Cooldown lock: silently ignore everything until it expires (C3).
  if (isOnboardingLocked(session)) return true;

  // The lock expires silently (Prompt C). It used to send a "Welcome back!
  // Let's try again." reminder plus a fresh confirmation, which combined with
  // the welcome-back greeting to produce up to three replies to one message.
  // pickSpeaker now returns 'cooldown' for the first message after expiry and
  // the router sends a single resume prompt instead.
  if (stage === STAGE.LOCKED) {
    sessionManager.setState(sender, chatId, {
      languageOnboardingLockedUntil: null,
      onboardingStage: STAGE.CONFIRM,
      onboardingAttempts: 0,
      onboardingLastRetry: -1,
      cooldownJustExpired: true,
      currentMenu: ONBOARDING_MENU
    });
    logger.debug({ sender }, '[ONBOARD] cooldown expired silently');
    return true;
  }

  // On the 5-language menu. "0" returns to the confirmation prompt; everything
  // else (1-5, 9 = help, invalid input) belongs to the existing
  // 'language_selection' flow, so it must fall through. A 1-5 pick is the user
  // committing, so the onboarding flags are cleared here -- the completing
  // handler is languageCommand's, which knows nothing about these fields.
  if (stage === STAGE.CHOOSE) {
    if (input === '0') return returnToConfirmation(context);
    if (/^[1-5]$/.test(input)) clearOnboardingFlags(sender, chatId);
    return false;
  }

  if (session?.currentMenu === ONBOARDING_MENU) {
    return handleOnboardingReply(context, session);
  }

  // Root-cause guard: a user who has no language but is already inside a
  // language flow must not be sent the confirmation prompt again. Without this,
  // picking 1-5 from the 5-language menu restarted onboarding, so the chosen
  // language was never applied. Keyed on currentMenu only -- a stale
  // isLanguageSelectionPending flag must never be able to block onboarding.
  if (IN_LANGUAGE_FLOW.has(session?.currentMenu)) return false;

  // First-ever message from a user who has no language yet.
  if (!user?.language) {
    return startOnboarding(context, session);
  }
  return false;
}
