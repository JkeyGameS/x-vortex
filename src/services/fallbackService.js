import config from '../config/config.js';
import logger from '../utils/logger.js';
import sessionManager from '../utils/sessionManager.js';
import { sendText } from './messageService.js';
import { sendMenu } from '../utils/messageHelper.js';
import { buildMenu } from '../utils/menuBuilder.js';
import { toSmallCaps } from '../utils/smallCaps.js';
import { t } from './localeService.js';
import { replacePlaceholders } from '../utils/matchUtils.js';
import { withTyping } from '../utils/typingHelper.js';
import * as reportService from './reportService.js';
import { getSettings as getChatSettings } from './chatSettingsService.js';

// ---------------------------------------------------------------------------
// Suppression tracking: jid -> { count, windowStart }
// ---------------------------------------------------------------------------

const fallbackAttempts = new Map(); // jid -> { count, windowStart }

function suppressWindowMs() {
  return Number(config.fallbackSuppressWindowMs) || 300000;
}

function suppressAfterAttempts() {
  return Number(config.fallbackSuppressAfterAttempts) || 3;
}

export function isFallbackSuppressed(sender) {
  const now = Date.now();
  const entry = fallbackAttempts.get(sender);
  if (!entry || now - entry.windowStart > suppressWindowMs()) {
    return false;
  }
  return entry.count > suppressAfterAttempts();
}

function trackFallback(sender) {
  const now = Date.now();
  const entry = fallbackAttempts.get(sender);
  if (!entry || now - entry.windowStart > suppressWindowMs()) {
    fallbackAttempts.set(sender, { count: 1, windowStart: now });
    return 1;
  }
  entry.count += 1;
  return entry.count;
}

/** Reset the suppression counter after a successful match. */
export function noteFallbackSuccess(sender) {
  fallbackAttempts.delete(sender);
}

// ---------------------------------------------------------------------------
// Intent detection
// ---------------------------------------------------------------------------

const GREETING_WORDS = new Set([
  'hi', 'hello', 'hey', 'yo', 'sup', 'wassup', 'whatsup', 'hiya', 'howdy',
  'morning', 'evening', 'afternoon'
]);
const GREETING_PHRASES = ['good morning', 'good afternoon', 'good evening', 'good night'];

const QUESTION_STARTERS = new Set([
  'what', 'how', 'why', 'when', 'where', 'who', 'can', 'do', 'does',
  'is', 'are', 'was', 'were', 'will', 'would', 'should', 'could',
  'comment', 'wie', 'was', 'quand', 'cual', 'cómo', 'que', 'cómo',
  'qui', 'waarom', 'kia', 'comment', 'pourquoi', 'cuándo', 'dónde',
  'كيف', 'ما', 'هل', 'ماذا', 'لماذا', 'متى', 'أين', 'من'
]);

const EMOTION_MAP = [
  { words: ['sad', 'depressed', 'lonely', 'crying', 'unhappy'], reply: 'fallback.fallbackEmoSad' },
  { words: ['happy', 'excited', 'great', 'awesome', 'wonderful'], reply: 'fallback.fallbackEmoHappy' },
  { words: ['angry', 'mad', 'furious', 'annoyed', 'hate'], reply: 'fallback.fallbackEmoAngry' },
  { words: ['tired', 'sleepy', 'exhausted'], reply: 'fallback.fallbackEmoTired' },
  { words: ['bored', 'boring'], reply: 'fallback.fallbackEmoBored' },
  { words: ['love'], reply: 'fallback.fallbackEmoLove' },
  { words: ['cool', 'nice', 'great', 'perfect'], reply: 'fallback.fallbackEmoCool' },
  { words: ['lol', 'haha', 'lmao', 'hehe', '😂', '🤣'], reply: 'fallback.fallbackEmoLaugh' }
];

const KEYBOARD_SMASH_EXACT = new Set([
  'asdf', 'qwerty', 'zxcv', 'qwertz', 'azerty', 'poiuy', 'lkjh', 'mnbv',
  'test', 'ttt', 'aaa', 'xxx', 'zzz', 'abc', '123'
]);
// Longer smash fragments: matching when CONTAINED (rare in real words).
const KEYBOARD_SMASH_PARTS = ['asdf', 'qwerty', 'qwertz', 'azerty', 'zxcv', 'poiuy', 'lkjh', 'mnbv'];

