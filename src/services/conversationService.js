import config from '../config/config.js';
import logger from '../utils/logger.js';
import sessionManager from '../utils/sessionManager.js';
import settingsService from './settingsService.js';
import { getUserByJidSync } from './userService.js';
import { sendText } from './messageService.js';
import { sendMenu } from '../utils/messageHelper.js';
import { toSmallCaps } from '../utils/smallCaps.js';
import { t } from './localeService.js';
import { buildLanguageMenu } from '../handlers/languageCommand.js';
import { buildHelpMessage } from '../handlers/helpCommand.js';
import * as chatNotifyService from './chatNotifyService.js';
import * as reportService from './reportService.js';
import { logAdminAction } from './adminLogService.js';
import { buildMenu } from '../utils/menuBuilder.js';
import { matchRule, getRule as getChatRule } from './chatRuleService.js';
import { matchFaq } from './faqService.js';
import { withTyping as sharedTyping } from '../utils/typingHelper.js';
import { getSettings as getChatSettingsModule } from './chatSettingsService.js';

// Per-user per-rule cooldown tracking: `${jid}:${ruleId}` -> last response timestamp.
const ruleCooldowns = new Map();

export function isRuleCooling(jid, rule) {
  const seconds = Number(rule?.cooldownSeconds) || 0;
  if (!jid || !rule?.id || seconds <= 0) return false;
  const last = ruleCooldowns.get(`${jid}:${rule.id}`) || 0;
  return Date.now() - last < seconds * 1000;
}

export function markRuleResponded(jid, rule) {
  if (!jid || !rule?.id) return;
  ruleCooldowns.set(`${jid}:${rule.id}`, Date.now());
}

export function clearRuleCooldowns() {
  ruleCooldowns.clear();
}

/**
 * Perform a rule's configured response action after sending its reply text.
 * Dynamic imports avoid cycles with handler modules.
 */
export async function performRuleAction(context, sender, chatId, language, user, action) {
  const act = action || 'send_text';
  if (act === 'send_text') return;
  try {
      if (act === 'send_notify') {
        const { sendText: text } = await import('./messageService.js');
        await text(context.sock, sender, '🔔 ' + toSmallCaps(t(language, 'chatResponses.actionNotifyText')));
        return;
      }
    if (act.startsWith('open_menu:')) {
      const target = act.slice('open_menu:'.length);
      if (target === 'main') {
        const { sendMigratedMainMenu } = await import('../handlers/startCommand.js');
        sessionManager.setState(sender, chatId, { currentMenu: 'main' });
        await sendMigratedMainMenu({ sock: context.sock, sender, chatId, user, language, transitionKey: 'rule_action_main' });
      } else if (target === 'profile') {
        const { openProfile } = await import('../handlers/profileCommand.js');
        await openProfile({ sock: context.sock, sender, chatId, pushName: user?.name || 'User' });
      } else if (target === 'help') {
        const { openHelp } = await import('../handlers/helpCommand.js');
        await openHelp({ sock: context.sock, sender, chatId, pushName: user?.name || 'User' }, { origin: 'command' });
      } else if (target === 'settings') {
        const { openSettings } = await import('../handlers/settingsCommand.js');
        await openSettings({ sock: context.sock, sender, chatId, pushName: user?.name || 'User' });
      }
      return;
    }
    if (act === 'open_feedback') {
      const { openFeedback } = await import('../handlers/feedbackCommand.js');
      await openFeedback({ sock: context.sock, sender, chatId, pushName: user?.name || 'User' });
    }
  } catch (err) {
    logger.warn({ err, action: act }, 'Rule action failed');
  }
}
import { replacePlaceholders, stripEmojis, normalize as normText, levenshtein as levEdit } from '../utils/matchUtils.js';
import { isFeatureEnabled } from './featureFlagService.js';

// ---------------------------------------------------------------------------
// Effective state
// ---------------------------------------------------------------------------

/**
 * Effective conversation availability.
 * @returns {{ enabled: boolean, temporary: boolean, remainingMs: number }}
 */
export function isConversationEnabled() {
  const settings = settingsService.getSettings();
  const base = typeof settings.conversationEnabled === 'boolean'
    ? settings.conversationEnabled
    : config.conversationEnabled === true;
  const until = settings.conversationDisabledUntil || 0;

  if (!base) return { enabled: false, temporary: false, remainingMs: 0 };
  if (until > Date.now()) return { enabled: false, temporary: true, remainingMs: until - Date.now() };
  return { enabled: true, temporary: false, remainingMs: 0 };
}

// ---------------------------------------------------------------------------
// Auto re-enable timer for temporary disable
// ---------------------------------------------------------------------------

let autoEnableTimer = null;
let autoEnableAdmin = null;

