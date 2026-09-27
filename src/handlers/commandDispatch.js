import logger from '../utils/logger.js';
import { sendText } from '../services/messageService.js';
import * as reportService from '../services/reportService.js';
import { t } from '../services/localeService.js';
import { toSmallCaps } from '../utils/smallCaps.js';
import { trackCommand } from '../services/analyticsService.js';
import { trackUserCommand, trackCommandSuccess, trackCommandError } from '../services/userService.js';
import { recordResponseTime } from '../services/responseTimeService.js';
import { addError } from '../services/errorLogService.js';
import { setLastError } from '../utils/errorTracker.js';

/**
 * Render the localized unknown-command error. Static parts are small-capped
 * while the embedded command name stays in normal case:
 *   ❌ ᴜɴᴋɴᴏᴡɴ ᴄᴏᴍᴍᴀɴᴅ. sᴇɴᴅ /help ғᴏʀ ᴀ ʟɪsᴛ ᴏғ ᴄᴏᴍᴍᴀɴᴅs.
 */
export function renderUnknownCommand(language) {
  const sentence = t(language, 'common.unknownCommand');
  const parts = String(sentence).split('{help}');
  if (parts.length !== 2) return toSmallCaps(sentence);
  return toSmallCaps(parts[0]) + '/help' + toSmallCaps(parts[1]);
}

/**
 * Execute a slash command from the message router.
 *
 * The router always routes messages starting with the command prefix here,
 * even when an interactive menu is active: a valid command overrides the
 * session (menu commands set the new menu themselves), while an unknown
 * command replies with an error and leaves the current session untouched.
 *
 * @param {object} opts
 * @param {Map}    opts.commands        - command map (name/alias -> command)
 * @param {string} opts.cmdName         - raw command token (e.g. "profile")
 * @param {string[]} opts.args          - remaining tokens
 * @param {object} opts.context         - { sock, sender, chatId, pushName }
 * @param {string} opts.language        - resolved user language
 * @param {Function} opts.tr            - localized small-caps translator
 * @param {Function} opts.isAdminOperator - jid -> boolean
 * @param {string} [opts.permissionJid] - effective user JID for permissions
 * @param {boolean} opts.isGroup        - true when sent from a group chat
 * @param {Map} [opts.spamTimestamps]   - spam tracker (skipped when omitted)
 * @param {number} [opts.spamThreshold] - max commands per window before alert
 * @param {number} [opts.spamWindowMs]  - spam window length in ms
 * @returns {Promise<{ executed: boolean, reason?: string }>}
 */
export async function dispatchCommand({
  commands,
  cmdName,
  args,
  context,
  language,
  tr,
  isAdminOperator,
  permissionJid = null,
  isGroup,
  spamTimestamps = null,
  spamThreshold = 0,
  spamWindowMs = 0
}) {
  const normalized = String(cmdName || '').toLowerCase();
  const command = commands.get(normalized);

  if (!command) {
    logger.info({ cmdName: normalized }, 'Unknown command received');
    await sendText(context.sock, context.sender, renderUnknownCommand(language));
    return { executed: false, reason: 'unknown' };
  }

  // Check if command is allowed in groups.
  if (isGroup && command.groupAllowed === false) {
    await sendText(context.sock, context.sender, tr('common.noGroups'));
    return { executed: false, reason: 'group' };
  }

  // Check if command is admin only.
  if (command.adminOnly && !isAdminOperator(permissionJid || context.sender)) {
    reportService.reportToAdmins('security', {
      user: permissionJid || context.sender,
      action: 'admin_command_attempt',
      details: normalized
    });
    await sendText(context.sock, context.sender, tr('common.notAuthorized'));
    return { executed: false, reason: 'admin' };
  }

  // Spam detection: prune old timestamps, flag if count exceeds threshold.
  if (spamTimestamps && spamThreshold > 0 && spamWindowMs > 0) {
    const now = Date.now();
    const recent = (spamTimestamps.get(context.sender) || []).filter((ts) => now - ts < spamWindowMs);
    recent.push(now);
    spamTimestamps.set(context.sender, recent);
    if (recent.length > spamThreshold) {
      reportService.reportToAdmins('spam', {
        user: context.sender,
        command: normalized,
        count: recent.length,
        windowMs: spamWindowMs
      });
    }
  }

  // Execute command.
  const runContext = {
    sock: context.sock,
    sender: context.sender,
    chatId: context.chatId,
    pushName: context.pushName,
    args,
    commandName: normalized,
    commands,
    isAdmin: isAdminOperator(permissionJid || context.sender)
  };

  const startTime = Date.now();
  try {
    await command.execute(runContext);
    trackCommand(normalized, context.sender);
    await trackUserCommand(context.sender, normalized);
    await trackCommandSuccess(context.sender);
    recordResponseTime(normalized, Date.now() - startTime);
    return { executed: true };
  } catch (err) {
    addError(err);
    setLastError(err);
    await trackCommandError(context.sender);
    recordResponseTime(normalized, Date.now() - startTime);
    logger.error({ err }, `Error executing command ${normalized}`);
    reportService.reportToAdmins('bug', {
      user: context.sender,
      command: normalized,
      error: err.message,
      stack: err.stack
    });
    return { executed: false, reason: 'error' };
  }
}