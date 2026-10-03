import config from '../config/config.js';
import logger from '../utils/logger.js';
import sessionManager from '../utils/sessionManager.js';
import { sendText } from '../services/messageService.js';
import { toSmallCaps } from '../utils/smallCaps.js';
import { t } from '../services/localeService.js';
import { buildMenu } from '../utils/menuBuilder.js';
import { sendMenu } from '../utils/messageHelper.js';
import { askConfirmation } from '../utils/confirmationHelper.js';
import { logAdminAction } from '../services/adminLogService.js';
import {
  ensureUserProfile,
  getUserByJid,
  deleteUserByJid,
  deleteTestUsers
} from '../services/userService.js';

const LOAD_DELAY_MS = 1000;
const activeTimers = new Map();
const timerPresets = {
  '1': 10 * 60 * 1000,
  '2': 30 * 60 * 1000,
  '3': 60 * 60 * 1000
};
const testNames = ['Lukewarm123', 'SunnyOrbit', 'QuietPixel', 'BriskComet', 'VelvetCircuit'];

function randomTestIdentity() {
  const suffix = Math.random().toString(36).slice(2, 8);
  const name = testNames[Math.floor(Math.random() * testNames.length)];
  return {
    name,
    username: `test_${suffix}`,
    jid: `${Date.now()}-${suffix}@lid`
  };
}

function languageOf(sender) {
  return getUserByJid(sender).then((user) => user?.language || config.defaultLanguage);
}

function L(language, key, params = {}) {
  return toSmallCaps(t(language, key, params));
}

function sessionFor(context) {
  return sessionManager.getSession(context.sender, context.chatId || context.sender) || {};
}

function formatDuration(ms, language) {
  if (!ms) return L(language, 'admin.try.noTimer');
  const minutes = Math.round(ms / 60000);
  if (minutes % 60 === 0) return `${minutes / 60} ${t(language, 'admin.try.oneHour').replace(/^\d+\s*/, '')}`;
  return `${minutes} ${t(language, 'admin.try.tenMinutes').replace(/^\d+\s*/, '')}`;
}

function testInfoLine(language, testSession) {
  return [
    '*' + L(language, 'admin.try.name') + ':* ' + testSession.testName,
    '*' + L(language, 'profile.username') + ':* ' + testSession.testUsername,
    '*' + L(language, 'admin.try.id') + ':* ' + testSession.testUserJid,
    '*' + L(language, 'admin.try.sessionTime') + ':* ' + formatDuration(testSession.durationMs, language),
    '*' + L(language, 'admin.try.sessionDate') + ':* ' + new Date(testSession.startTime).toLocaleString(),
    testSession.endTime
      ? '*' + L(language, 'admin.try.sessionDate') + ':* ' + new Date(testSession.endTime).toLocaleString()
      : ''
  ].join('\n');
}

async function sendTryConfirmation(context, data = {}) {
  const language = await languageOf(context.sender);
  return askConfirmation({ sock: context.sock, sender: context.sender, chatId: context.chatId || context.sender }, 'tryStart', {
    language,
    warning: data.warning || false,
    current: data.current || null,
    replaceActive: data.replaceActive || false
  });
}

export async function startTryCommand(context) {
  const args = context.args || [];
  const session = sessionFor(context);
  if (args[0]?.toLowerCase() === 'end') return endTrySession(context);
  if (args[0]?.toLowerCase() === 'purge') {
    const removed = await deleteTestUsers();
    await sendText(context.sock, context.sender, L(await languageOf(context.sender), 'admin.try.purged') + ` (${removed})`);
    return { success: true };
  }
  if (session.isTestActive && session.testSession) {
    const language = await languageOf(context.sender);
    return sendTryConfirmation(context, {
      warning: true,
      current: session.testSession,
      replaceActive: true,
      language
    });
  }
  return sendTryConfirmation(context);
}

export async function showTryTimerSelection(context) {
  const language = await languageOf(context.sender);
  const text = buildMenu(L(language, 'admin.try.timerTitle'), '', [
    L(language, 'admin.try.timerQuestion'), '',
    '1. ' + L(language, 'admin.try.tenMinutes'),
    '2. ' + L(language, 'admin.try.thirtyMinutes'),
    '3. ' + L(language, 'admin.try.oneHour'),
    '',
    '4. ' + L(language, 'admin.try.noTimer'),
    '5. ' + L(language, 'admin.try.customize'),
    '',
    '0. ' + L(language, 'admin.try.back'), '',
    L(language, 'admin.try.replyPrompt')
  ]);
  sessionManager.setState(context.sender, context.chatId || context.sender, { currentMenu: 'try_timer', pendingAction: null, pendingData: null });
  return sendMenu({ sock: context.sock, sender: context.sender, chatId: context.chatId || context.sender, text, transitionKey: 'try_timer' });
}