export function cancelConversationAutoEnable() {
  if (autoEnableTimer) {
    clearTimeout(autoEnableTimer);
    autoEnableTimer = null;
  }
  autoEnableAdmin = null;
}

export function scheduleConversationAutoEnable(untilEpochMs, adminJid) {
  cancelConversationAutoEnable();
  const delay = Math.max(0, untilEpochMs - Date.now());
  autoEnableAdmin = adminJid || null;
  autoEnableTimer = setTimeout(() => {
    autoEnableTimer = null;
    settingsService.updateSettings({ conversationDisabledUntil: null });
    chatNotifyService.notifyWaitingUsers().catch((err) => {
      logger.error({ err }, '[CONVERSATION] failed to notify on auto re-enable');
    });
    logAdminAction(autoEnableAdmin || '-', 'settings_change', 'conversation chat automatically re-enabled');
    autoEnableAdmin = null;
  }, delay);
  if (autoEnableTimer.unref) autoEnableTimer.unref();
}

/**
 * Re-arm the temporary-disable auto-enable after a restart. Also expires a
 * temporary-disable window that already elapsed while the bot was down.
 */
export async function rearmConversationAutoEnable() {
  const settings = settingsService.getSettings();
  const until = settings.conversationDisabledUntil || 0;
  if (!until) {
    cancelConversationAutoEnable();
    return;
  }
  if (until <= Date.now()) {
    settingsService.updateSettings({ conversationDisabledUntil: null });
    await chatNotifyService.notifyWaitingUsers();
    logAdminAction('-', 'settings_change', 'conversation chat automatically re-enabled');
    return;
  }
  scheduleConversationAutoEnable(until, null);
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withTyping(sock, sender, fn, options = {}) {
  return sharedTyping(sock, sender, fn, options);
}

function normalize(text) {
  return normText(text);
}

function levenshtein(a, b) {
  return levEdit(a, b);
}
const YES_WORDS = new Set(['yes', 'y', 'yeah', 'yep', 'sure', 'ok', 'okay']);
const NO_WORDS = new Set(['no', 'n', 'nope', 'nah']);
const GREETING_WORDS = new Set(['hi', 'hello', 'hey', 'yo']);
const GREETING_PHRASES = ['good morning', 'good afternoon', 'good evening'];
const HELP_PHRASES = new Set(['help', 'help me', 'i need help', 'can you help']);

function isYes(text) {
  return YES_WORDS.has(normalize(text));
}

function isNo(text) {
  return NO_WORDS.has(normalize(text));
}

function isGreeting(text) {
  if (config.conversationGreetingEnabled === false) return false;
  const norm = normalize(text);
  if (GREETING_WORDS.has(norm)) return true;
  return GREETING_PHRASES.some((p) => norm === p || norm.startsWith(p));
}

function isDirectHelp(text) {
  return HELP_PHRASES.has(normalize(text));
}

function isMisspelledHelp(text) {
  if (config.conversationHelpPromptEnabled === false) return false;
  return levenshtein(normalize(text), 'help') <= 2;
}

function displayNameOf(user) {
  if (user?.username) return `@${user.username}`;
  return user?.name || 'User';
}

// ---------------------------------------------------------------------------
// Chat settings helpers (global chat controls)
// ---------------------------------------------------------------------------

function getChatSettingsSafe() {
  try {
    return getChatSettingsModule();
  } catch { /* defaults below */ }
  return {
    chatEnabled: true, fuzzyMatching: 'normal', defaultCooldownSeconds: 0,
    fallbackBehavior: 'friendly', priorityMode: 'highest', autoTranslate: false,
    contextAwareness: true, maxRepliesPerMinute: 0, dryRunMode: false,
    logChatMatches: false, languageFilter: ['en', 'fr', 'de', 'es', 'ar'],
    chatReplyDelayMs: null
  };
}

const replyTimestamps = new Map(); // jid -> [timestamps within the last minute]

function exceedsReplyLimit(sender, maxPerMinute) {
  const max = Math.max(0, Math.floor(Number(maxPerMinute) || 0));
  if (!max) return false;
  const now = Date.now();
  const list = (replyTimestamps.get(sender) || []).filter((ts) => now - ts < 60000);
  if (list.length >= max) {
    replyTimestamps.set(sender, list);
    return true;
  }
  list.push(now);
  replyTimestamps.set(sender, list);
  return false;
}

/**
 * Conversation-level rate guard for FAQ answers.
 * Records the reply in the user's window when allowed.
 * @returns {Promise<boolean>} true when the reply was suppressed (caller should return).
 */
async function guardFaqRateLimit(context, sender, chatId, language, chatSettings) {
  try {
    const { checkRateLimit, markPoliteSent, recordReply } = await import('./rateLimitService.js');
    const sessLive = sessionManager.getSession(sender, chatId) || {};
    const rateInfo = checkRateLimit(sender, sessLive, chatSettings);
    if (!rateInfo.allowed) {
      sessionManager.setState(sender, chatId, { chatRepliesInWindow: sessLive.chatRepliesInWindow || [] });
      if (rateInfo.politeDue) {
        markPoliteSent(sessLive);
        sessionManager.setState(sender, chatId, { rateLimitPoliteSentAt: sessLive.rateLimitPoliteSentAt });
        const polite = '⏳ ' + toSmallCaps(t(language, 'conversation.rateLimitPolite'));
        await withTyping(context.sock, sender, () =>
          sendText(context.sock, sender, polite));
      }
      logger.info({ sender }, 'FAQ reply rate limited, suppressed');
      return true;
    }
    recordReply(sessLive);
    sessionManager.setState(sender, chatId, { chatRepliesInWindow: sessLive.chatRepliesInWindow || [] });
  } catch { /* rate limiting must never break replies */ }
  return false;
}

function lastRuleTriggers(ruleId) {
  try {
    const rule = getChatRule(ruleId);
    return rule ? rule.triggers || [] : [];
  } catch {
    return [];
  }
}

function durationLabel(remainingMs) {
  const mins = Math.max(1, Math.round(remainingMs / 60000));
  if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'}`;
  const hrs = Math.round(mins / 60);
  return `${hrs} hour${hrs === 1 ? '' : 's'}`;
}

function smallText(language, key, params = {}) {
  return toSmallCaps(t(language, key, params));
}

// ---------------------------------------------------------------------------
// Individual reply builders
// ---------------------------------------------------------------------------

async function sendLanguageGate(context, language) {
  const session = sessionManager.getSession(context.sender, context.chatId) || {};
  sessionManager.setState(context.sender, context.chatId, {
    currentMenu: 'language_selection',
    isLanguageSelectionPending: true,
    helpFrom: session.helpFrom
  });
  await sendText(context.sock, context.sender, smallText(language, 'conversation.languageGate'));
  await sendMenu({
    sock: context.sock,
    sender: context.sender,
    chatId: context.chatId,
    text: buildLanguageMenu(),
    transitionKey: 'language_selection'
  });
}

async function finishIntro(context, language, user) {
  sessionManager.setState(context.sender, context.chatId, {
    currentMenu: 'main',
    awaitingIntro: false
  });
  const ack = smallText(language, 'conversation.introAck');
  await withTyping(context.sock, context.sender, async () => {
    await sendText(context.sock, context.sender, ack);
  });
  const { sendMigratedMainMenu } = await import('../handlers/startCommand.js');
  await sendMigratedMainMenu({ sock: context.sock, sender: context.sender, chatId: context.chatId, user, language, transitionKey: 'onboarding_to_main' });
}

async function sendOffFlow(context, language, session, trimmed) {
  const conv = isConversationEnabled();
  const sender = context.sender;
  const chatId = context.chatId;

  if (!session.conversationOffNotifyAsked) {
    const offMsg = conv.temporary
      ? String(config.conversationTemporaryOffMessage).replace('{duration}', durationLabel(conv.remainingMs))
      : String(config.conversationPermanentOffMessage);
    sessionManager.setState(sender, chatId, { conversationOffNotifyAsked: true });
    const notifyAsk = smallText(language, 'conversation.notifyAsk');
    await withTyping(context.sock, sender, async () => {
      await sendText(context.sock, sender, toSmallCaps(offMsg) + '\n\n' + notifyAsk);
    });
    return;
  }

  // The opt-in question was already asked; respond to yes/no without re-asking.
  if (isYes(trimmed) && config.conversationNotifyRequestEnabled !== false) {
    await chatNotifyService.addRequest(context.sender);
    await withTyping(context.sock, sender, async () => {
      await sendText(context.sock, sender, '🔔 ' + smallText(language, 'conversation.notifyYes'));
    });
    return;
  }
  if (isNo(trimmed)) {
    await withTyping(context.sock, sender, async () => {
      await sendText(context.sock, sender, smallText(language, 'conversation.notifyNo'));
    });
    return;
  }
  await withTyping(context.sock, sender, async () => {
    await sendText(context.sock, sender, smallText(language, 'conversation.unknown'));
  });
}

function clearHelpState(sender, chatId) {
  sessionManager.setState(sender, chatId, { awaitingHelpConfirmation: false, helpUnknownCount: 0 });
}

// ---------------------------------------------------------------------------
// Entry point: free-text conversation
// ---------------------------------------------------------------------------

/**
 * Handle a free-text (non-command, non-menu) message.
 * @param {object} context - { sock, sender, chatId, pushName }
 * @param {string} text - the raw trimmed message text
 * @returns {Promise<boolean>} true when the message was consumed
 */
export async function handleFreeText(context, text) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const trimmed = (text || '').trim();
  if (!trimmed) return false;

  const user = getUserByJidSync(sender);
  const language = user?.language || config.defaultLanguage;
  const session = sessionManager.getSession(sender, chatId) || {};

  // Strict language enforcement: no language selected -> everything is ignored.
  if (!user?.language) {
    await sendLanguageGate(context, language);
    return true;
  }

  // First-time onboarding: after the language was chosen, wait for the user's
  // first free-text reply, then acknowledge and open the main menu.
  if (session.awaitingIntro) {
    await finishIntro(context, language, user);
    return true;
  }

  const conv = isConversationEnabled();

  // Engagement tracking: any new user message within the window after a bot
  // chat reply counts as engagement for that reply (counted once).
  try {
    const last = session.lastChatReply;
    if (last && last.ruleId && last.sentAt) {
      const windowMs = Number(config.chatEngagementWindowMs) || 60000;
      if (Date.now() - new Date(last.sentAt).getTime() <= windowMs) {
        const { recordEngagement } = await import('./replyAnalyticsService.js');
        recordEngagement(last.ruleId, last.replyHash || last.text);
      }
      sessionManager.setState(sender, chatId, { lastChatReply: null });
    }
  } catch { /* analytics must never break replies */ }

  // Chat disabled (permanently or temporarily): offer the notify opt-in.
  if (!conv.enabled) {
    await sendOffFlow(context, language, session, trimmed);
    return true;
  }

  // Waiting for a yes/no answer to the help prompt.
  if (session.awaitingHelpConfirmation) {
    if (isYes(trimmed)) {
      clearHelpState(sender, chatId);
      const text = await buildHelpMessage({ language });
      await withTyping(context.sock, sender, () => sendText(context.sock, sender, text));
      return true;
    }
    if (isNo(trimmed)) {
      clearHelpState(sender, chatId);
      await withTyping(context.sock, sender, () =>
        sendText(context.sock, sender, smallText(language, 'conversation.helpNo')));
      return true;
    }
    if (isDirectHelp(trimmed)) {
      sessionManager.setState(sender, chatId, { helpUnknownCount: 0 });
      await withTyping(context.sock, sender, () =>
        sendText(context.sock, sender, smallText(language, 'conversation.helpAsk', { username: displayNameOf(user) })));
      return true;
    }
    const unknownCount = session.helpUnknownCount || 0;
    if (unknownCount >= 1) {
      clearHelpState(sender, chatId);
      await withTyping(context.sock, sender, () =>
        sendText(context.sock, sender, smallText(language, 'conversation.unknownRepeated')));
    } else {
      sessionManager.setState(sender, chatId, { helpUnknownCount: 1 });
      await withTyping(context.sock, sender, () =>
        sendText(context.sock, sender, smallText(language, 'conversation.helpMeanYesNo')));
    }
    return true;
  }

  // Graceful fallback follow-ups (question escalation / unknown options).
  if (session.currentMenu === 'fallback_ask_admin') {
    const { handleFallbackAskAdmin } = await import('./fallbackService.js');
    if (await handleFallbackAskAdmin(context, trimmed, user, language)) return true;
    sessionManager.setState(sender, chatId, { currentMenu: null, pendingData: null });
  }
  if (session.currentMenu === 'fallback_unknown') {
    const { handleFallbackUnknown } = await import('./fallbackService.js');
    if (await handleFallbackUnknown(context, trimmed, language)) return true;
    sessionManager.setState(sender, chatId, { currentMenu: null, pendingData: null });
  }

  // FAQ candidate selection: the user previously saw a list of up to 3 FAQ
  // choices and is now replying with a number (or cancelling).
  if (session.faqCandidateIds && session.faqCandidateIds.length) {
    if (/^\d+$/.test(trimmed)) {
      const idx = Number(trimmed) - 1;
      const candidates = session.faqCandidates || [];
      if (idx >= 0 && idx < candidates.length) {
        const chosen = candidates[idx];
        let answer = chosen.answer;
        try {
          const { expandSnippets } = await import('../utils/snippetExpander.js');
          answer = expandSnippets(answer, language);
        } catch { /* snippets must never break replies */ }
        answer = replacePlaceholders(answer, user, config);
        sessionManager.setState(sender, chatId, { faqCandidates: null, faqCandidateIds: null });
        if (await guardFaqRateLimit(context, sender, chatId, language, getChatSettingsSafe())) return true;
        await withTyping(context.sock, sender, () =>
          sendText(context.sock, sender, answer));
        return true;
      }
    }
    // Invalid selection or non-number: clear candidates and fall through.
    sessionManager.setState(sender, chatId, { faqCandidates: null, faqCandidateIds: null });
  }

  // Custom chat responses (trigger-reply rules). Checked before generic
  // handling so admin-defined and FAQ content take precedence.
  if (isFeatureEnabled('chatResponses')) {
    const chatSettings = getChatSettingsSafe();
    const chatOn = chatSettings.chatEnabled !== false;
    let ignored = false;
    try {
      const { isIgnored } = await import('./chatSettingsService.js');
      ignored = isIgnored(sender);
    } catch { /* ignore list must never break replies */ }
    if (chatOn && !ignored) {
      if (exceedsReplyLimit(sender, chatSettings.maxRepliesPerMinute)) {
        try {
          const { logRateLimit } = await import('./chatSettingsService.js');
          logRateLimit(sender, chatSettings.maxRepliesPerMinute);
        } catch { /* noop */ }
        logger.info({ sender }, 'Chat reply rate limit exceeded, skipping');
        return true;
      }
      const sessionCtx = sessionManager.getSession(sender, chatId) || {};
      // Step 1 — refresh conversational context BEFORE matching.
      const maxTracked = Math.max(1, Math.floor(Number(config.chatContextMaxUserMessagesTracked) || 3));
      const lastUserMessages = [...(Array.isArray(sessionCtx.lastUserMessages) ? sessionCtx.lastUserMessages : []), trimmed].slice(-maxTracked);
      let pendingContext = null;
      try {
        const { resolvePendingContext } = await import('./chatRuleService.js');
        pendingContext = resolvePendingContext(sessionCtx);
        if (sessionCtx.pendingContext && !pendingContext) {
          sessionManager.setState(sender, chatId, { pendingContext: null, pendingContextSetAt: null, pendingContextExpiresAt: null });
        }
      } catch { /* context must never break matching */ }
      sessionManager.setState(sender, chatId, { lastUserMessages });
      const chatMatch = matchRule(trimmed, language, {
        ignoreLanguageFilter: chatSettings.autoTranslate === true,
        contextTriggers: chatSettings.contextAwareness !== false && sessionCtx.lastMatchedRuleId
          ? lastRuleTriggers(sessionCtx.lastMatchedRuleId)
          : [],
        pendingContext
      });
      const effectiveCooldown = chatMatch ? (Number(chatMatch.rule.cooldownSeconds) || Number(chatSettings.defaultCooldownSeconds) || 0) : 0;
      if (chatMatch && isRuleCooling(sender, { ...chatMatch.rule, cooldownSeconds: effectiveCooldown })) {
        try {
          const { logCooldownHit } = await import('./triggerStatsService.js');
          logCooldownHit(chatMatch.rule.id, sender);
        } catch { /* stats must never break replies */ }
      }
      if (chatMatch && !isRuleCooling(sender, { ...chatMatch.rule, cooldownSeconds: effectiveCooldown })) {
        const { pickReply } = await import('./replySelector.js');
        const isDryRun = chatSettings.dryRunMode === true;
        const picked = await pickReply(chatMatch.rule, user, language, {
          settings: chatSettings,
          message: trimmed,
          timezone: user?.timezone || 'UTC',
          dryRun: isDryRun
        });
        if (!isDryRun) {
          try {
            const { updateUserTone, detectTone } = await import('../utils/toneDetector.js');
            updateUserTone(sender, detectTone(trimmed), chatId);
          } catch { /* tone bookkeeping must never break replies */ }
        }
        const reply = picked ? picked.reply.text : '';
        if (isDryRun) {
          // Global dry-run: rich log entry, no reply and no side effects.
          try {
            const { logDryRun } = await import('./chatSettingsService.js');
            const filtersApplied = [];
            if (picked) {
              if (picked.filters && picked.filters.antiRep) filtersApplied.push('anti_rep');
              if (picked.filters && picked.filters.tone) filtersApplied.push('tone');
              if (picked.filters && picked.filters.time) filtersApplied.push('time');
              if (picked.styleApplied) filtersApplied.push('style');
            }
            let dryContextAfter = pendingContext;
            if (chatMatch.rule.setsContext) dryContextAfter = chatMatch.rule.setsContext;
            else if (chatMatch.rule.context && pendingContext && chatMatch.rule.context === pendingContext) dryContextAfter = null;
            logDryRun(chatMatch.rule.id, sender, trimmed, {
              ruleTriggers: chatMatch.rule.triggers || [],
              selectedReply: picked ? picked.reply.text.slice(0, 200) : '',
              styleUsed: picked ? picked.styleUsed : 'friendly',
              contextBefore: pendingContext,
              contextAfter: dryContextAfter,
              detectedTone: picked ? picked.detectedTone : 'neutral',
              timeOfDay: picked ? picked.timeOfDay : null,
              effectivePriority: chatMatch.effectivePriority,
              engagementBonus: picked ? picked.engagementBonus || 0 : 0,
              filtersApplied,
              followUpUsed: !!(picked && picked.followUpUsed),
              followUpText: picked ? (picked.followUpText || '') : ''
            });
          } catch { /* noop */ }
          logger.info({ rule: chatMatch.rule.id, sender }, 'Dry run match (no reply sent)');
          return true;
        }
        // Conversation-level rate limiting (per-user sliding window).
        try {
          const { checkRateLimit, markPoliteSent } = await import('./rateLimitService.js');
          const sessLive = sessionManager.getSession(sender, chatId) || {};
          const rateInfo = checkRateLimit(sender, sessLive, chatSettings);
          sessionManager.setState(sender, chatId, { chatRepliesInWindow: sessLive.chatRepliesInWindow || [] });
          if (!rateInfo.allowed) {
            if (chatSettings.logChatMatches === true) {
              try {
                const { logChatMatch } = await import('./chatSettingsService.js');
                logChatMatch(chatMatch.rule.id, sender, trimmed, {
                  rateLimited: true,
                  suppressedBehavior: rateInfo.cfg.behavior,
                  repliesInWindow: rateInfo.count,
                  snippetsExpanded: []
                });
              } catch { /* noop */ }
            }
            if (rateInfo.politeDue) {
              markPoliteSent(sessLive);
              sessionManager.setState(sender, chatId, { rateLimitPoliteSentAt: sessLive.rateLimitPoliteSentAt });
              const polite = '⏳ ' + toSmallCaps(t(language, 'conversation.rateLimitPolite'));
              await withTyping(context.sock, sender, () =>
                sendText(context.sock, sender, polite));
            }
            logger.info({ sender }, 'Chat reply rate limited, suppressed');
            return true;
          }
        } catch { /* rate limiting must never break replies */ }
        try {
          const { incrementChatRuleHit } = await import('./chatStatsService.js');
          incrementChatRuleHit(chatMatch.rule.id);
        } catch { /* stats must never break replies */ }
        try {
          const { recordTriggerHit } = await import('./triggerStatsService.js');
          recordTriggerHit(chatMatch.rule.id, chatMatch.matchedTrigger);
        } catch { /* stats must never break replies */ }
        let snippetsExpanded = [];
        if (reply) {
          // Pipeline: pickReply (incl. follow-up) → snippet expansion → placeholders → send.
          let final = reply;
          try {
            const { expandSnippetsWithMeta } = await import('../utils/snippetExpander.js');
            const expanded = expandSnippetsWithMeta(final, language);
            final = expanded.text;
            snippetsExpanded = expanded.expanded;
          } catch { /* snippets must never break replies */ }
          final = replacePlaceholders(final, user, config);
          try {
            const { recordReply } = await import('./rateLimitService.js');
            const sessLive = sessionManager.getSession(sender, chatId) || {};
            recordReply(sessLive);
            sessionManager.setState(sender, chatId, { chatRepliesInWindow: sessLive.chatRepliesInWindow || [] });
          } catch { /* rate bookkeeping must never break replies */ }
          if (chatMatch.rule.emojisEnabled === false) final = stripEmojis(final);
          if (chatSettings.autoTranslate === true && chatMatch.rule.language !== 'all' && chatMatch.rule.language !== language) {
            final += '\n🌐 ' + toSmallCaps(t(language, 'chatSettings.autoTranslated'));
          }
          const delayOverride = chatSettings.chatReplyDelayMs;
          await withTyping(context.sock, sender, () =>
            sendText(context.sock, sender, final, { type: 'chatReply' }),
            delayOverride != null ? { type: 'chatReply', typingDelayMs: delayOverride } : { type: 'chatReply' });
          try {
            const { recordSend, recordStyleSend, replyHash } = await import('./replyAnalyticsService.js');
            const baseText = picked.baseReply ? picked.baseReply.text : picked.reply.text;
            recordSend(chatMatch.rule.id, { text: baseText, language, style: picked.styleUsed });
            recordStyleSend(chatMatch.rule.id, picked.styleUsed);
            sessionManager.setState(sender, chatId, {
              lastChatReply: {
                ruleId: chatMatch.rule.id,
                replyHash: replyHash(baseText),
                text: baseText.slice(0, 300),
                style: picked.styleUsed,
                sentAt: new Date().toISOString()
              }
            });
          } catch { /* analytics must never break replies */ }
        }
        markRuleResponded(sender, chatMatch.rule);
        // Step 5 — post-reply context update.
        const pendingBefore = pendingContext;
        let pendingAfter = pendingBefore;
        let contextMatched = false;
        try {
          if (chatMatch.rule.setsContext) {
            const expiryMs = Number(chatMatch.rule.contextExpiryMs) > 0
              ? Math.min(3600000, Math.floor(Number(chatMatch.rule.contextExpiryMs)))
              : (Number(chatSettings.contextExpiryMs) > 0
                ? Math.min(3600000, Math.floor(Number(chatSettings.contextExpiryMs)))
                : (Number(config.chatContextDefaultExpiryMs) || 120000));
            const now = Date.now();
            sessionManager.setState(sender, chatId, {
              pendingContext: chatMatch.rule.setsContext,
              pendingContextSetAt: new Date(now).toISOString(),
              pendingContextExpiresAt: now + expiryMs,
              lastBotMessage: reply
            });
            pendingAfter = chatMatch.rule.setsContext;
          } else if (chatMatch.rule.context && pendingBefore && chatMatch.rule.context === pendingBefore) {
            contextMatched = true;
            sessionManager.setState(sender, chatId, {
              pendingContext: null,
              pendingContextSetAt: null,
              pendingContextExpiresAt: null,
              lastBotMessage: reply
            });
            pendingAfter = null;
          } else {
            sessionManager.setState(sender, chatId, { lastBotMessage: reply });
          }
        } catch { /* context must never break replies */ }
        if (picked && chatSettings.logChatMatches === true) {
          try {
            const { logChatMatch } = await import('./chatSettingsService.js');
            const { replyHash: hashReply } = await import('./replyAnalyticsService.js');
            const baseText = picked.baseReply ? picked.baseReply.text : picked.reply.text;
            logChatMatch(chatMatch.rule.id, sender, trimmed, {
              selectedReply: picked.reply.text.slice(0, 200),
              candidatesCount: picked.candidatesCount,
              excludedByAntiRepeat: picked.excludedByAntiRepeat,
              pendingContextBefore: pendingBefore,
              pendingContextAfter: pendingAfter,
              contextMatched,
              detectedTone: picked.detectedTone,
              timeOfDay: picked.timeOfDay,
              toneFilterApplied: !!(picked.filters && picked.filters.tone),
              timeFilterApplied: !!(picked.filters && picked.filters.time),
              fallbacksUsed: picked.fallbacksUsed || [],
              styleUsed: picked.styleUsed,
              followUpUsed: !!picked.followUpUsed,
              followUpText: (picked.followUpText || '').slice(0, 120),
              effectivePriority: chatMatch.effectivePriority,
              engagementBonus: picked.engagementBonus,
              replyHash: hashReply(baseText),
              rateLimited: false,
              snippetsExpanded
            });
          } catch { /* noop */ }
        }
        if (chatSettings.contextAwareness !== false) {
          sessionManager.setState(sender, chatId, {
            lastMatchedRuleId: chatMatch.rule.id,
            lastBotPrompt: reply
          });
        }
        await performRuleAction(context, sender, chatId, language, user, chatMatch.rule.action);
        try {
          const { noteFallbackSuccess } = await import('./fallbackService.js');
          noteFallbackSuccess(sender);
        } catch { /* noop */ }
        return true;
      }
    }
  }

  // FAQ knowledge base. Checked after chat rules, before generic handling.
  // The global chat toggle gates FAQ matching too.
  if (isFeatureEnabled('faq') && getChatSettingsSafe().chatEnabled !== false) {
    const faqResult = matchFaq(trimmed, language);
    if (faqResult && !faqResult.multiple) {
      try {
        const { incrementFaqHit } = await import('./chatStatsService.js');
        incrementFaqHit(faqResult.entry.id);
      } catch { /* stats must never break replies */ }
      try {
        const { recordKeywordHit } = await import('./faqKeywordStatsService.js');
        for (const kw of faqResult.matchedKeywords || []) recordKeywordHit(faqResult.entry.id, kw);
      } catch { /* stats must never break replies */ }
      let answer;
      try {
        const { resolveAnswer, relatedFaqs } = await import('./faqService.js');
        answer = resolveAnswer(faqResult.entry);
        const related = relatedFaqs(faqResult.entry.id, 2);
        if (related.length) {
          const { t: tr } = await import('./localeService.js');
          answer += '\n\n' + toSmallCaps(tr(language, 'faq.relatedTitle')) + '\n'
            + related.map((r, i) => `${i + 1}. "${r.question}"`).join('\n');
        }
      } catch {
        answer = faqResult.entry.answer;
      }
      try {
        const { expandSnippets } = await import('../utils/snippetExpander.js');
        answer = expandSnippets(answer, language);
      } catch { /* snippets must never break replies */ }
      answer = replacePlaceholders(answer, user, config);
      if (await guardFaqRateLimit(context, sender, chatId, language, getChatSettingsSafe())) return true;
      await withTyping(context.sock, sender, () =>
        sendText(context.sock, sender, answer));
      try {
        const { noteFallbackSuccess } = await import('./fallbackService.js');
        noteFallbackSuccess(sender);
      } catch { /* noop */ }
      return true;
    }
    if (faqResult && faqResult.multiple) {
      sessionManager.setState(sender, chatId, {
        faqCandidates: faqResult.candidates,
        faqCandidateIds: faqResult.candidates.map((c) => c.id)
      });
      const lines = faqResult.candidates.map((c, i) => `${i + 1}. ${c.question}`);
      const chooseText = smallText(language, 'conversation.faqChoose') + '\n\n' + lines.join('\n');
      await withTyping(context.sock, sender, () =>
        sendText(context.sock, sender, chooseText));
      return true;
    }
  }

  // Greetings.
  if (isGreeting(trimmed)) {
    await withTyping(context.sock, sender, () =>
      sendText(context.sock, sender, smallText(language, 'conversation.greeting', { username: displayNameOf(user) })));
    return true;
  }

  // Help: direct phrase or a close misspelling of "help".
  if (isDirectHelp(trimmed) || isMisspelledHelp(trimmed)) {
    sessionManager.setState(sender, chatId, { awaitingHelpConfirmation: true, helpUnknownCount: 0 });
    if (isMisspelledHelp(trimmed) && !isDirectHelp(trimmed)) {
      await withTyping(context.sock, sender, () =>
        sendText(context.sock, sender, 'ʜᴍᴍ..🤔 ' + smallText(language, 'conversation.helpMean')));
    } else {
      await withTyping(context.sock, sender, () =>
        sendText(context.sock, sender, smallText(language, 'conversation.helpAsk', { username: displayNameOf(user) })));
    }
    return true;
  }

  // Unknown free text: graceful fallback decision tree (greeting, question,
  // emotional, gibberish, generic) with repeat suppression.
  try {
    const { logUnmatched } = await import('./unmatchedService.js');
    logUnmatched(sender, trimmed);
  } catch { /* logging must never break replies */ }
  try {
    const { recordSuggestion } = await import('./suggestionService.js');
    recordSuggestion(trimmed);
  } catch { /* suggestions must never break replies */ }
  try {
    const { recordKeywordMiss } = await import('./faqKeywordStatsService.js');
    const { getAllEntries } = await import('./faqService.js');
    const input = normText(trimmed);
    if (input) {
      for (const entry of getAllEntries()) {
        if (!entry.enabled || entry.status === 'draft') continue;
        for (const kw of entry.keywords || []) {
          const nk = normText(kw);
          if (!nk || nk === input) continue;
          if (levEdit(input, nk) <= 2) recordKeywordMiss(entry.id, kw);
        }
      }
    }
  } catch { /* stats must never break replies */ }
  try {
    const { recordTriggerMiss } = await import('./triggerStatsService.js');
    const { getAllRules } = await import('./chatRuleService.js');
    const input = normText(trimmed);
    if (input) {
      for (const rule of getAllRules()) {
        if (!rule.enabled) continue;
        for (const trigger of rule.triggers || []) {
          const nt = normText(trigger);
          if (!nt || nt === input) continue;
          if (levEdit(input, nt) <= 2) recordTriggerMiss(rule.id, trigger);
        }
      }
    }
  } catch { /* stats must never break replies */ }
  try {
    const { handleFallback } = await import('./fallbackService.js');
    await handleFallback(context, user, language, trimmed);
  } catch (err) {
    logger.warn({ err }, 'Fallback flow failed');
  }
  return true;
}