function normalizeLower(text) {
  return String(text || '').trim().toLowerCase();
}

function isKeyboardSmash(text) {
  const norm = normalizeLower(text).replace(/[^a-z0-9]/g, '');
  if (!norm) return true;
  if (KEYBOARD_SMASH_EXACT.has(norm)) return true;
  if (KEYBOARD_SMASH_PARTS.some((p) => norm.includes(p))) return true;
  if (/(.)\1{3,}/.test(norm)) return true;
  if (norm.length >= 7 && /^[bcdfghjklmnpqrstvwxz]+$/.test(norm)) return true;
  return false;
}

/**
 * Classify an unmatched message. Returns one of:
 * 'greeting' | 'question' | 'emotional' | 'gibberish' | 'generic'
 */
export function detectIntent(message) {
  const norm = normalizeLower(message);
  if (!norm) return 'gibberish';
  const words = norm.split(/\s+/);
  if (words.length <= 4 && (GREETING_WORDS.has(norm) || GREETING_WORDS.has(words[0]) || GREETING_PHRASES.some((p) => norm === p || norm.startsWith(p + ' ') || norm.endsWith(' ' + p)))) {
    return 'greeting';
  }
  if (norm.endsWith('?') || norm.endsWith('؟') || QUESTION_STARTERS.has(words[0])) {
    return 'question';
  }
  for (const group of EMOTION_MAP) {
    if (group.words.some((w) => norm === w || norm.includes(w))) return 'emotional';
  }
  if (norm.length < 3 || isKeyboardSmash(norm)) return 'gibberish';
  return 'generic';
}

function emotionReplyKey(message) {
  const norm = normalizeLower(message);
  for (const group of EMOTION_MAP) {
    if (group.words.some((w) => norm === w || norm.includes(w))) return group.reply;
  }
  return null;
}

const GREETING_REPLIES = ['fallback.fallbackGreet1', 'fallback.fallbackGreet2', 'fallback.fallbackGreet3'];

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

// ---------------------------------------------------------------------------
// Fallback flows
// ---------------------------------------------------------------------------

async function sendFallbackText(sock, sender, text) {
  await withTyping(sock, sender, () => sendText(sock, sender, text));
}

export async function handleFallbackAskAdmin(context, input, user, language) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const session = sessionManager.getSession(sender, chatId) || {};
  const trimmed = String(input || '').trim();
  const returnTo = session.pendingData?.fallbackReturnTo ?? null;
  const question = session.pendingData?.fallbackQuestion || '';

  const done = (nextMenu) => {
    sessionManager.setState(sender, chatId, { currentMenu: nextMenu, pendingData: null });
  };

  if (trimmed === '1') {
    try {
      const { recordSuggestion } = await import('./suggestionService.js');
      recordSuggestion(question);
    } catch { /* suggestions must never break replies */ }
    try {
      reportService.reportToAdmins('feedback', { type: 'question', user: sender, message: question }, 'normal');
    } catch { /* reports must never break replies */ }
    logger.info({ sender, question: question.slice(0, 80) }, 'Fallback question escalated to admin');
    await sendFallbackText(context.sock, sender, toSmallCaps(t(language, 'fallback.askAdminThanks')));
    done(returnTo);
    return true;
  }
  if (trimmed === '2') {
    await sendFallbackText(context.sock, sender, toSmallCaps(t(language, 'fallback.askAdminDeclined')));
    done(returnTo);
    return true;
  }
  return false;
}