function timerConfirmationText(language, durationMs) {
  return buildMenu(L(language, 'admin.try.timerTitle'), '', [
    t(language, 'admin.try.timerConfirm', { duration: formatDuration(durationMs, language) }), '',
    '1. ' + L(language, 'admin.yes'),
    '2. ' + L(language, 'admin.no'), '',
    L(language, 'admin.try.replyPrompt')
  ]);
}

async function confirmTryTimer(context, durationMs) {
  const language = await languageOf(context.sender);
  sessionManager.setState(context.sender, context.chatId || context.sender, {
    currentMenu: 'try_timer_confirmation',
    pendingTryDurationMs: durationMs
  });
  return sendMenu({ sock: context.sock, sender: context.sender, chatId: context.chatId || context.sender, text: timerConfirmationText(language, durationMs), transitionKey: 'try_timer_confirmation' });
}

export async function handleTryReply(context, input) {
  const chatId = context.chatId || context.sender;
  const value = String(input || '').trim();
  const session = sessionFor(context);
  if (session.currentMenu === 'try_timer') {
    if (value === '0') return sendTryConfirmation(context);
    if (timerPresets[value]) return confirmTryTimer(context, timerPresets[value]);
    if (value === '4') return confirmTryTimer(context, 0);
    if (value === '5') {
      const language = await languageOf(context.sender);
      sessionManager.setState(context.sender, chatId, { currentMenu: 'try_timer_custom' });
      return sendMenu({
        sock: context.sock, sender: context.sender, chatId,
        text: buildMenu(L(language, 'admin.try.timerTitle'), '', [L(language, 'admin.try.customPrompt'), '', '0. ' + L(language, 'admin.try.back')]),
        transitionKey: 'try_timer_custom'
      });
    }
  }
  if (session.currentMenu === 'try_timer_custom') {
    if (value === '0') return showTryTimerSelection(context);
    const match = /^(\d+)\s*(m|min|mins|minute|minutes|h|hr|hrs|hour|hours)$/i.exec(value);
    if (!match) {
      await sendText(context.sock, context.sender, L(await languageOf(context.sender), 'admin.try.customInvalid'));
      return;
    }
    const amount = Number(match[1]);
    const unit = match[2].toLowerCase();
    const durationMs = amount * (unit.startsWith('h') ? 60 * 60 * 1000 : 60 * 1000);
    if (!durationMs) return;
    return confirmTryTimer(context, durationMs);
  }
  if (session.currentMenu === 'try_timer_confirmation') {
    if (value === '2') return showTryTimerSelection(context);
    if (value === '1') return createTryUser(context, session.pendingTryDurationMs || 0);
  }
  await sendText(context.sock, context.sender, L(await languageOf(context.sender), 'common.invalidChoiceValid'));
}

async function updateLoading(context, key, body) {
  const chatId = context.chatId || context.sender;
  sessionManager.setState(context.sender, chatId, { testAnimationBusy: true });
  try {
    if (key) {
      await context.sock.sendMessage(context.sender, { text: body, edit: key });
      return key;
    }
    const sent = await context.sock.sendMessage(context.sender, { text: body });
    return sent?.key || null;
  } catch (err) {
    logger.warn({ err }, '[TRY] loading update failed');
    if (!key) return null;
    const sent = await context.sock.sendMessage(context.sender, { text: body });
    return sent?.key || null;
  } finally {
    sessionManager.setState(context.sender, chatId, { testAnimationBusy: false });
  }
}

