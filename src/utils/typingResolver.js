import config from '../config/config.js';
import { getTypingSettings, sanitizeUserTyping } from '../services/typingSettingsService.js';

const USER_KEY_BY_TYPE = {
  mainMenu: 'mainMenu',
  submenuTransition: 'submenuTransitions',
  chatReply: 'chatReplies',
  confirmation: 'confirmations',
  error: 'errors'
};

function adminTargeting(admin) {
  const t = (admin && admin.defaults && admin.defaults.targeting) || {};
  return {
    mainMenu: t.mainMenu !== false,
    submenuTransition: t.submenuTransition === true,
    chatReply: t.chatReply !== false,
    confirmation: t.confirmation === true,
    error: t.error === true
  };
}

function adaptiveDelay(textLength) {
  const perChar = Math.max(0, Number(config.typingAdaptivePerCharMs) || 15);
  const min = Math.max(0, Number(config.typingAdaptiveMinMs) || 200);
  const max = Math.max(min, Number(config.typingAdaptiveMaxMs) || 2500);
  return Math.min(max, Math.max(min, Math.floor((Number(textLength) || 0) * perChar)));
}

/**
 * Resolve whether a typing indicator should show for an outgoing message.
 * @param {object} opts { user, messageType, textLength }
 * @returns {{ show: boolean, delayMs: number, presenceType: 'composing'|'recording' }}
 */
export function shouldShowTyping(opts = {}) {
  const messageType = typeof opts.messageType === 'string' && opts.messageType ? opts.messageType : 'chatReply';
  const none = { show: false, delayMs: 0, presenceType: 'composing' };
  let admin = null;
  try {
    admin = getTypingSettings();
  } catch { /* fallbacks below */ }
  const globalEnabled = admin ? admin.globalEnabled !== false : config.typingAnimationEnabled !== false;
  if (!globalEnabled) return none;
  if (messageType === 'silent') return none;

  const allowOverride = admin ? admin.allowUserOverride !== false : config.typingAllowUserOverride !== false;
  const rawUserTyping = opts.user?.preferences?.typing;
  let effective;
  if (allowOverride && rawUserTyping && typeof rawUserTyping === 'object') {
    effective = sanitizeUserTyping(rawUserTyping);
  } else if (admin) {
    const d = admin.defaults || {};
    effective = {
      mode: d.mode || 'adaptive',
      delayMs: Number(d.delayMs) || 600,
      typingType: d.typingType || 'composing',
      targeting: adminTargeting(admin),
      _adminKeys: true
    };
  } else {
    effective = {
      mode: 'adaptive',
      delayMs: 600,
      typingType: 'composing',
      targeting: { mainMenu: true, submenuTransition: true, chatReply: true, confirmation: false, error: false },
      _adminKeys: true
    };
  }

  const targeting = effective.targeting || {};
  const flagKey = effective._adminKeys
    ? messageType
    : (USER_KEY_BY_TYPE[messageType] || 'chatReplies');
  if (targeting[flagKey] === false) return { ...none, presenceType: effective.typingType === 'recording' ? 'recording' : 'composing' };

  const presenceType = effective.typingType === 'recording' ? 'recording' : 'composing';
  switch (effective.mode) {
    case 'off':
      return { show: false, delayMs: 0, presenceType };
    case 'instant':
      return { show: true, delayMs: 0, presenceType };
    case 'adaptive':
      return { show: true, delayMs: adaptiveDelay(opts.textLength), presenceType };
    case 'on':
    default:
      return { show: true, delayMs: Math.min(3000, Math.max(0, Math.floor(Number(effective.delayMs) || 600))), presenceType };
  }
}

/**
 * Resolve read-receipt behavior for a user.
 * @returns {{ enabled: boolean }}
 */
export function shouldMarkRead(user) {
  let admin = null;
  try {
    admin = getTypingSettings();
  } catch { /* fallbacks below */ }
  const globalGate = admin ? admin.readReceiptsEnabled !== false : config.typingReadReceiptsEnabled !== false;
  if (!globalGate) return { enabled: false };
  const globalEnabled = admin ? admin.globalEnabled !== false : config.typingAnimationEnabled !== false;
  if (!globalEnabled) return { enabled: false };
  const allowOverride = admin ? admin.allowUserOverride !== false : config.typingAllowUserOverride !== false;
  const rawUserTyping = user?.preferences?.typing;
  if (allowOverride && rawUserTyping && typeof rawUserTyping === 'object' && typeof rawUserTyping.readReceipts === 'boolean') {
    return { enabled: rawUserTyping.readReceipts };
  }
  if (admin && typeof admin.defaults?.readReceipts === 'boolean') return { enabled: admin.defaults.readReceipts };
  return { enabled: true };
}