export async function handleFallbackUnknown(context, input, language) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const session = sessionManager.getSession(sender, chatId) || {};
  const trimmed = String(input || '').trim();
  const returnTo = session.pendingData?.fallbackReturnTo ?? null;
  const question = session.pendingData?.fallbackQuestion || '';

  if (trimmed === '1') {
    try {
      const { recordSuggestion } = await import('./suggestionService.js');
      recordSuggestion(question);
    } catch { /* noop */ }
    try {
      reportService.reportToAdmins('feedback', { type: 'question', user: sender, message: question }, 'normal');
    } catch { /* noop */ }
    logger.info({ sender, question: question.slice(0, 80) }, 'Fallback question escalated to admin');
    await sendFallbackText(context.sock, sender, toSmallCaps(t(language, 'fallback.askAdminThanks')));
    sessionManager.setState(sender, chatId, { currentMenu: returnTo, pendingData: null });
    return true;
  }
  if (trimmed === '2') {
    const { openHelp } = await import('../handlers/helpCommand.js');
    sessionManager.setState(sender, chatId, { currentMenu: returnTo, pendingData: null });
    await openHelp({ sock: context.sock, sender, chatId, pushName: context.pushName || 'User' }, { origin: 'fallback' });
    return true;
  }
  if (trimmed === '3') {
    sessionManager.setState(sender, chatId, { currentMenu: returnTo, pendingData: null });
    return true;
  }
  return false;
}

/**
 * Run the graceful fallback decision tree for an unmatched message.
 * Returns true when the message was consumed.
 */
function fallbackBehavior() {
  try {
    const mode = getChatSettings().fallbackBehavior;
    if (['friendly', 'silent', 'ask_admin', 'help_only'].includes(mode)) return mode;
  } catch { /* default below */ }
  return 'friendly';
}

export async function handleFallback(context, user, language, trimmed) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const session = sessionManager.getSession(sender, chatId) || {};

  if (config.fallbackEnabled === false) return false;

  const count = trackFallback(sender);
  if (count > suppressAfterAttempts()) {
    logger.info({ sender, count }, 'Fallback suppressed after repeated attempts');
    return true;
  }

  const behavior = fallbackBehavior();
  if (behavior === 'silent') {
    logger.info({ sender }, 'Fallback silent mode, no reply sent');
    return true;
  }
  if (behavior === 'help_only') {
    await sendFallbackText(context.sock, sender, toSmallCaps(t(language, 'fallback.helpOnly')));
    return true;
  }

  const returnTo = session.currentMenu ?? null;
  const intent = behavior === 'ask_admin' ? 'question' : detectIntent(trimmed);

  if (intent === 'greeting') {
    const key = pick(GREETING_REPLIES);
    const reply = replacePlaceholders(t(language, key), user, config);
    await sendFallbackText(context.sock, sender, toSmallCaps(reply));
    return true;
  }

  if (intent === 'question') {
    sessionManager.setState(sender, chatId, {
      currentMenu: 'fallback_ask_admin',
      pendingData: { fallbackReturnTo: returnTo, fallbackQuestion: trimmed }
    });
    const text = buildMenu(toSmallCaps(t(language, 'fallback.questionTitle')), '', [
      toSmallCaps(t(language, 'fallback.questionBody')),
      '',
      '1. ✅ ' + toSmallCaps(t(language, 'fallback.askAdminYes')),
      '2. ❌ ' + toSmallCaps(t(language, 'fallback.askAdminNo'))
    ]);
    await withTyping(context.sock, sender, () => sendMenu({ sock: context.sock, sender, chatId, text, transitionKey: 'fallback_ask_admin' }));
    return true;
  }

  if (intent === 'emotional') {
    const key = emotionReplyKey(trimmed) || 'fallback.fallbackEmoFallback';
    await sendFallbackText(context.sock, sender, toSmallCaps(t(language, key)));
    return true;
  }

  if (intent === 'gibberish') {
    await sendFallbackText(context.sock, sender, toSmallCaps(t(language, 'fallback.gibberish')));
    return true;
  }

  sessionManager.setState(sender, chatId, {
    currentMenu: 'fallback_unknown',
    pendingData: { fallbackReturnTo: returnTo, fallbackQuestion: trimmed }
  });
  const text = buildMenu(toSmallCaps(t(language, 'fallback.unknownTitle')), '', [
    '1. 💬 ' + toSmallCaps(t(language, 'fallback.unknownTellAdmin')),
    '2. 📚 ' + toSmallCaps(t(language, 'fallback.unknownHelp')),
    '3. 🚪 ' + toSmallCaps(t(language, 'fallback.unknownNevermind'))
  ]);
  await withTyping(context.sock, sender, () => sendMenu({ sock: context.sock, sender, chatId, text, transitionKey: 'fallback_unknown' }));
  return true;
}
