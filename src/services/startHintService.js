// Idle-then-hint: after a chat rule reply or a welcome-back, wait for the user
// to go quiet and then suggest /start instead of pushing the main menu at them.
//
// Only two things schedule a hint (a chat reply and a welcome-back). Anything
// else -- a command reply, an error, onboarding, the resume prompt -- either
// means the user already knows what they are doing or is handled by the menu
// system, so a nudge would be wrong.
//
// The hint is suppressed whenever a menu, wizard, cooldown lock or resume
// confirmation is active, and is rate-limited by a cooldown window.
import logger from '../utils/logger.js';
import { getContent } from './botContentService.js';
import { sendText } from './messageService.js';
import { getMenu } from '../config/menus/registry.js';
import { resolvePlaceholders } from '../utils/placeholderResolver.js';
import { isWizardState } from './welcomeBackService.js';
import sessionManager from '../utils/sessionManager.js';

/** sender -> Timeout */
const activeTimers = new Map();

export function cancelStartHint(sender) {
  const t = activeTimers.get(sender);
  if (t) {
    clearTimeout(t);
    activeTimers.delete(sender);
  }
}

export function pendingStartHint(sender) {
  return activeTimers.has(sender);
}

/** Test seam: drop every pending timer without waiting for it. */
export function cancelAllStartHints() {
  for (const t of activeTimers.values()) clearTimeout(t);
  activeTimers.clear();
}

/**
 * Quiet hours as an "HH:MM" window. Handles the overnight case where the start
 * is later than the end (23:00 -> 07:00).
 */
export function isInQuietHours(now = new Date()) {
  if (getContent('timing.startHintQuietHoursEnabled', false) !== true) return false;
  const start = String(getContent('timing.startHintQuietHoursStart', '23:00'));
  const end = String(getContent('timing.startHintQuietHoursEnd', '07:00'));
  const current = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
  return start <= end
    ? current >= start && current < end
    : current >= start || current < end;
}

/**
 * True when a hint would land badly: a registered menu is open, a wizard is
 * mid-flight, the onboarding cooldown lock is live, or a resume confirmation is
 * pending.
 */
export function isHintSuppressed(session, now = Date.now()) {
  if (!session) return false;
  if (session.currentMenu && getMenu(session.currentMenu)) return true;
  if (typeof session.languageOnboardingLockedUntil === 'number' && session.languageOnboardingLockedUntil > now) return true;
  if (session.awaitingResumeConfirmation === true) return true;
  if (isWizardState(session.currentMenu)) return true;
  return false;
}

/** Rate limit, read from and written back to the session store. */
export function hintCooldownActive(session, now = Date.now()) {
  const window = Number(getContent('timing.startHintCooldownMs', 600000));
  const last = Number(session?.lastStartHintAt || 0);
  return Number.isFinite(window) && last > 0 && (now - last) < window;
}

const DEFAULTS = {
  startHintText: '💡 Want to see the menu? Send /start.',
  startHintTextAfterWelcomeBack: "💡 Welcome back! Send /start when you're ready."
};

function hintText(kind) {
  const key = kind === 'welcomeBack'
    ? 'timing.startHintTextAfterWelcomeBack'
    : 'timing.startHintText';
  return resolvePlaceholders(String(getContent(key, DEFAULTS[key])), {
    pushName: '',
    botName: 'X-Vortex'
  });
}

/**
 * Schedule the hint. One pending timer per sender; scheduling again replaces it.
 *
 * @param {string} sender
 * @param {{ sock: object, user?: object, chatId?: string }} context
 * @param {'chat'|'welcomeBack'} kind
 */
export function scheduleStartHint(sender, context, kind = 'chat') {
  if (getContent('timing.startHintEnabled', true) !== true) return false;

  const chatId = context.chatId || sender;
  const session = context.session || sessionManager.getSession(sender, chatId) || {};

  if (isInQuietHours()) {
    logger.debug({ sender }, '[START_HINT] suppressed by quiet hours');
    return false;
  }
  if (isHintSuppressed(session)) {
    logger.debug({ sender, menu: session.currentMenu }, '[START_HINT] suppressed by active state');
    return false;
  }

  cancelStartHint(sender);

  const delay = Math.max(0, Number(getContent('timing.startHintDelayMs', 60000)) || 60000);
  const timer = setTimeout(async () => {
    activeTimers.delete(sender);
    try {
      // Re-read the session at fire time: the user may have opened a menu,
      // walked into a wizard, or been locked out during the wait.
      const live = sessionManager.getSession(sender, chatId) || {};
      if (isHintSuppressed(live)) return;
      if (hintCooldownActive(live)) {
        logger.debug({ sender }, '[START_HINT] suppressed by cooldown');
        return;
      }
      if (!context.sock) return;

      await sendText(context.sock, sender, hintText(kind), { type: 'silent' });
      // Persisted, not written onto the snapshot, or the cooldown would never
      // engage and every idle gap would get a hint.
      sessionManager.setState(sender, chatId, { lastStartHintAt: Date.now() });
      logger.info({ sender, kind }, '[START_HINT] sent');
    } catch (err) {
      logger.error({ err, sender }, '[START_HINT] failed to send');
    }
  }, delay);

  if (typeof timer.unref === 'function') timer.unref();
  activeTimers.set(sender, timer);
  logger.debug({ sender, kind, delay }, '[START_HINT] scheduled');
  return true;
}

export { DEFAULTS as START_HINT_DEFAULTS };