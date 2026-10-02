// Unified resume flow (Prompt C).
//
// Replaces what used to happen after the onboarding cooldown expired: instead of
// auto-sending a reminder plus a fresh confirmation, the lock now expires
// silently and the user's next message gets one resume prompt. Yes continues
// onboarding from the core prompt (no greeting re-introduction), No closes
// politely, and anything else re-prompts three times before going quiet.
import config from '../config/config.js';
import logger from '../utils/logger.js';
import sessionManager from '../utils/sessionManager.js';
import { t } from '../services/localeService.js';
import { toSmallCaps } from '../utils/smallCaps.js';
import { sendText } from '../services/messageService.js';
import { preferredDisplayName } from '../utils/pushNameHelper.js';
import { STAGE, ONBOARDING_MENU, buildDetectedMessage, buildUnsupportedMessage, deviceLanguageName } from './languageOnboardingHandler.js';

// Emojis are concatenated in code, never carried in translations.
const EMOJI_OK = '\u2705';
const EMOJI_NO = '\u274C';
const EMOJI_WAVE = '\u{1F44B}';

const L = (language, key, params) => toSmallCaps(t(language, key, params));

/**
 * Fill a template that may contain {name} without small-capping the name.
 * toSmallCaps runs only over the static fragments.
 */
function fill(template, name) {
  if (!String(template).includes('{name}')) return toSmallCaps(template);
  const [before, after = ''] = String(template).split('{name}');
  return toSmallCaps(before) + (name || '') + toSmallCaps(after);
}

/** Flags owned by the resume flow, cleared together on every exit path. */
export function clearResumeFlags(sender, chatId) {
  sessionManager.setState(sender, chatId, {
    awaitingResumeConfirmation: false,
    cooldownJustExpired: false,
    resumeFromStage: null,
    resumeAttempts: 0
  });
}

/**
 * Send the resume prompt.
 *
 * The user's next inbound message is what triggers this; nothing is sent the
 * moment the cooldown expires.
 */
export async function sendResumePrompt(context, session, user, gapMs) {
  const { sock, sender, chatId } = context;
  const language = user?.language || config.defaultLanguage;
  const name = preferredDisplayName(user, context.pushName, sender);
  const long = Number.isFinite(gapMs) && gapMs > config.welcomeBack.dayGapMs;

  const heading = L(language, long ? 'onboarding.resumeHeadingLong' : 'onboarding.resumeHeading');
  const body = fill(t(language, long ? 'onboarding.resumeBodyLong' : 'onboarding.resumeBody'), name);

  const text = [
    `> *${EMOJI_WAVE} ${heading}*`,
    '',
    body,
    '',
    `1. ${EMOJI_OK} ${L(language, 'onboarding.resumeOptionYes')}`,
    `2. ${EMOJI_NO} ${L(language, 'onboarding.resumeOptionNo')}`,
    '',
    '_' + L(language, 'onboarding.resumeReplyHint') + '_'
  ].join('\n');

  await sendText(sock, sender, text);
  logger.debug({ sender, long, gapMs }, '[RESUME] prompt sent');
  return true;
}

/**
 * The three escalating nudges for an unclear answer. After the third the flow
 * goes silent and the flags are cleared.
 */
function nudge(language, attempt) {
  if (attempt === 1) {
    return [
      L(language, 'onboarding.resumeNudge1'),
      `1. ${EMOJI_OK} ${L(language, 'onboarding.resumeYesShort')}`,
      `2. ${EMOJI_NO} ${L(language, 'onboarding.resumeNoShort')}`
    ].join('\n');
  }
  if (attempt === 2) {
    return [
      L(language, 'onboarding.resumeNudge2'),
      `1. ${EMOJI_OK} ${L(language, 'onboarding.resumeYesShort')}`,
      `2. ${EMOJI_NO} ${L(language, 'onboarding.resumeNoShort')}`
    ].join('\n');
  }
  return L(language, 'onboarding.resumeNudge3');
}

const normalize = (input) => String(input ?? '')
  .trim()
  .toLowerCase()
  .replace(/[.!?…]+$/u, '')
  .trim();

// Free-text yes/no, including the common non-English forms.
const YES_RE = /^(1|y|yes|yeah|yep|yup|sure|ok|okay|alright|right|oui|ouais|si|s\u00ed|ja|na|نعم|是的|是|да)$/u;
const NO_RE = /^(2|n|no|nope|nah|nyet|non|nein|naa|لا|نہیں|kumala)$/u;

const isYes = (input) => YES_RE.test(normalize(input));
const isNo = (input) => NO_RE.test(normalize(input));
const isEmojiYes = (input) => {
  const v = String(input ?? '').trim();
  return v === '\u{1F44D}' || v === EMOJI_OK;
};
const isEmojiNo = (input) => {
  const v = String(input ?? '').trim();
  return v === EMOJI_NO || v === '\u{1F6D1}';
};

/**
 * Handle one reply while awaiting a resume confirmation.
 *
 * Always consumes the message: while this flag is set, no other handler may see
 * the input.
 *
 * @returns {Promise<boolean>}
 */
export async function handleResumeReply(context, session, user) {
  const { sock, sender, chatId, text } = context;
  const language = user?.language || config.defaultLanguage;
  const attempts = (session?.resumeAttempts || 0) + 1;

  // Yes -> continue from the core onboarding prompt, no greeting re-intro.
  if (isYes(text) || isEmojiYes(text)) {
    clearResumeFlags(sender, chatId);
    sessionManager.setState(sender, chatId, {
      languageOnboardingLockedUntil: null,
      idleClose: false,
      onboardingAttempts: 0,
      onboardingLastRetry: -1
    });
    if (user?.language) return true;

    const detected = session?.detectedLanguage || null;
    const ui = detected || config.defaultLanguage;
    // Restore the stage the user left off at, defaulting to the confirmation.
    const stage = session?.resumeFromStage || STAGE.CONFIRM;
    sessionManager.setState(sender, chatId, {
      currentMenu: ONBOARDING_MENU,
      onboardingStage: stage
    });
    await sendText(sock, sender, detected
      ? buildDetectedMessage(ui, detected, { skipGreeting: true })
      : buildUnsupportedMessage(deviceLanguageName(session?.detectedLanguageRaw)));
    logger.debug({ sender, stage }, '[RESUME] continued');
    return true;
  }

  // No -> one polite close, then stay quiet for the idle window.
  if (isNo(text) || isEmojiNo(text)) {
    clearResumeFlags(sender, chatId);
    sessionManager.setState(sender, chatId, {
      idleClose: true,
      idleCloseUntil: Date.now() + (config.welcomeBack.idleCloseMs ?? 1800000)
    });
    const name = preferredDisplayName(user, context.pushName, sender);
    const body = fill(t(language, 'onboarding.resumeCloseBody'), name);
    const text2 = [
      `> *${EMOJI_WAVE} ${L(language, 'onboarding.resumeCloseHeading')}*`,
      '',
      body,
      '',
      '_' + L(language, 'onboarding.resumeCloseHint') + '_'
    ].join('\n');
    await sendText(sock, sender, text2);
    logger.debug({ sender }, '[RESUME] closed politely');
    return true;
  }

  // Unclear: three escalating nudges, then silence on the fourth.
  if (attempts > 3) {
    clearResumeFlags(sender, chatId);
    logger.debug({ sender, attempts }, '[RESUME] gave up after three unclear replies');
    return true;
  }
  sessionManager.setState(sender, chatId, { resumeAttempts: attempts });
  await sendText(sock, sender, nudge(language, attempts));
  return true;
}