async function createTryUser(context, durationMs) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = await languageOf(sender);
  const stages = [
    L(language, 'admin.try.loadingFirst'),
    L(language, 'admin.try.loadingSecond'),
    L(language, 'admin.try.loadingLast')
  ];
  sessionManager.setState(sender, chatId, { currentMenu: 'processing', isProcessing: true, processType: 'test_account_creation', cancelled: false });
  let progressKey = null;
  for (const stage of stages) {
    for (const dots of ['.', '..', '...']) {
      const currentSession = sessionManager.getSession(sender, chatId) || {};
      if (currentSession.cancelled || currentSession.isEndingTestSession) return;
      progressKey = await updateLoading(context, progressKey, buildMenu(L(language, 'admin.try.loadingTitle'), '', [stage + dots]));
      await new Promise((resolve) => setTimeout(resolve, LOAD_DELAY_MS));
    }
  }
  progressKey = await updateLoading(context, progressKey, buildMenu(L(language, 'admin.try.loadingTitle'), '', [L(language, 'admin.try.waitPlease')]));
  if (sessionManager.getSession(sender, chatId)?.isEndingTestSession) return;
  const identity = randomTestIdentity();
  await ensureUserProfile({ jid: identity.jid, name: identity.name, username: identity.username, isTest: true });
  const startTime = new Date().toISOString();
  const endTime = durationMs ? new Date(Date.now() + durationMs).toISOString() : null;
  const testSession = { testUserJid: identity.jid, testName: identity.name, testUsername: identity.username, adminLanguage: language, startTime, endTime, durationMs, isTestActive: true };
  sessionManager.setState(sender, chatId, { currentMenu: 'try_active', isProcessing: false, processType: null, progressMessageKey: null, testSession, isTestActive: true, currentUserJid: identity.jid });
  const info = buildMenu(L(language, 'admin.try.infoTitle'), '', [
    '*' + L(language, 'admin.try.accountCreated') + ' ✅*',
    L(language, 'admin.try.accountInfo'), '', testInfoLine(language, testSession), '',
    L(language, 'admin.try.sendStart')
  ]);
  await updateLoading(context, progressKey, info);
  logAdminAction(sender, 'test_session_start', identity.jid);
  if (durationMs) {
    const timer = setTimeout(() => {
      activeTimers.delete(sender);
      endTrySession(context, true).catch((err) => logger.warn({ err }, '[TRY] timer cleanup failed'));
    }, durationMs);
    activeTimers.set(sender, timer);
  }
}

export async function endTrySession(context, automatic = false) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const session = sessionFor(context);
  const testSession = session.testSession;
  if (session.isEndingTestSession) return { success: false };
  if (!testSession?.testUserJid) {
    await sendText(context.sock, sender, L(await languageOf(sender), 'admin.try.noActive'));
    return { success: false };
  }
  const language = testSession.adminLanguage || await languageOf(sender);
  const currentMenuKey = session.lastMenuKey || null;
  sessionManager.setState(sender, chatId, {
    isEndingTestSession: true,
    isProcessing: false,
    cancelled: true,
    pendingAction: null,
    pendingData: null,
    currentUserJid: sender,
    isTestActive: false,
    testSession: null,
    lastMenuKey: currentMenuKey,
    // Part 1: leaving try mode mid-onboarding must not strand the restored
    // admin behind a resume prompt, a cooldown lock or a stale menu. The test
    // user record itself is deleted below.
    awaitingResumeConfirmation: false,
    cooldownJustExpired: false,
    resumeFromStage: null,
    resumeAttempts: 0,
    onboardingStage: null,
    languageOnboardingLockedUntil: 0,
    onboardingAttempts: 0,
    onboardingLastRetry: -1,
    detectedLanguage: null,
    detectedLanguageRaw: null,
    detectedLanguageSource: null,
    idleClose: false,
    idleCloseUntil: null
  });
  for (let attempt = 0; attempt < 50; attempt++) {
    if (!sessionManager.getSession(sender, chatId)?.testAnimationBusy) break;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  await deleteUserByJid(testSession.testUserJid);
  const timer = activeTimers.get(sender);
  if (timer) clearTimeout(timer);
  activeTimers.delete(sender);
  const endTime = new Date().toISOString();
  const info = testInfoLine(language, { ...testSession, endTime });
  await sendMenu({ sock: context.sock, sender, chatId, text: buildMenu(L(language, 'admin.try.infoTitle'), '', [L(language, automatic ? 'admin.try.endedAutomatically' : 'admin.try.ended'), '', info]), transitionKey: 'try_end' });
  sessionManager.setState(sender, chatId, { currentMenu: 'main', isEndingTestSession: false, currentUserJid: sender });
  logAdminAction(sender, 'test_session_end', testSession.testUserJid);
  return { success: true };
}

export const command = {
  name: 'try',
  description: 'Start a test session (new user simulation)',
  usage: '/try | /try end | /try purge',
  aliases: [],
  adminOnly: true,
  groupAllowed: false,
  async execute(context) {
    return startTryCommand(context);
  }
};
