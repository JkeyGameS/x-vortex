import logger from '../utils/logger.js';
import config from '../config/config.js';
import { scheduleSelfDestruct } from './selfDestructService.js';
import { withTyping } from '../utils/typingHelper.js';
import { toSmallCaps } from '../utils/smallCaps.js';
import { checkOutbound, recordBlock } from './outboundRateLimitService.js';

/**
 * Message types that are the direct consequence of a button the user just
 * pressed, and so should never be suppressed by the counter they were
 * triggered by.
 *
 * 'mainMenu' and 'submenuTransition' are handled separately in sendMenu (the
 * menu path has its own gate). 'confirmation' covers the short notes that
 * answer an action: "Cancelled.", "Account reset.", "Saved." Sending one of
 * those after the user's input was counted is exactly how the second-pass bug
 * happened -- the action was accepted, then its own reply was swallowed.
 */
const USER_OUTCOME_TYPES = new Set(['confirmation', 'mainMenu', 'submenuTransition']);

/**
 * True when this send is the answer to a user action and should bypass the
 * per-chat counter.
 */
function isUserOutcome(options = {}) {
  if (options && options.bypassRateLimit === true) return true;
  if (config.rateLimit?.bypassForUserOutcomes === false) return false;
  return USER_OUTCOME_TYPES.has(options?.type);
}

/**
 * Tell the user their input was rate-limited.
 *
 * Dropping a reply with no explanation is the worst outcome: the user has no
 * way to tell "slow down" from "ignored". Sent with the limiter bypassed --
 * telling someone to slow down must not itself be dropped -- and without
 * typing, because the point is to be instant.
 */
async function sendSlowDownNotice(sock, jid) {
  try {
    await sock.sendMessage(jid, {
      text: '\u23F3 ' + toSmallCaps('Slow down a bit. Try again in a few seconds.')
    });
  } catch (err) {
    logger.warn({ err, jid }, '[OUTBOUND_RATE_LIMIT] slow-down notice failed');
  }
}

/**
 * Shared gate for every outbound send that goes through this module.
 *
 * Returns true when the send may proceed. Admin notifications pass
 * options.bypassRateLimit so a spam warning can never be suppressed by the
 * limit it is reporting. User-outcome messages bypass for the same reason.
 *
 * @returns {boolean} whether to proceed
 */
async function outboundAllowed(sock, jid, options = {}) {
  if (isUserOutcome(options)) return true;
  const check = checkOutbound(jid);
  if (check.allowed) return true;

  logger.warn({ jid, reason: check.reason }, '[OUTBOUND_RATE_LIMIT] suppressed');
  try {
    const warning = recordBlock(check.reason);
    if (warning.shouldWarn) {
      const { notifyAdminsRateLimit } = await import('../utils/adminRateLimitWarning.js');
      notifyAdminsRateLimit(sock, warning.count, check.reason).catch(() => {});
    }
  } catch (err) {
    // Warning delivery must never turn a blocked send into a thrown error.
    logger.warn({ err }, '[OUTBOUND_RATE_LIMIT] failed to record block');
  }
  // Say so instead of vanishing. Only fires for traffic that was actually
  // suppressed (unsolicited sends); menu and user-outcome sends never reach
  // this point because they bypass above.
  await sendSlowDownNotice(sock, jid);
  return false;
}

// The single funnel for sendText / sendTextWithTyping / sendTextRaw / sendError.
// Guarding here rather than in each export means one send consumes exactly one
// slot: sendTextWithTyping delegates to sendText and sendError calls sendText,
// so a per-export guard would count those twice.
async function sendRaw(sock, jid, text, options = {}) {
  if (!await outboundAllowed(sock, jid, options)) return false;
  try {
    const sent = await sock.sendMessage(jid, { text });
    await scheduleSelfDestruct(sock, jid, sent?.key);
    return true;
  } catch (err) {
    logger.error({ err, jid }, 'Failed to send message');
    return false;
  }
}

/**
 * Send a user-facing text reply with typing indicator + resolved delay.
 * Options: { type, skipTyping, typingDelayMs, presenceType, bypassRateLimit }.
 * Types: mainMenu | submenuTransition | chatReply (default) | confirmation
 * | error | silent. Pass { skipTyping: true } or type 'silent' for immediate
 * system messages (broadcasts, reports, reminders, session notices).
 *
 * Resolves true when delivered, false when suppressed or failed.
 */
export async function sendText(sock, jid, text, options = {}) {
  try {
    const opts = { type: 'chatReply', ...(options || {}) };
    return await withTyping(sock, jid, () => sendRaw(sock, jid, text, opts), opts);
  } catch (error) {
    logger.error({ err: error, jid }, 'Failed to send text');
    return false;
  }
}

/** Explicit typing send (same as sendText default). */
export async function sendTextWithTyping(sock, jid, text, options = {}) {
  return sendText(sock, jid, text, options);
}

/** Raw send without typing indicator or delay (system messages). */
export async function sendTextRaw(sock, jid, text, options = {}) {
  return sendRaw(sock, jid, text, options);
}

/**
 * Send a document/media payload ({ document, mimetype, fileName, caption }).
 *
 * These are real outbound messages and count against the limiter, so they are
 * gated here rather than left as bare sock.sendMessage calls. Error semantics
 * match the previous direct calls: transport failures propagate to the caller.
 *
 * Does not schedule self-destruct; export payloads are intentionally durable.
 */
export async function sendDocument(sock, jid, payload, options = {}) {
  if (!await outboundAllowed(sock, jid, options)) return null;
  return sock.sendMessage(jid, payload);
}

export async function sendError(sock, jid, text, options = {}) {
  return sendText(sock, jid, `\u274C ${text}`, { type: 'error', ...(options || {}) });
}