// ---------------------------------------------------------------------------
// First-time onboarding intro
// ---------------------------------------------------------------------------

/**
 * Send the welcome intro after a brand-new user picks their language, then
 * wait for their first free-text reply (handled by handleFreeText via the
 * `awaitingIntro` session flag).
 */
export async function sendOnboardingIntro(context, language, displayName) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  sessionManager.setState(sender, chatId, { currentMenu: 'onboarding_intro', awaitingIntro: true, isLanguageSelectionPending: false });
  const text = buildMenu(
    t(language, 'conversation.introHello', { name: displayName }),
    '',
    [
      t(language, 'conversation.introText', { botName: settingsService.getBotName() }),
      '',
      t(language, 'conversation.introHow')
    ]
  );
  await withTyping(context.sock, sender, async () => {
    await sendText(context.sock, sender, text);
  });
}

// ---------------------------------------------------------------------------
// Preferences (options 13-16) helper: chat disabled notice
// ---------------------------------------------------------------------------

/**
 * Build the "chat is currently unavailable" menu shown when the user tries to
 * use a chat-related preference while the feature is off.
 * @returns {string} the menu text
 */
export function buildChatDisableNoticeText(language) {
  const conv = isConversationEnabled();
  const offMsg = conv.temporary
    ? String(config.conversationTemporaryOffMessage).replace('{duration}', durationLabel(conv.remainingMs))
    : String(config.conversationPermanentOffMessage);
  return buildMenu(
    t(language, 'conversation.title'),
    '',
    [
      toSmallCaps(offMsg),
      '',
      '1. ' + toSmallCaps(t(language, 'feature.notifyOption')),
      '',
      '0. ' + toSmallCaps(t(language, 'preferences.back')),
      '',
      t(language, 'preferences.replyPrompt')
    ]
  );
}