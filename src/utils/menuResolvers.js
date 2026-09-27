import { t } from '../services/localeService.js';
import { toSmallCaps } from './smallCaps.js';
import { getSettings as getChatSettings, getIgnoreList } from '../services/chatSettingsService.js';
import { getTypingSettings } from '../services/typingSettingsService.js';
import { hasPermission } from '../services/rolesService.js';
import settingsService from '../services/settingsService.js';

/**
 * Suffix resolvers for dynamic option labels: (user, language) => string.
 * Registered by name; referenced from definitions via option.dynamicSuffix.
 * Values are pre-formatted (small caps applied here, mirroring legacy code).
 */
export const dynamicSuffixResolvers = {
  notificationsState: (user, language) => {
    const on = user?.preferences?.notifications ? true : false;
    return ': ' + toSmallCaps(t(language || 'en', on ? 'common.onFlag' : 'common.offFlag'));
  },
  announcementsState: (user, language) => {
    const on = user?.preferences?.announcements ? true : false;
    return ': ' + toSmallCaps(t(language || 'en', on ? 'common.onFlag' : 'common.offFlag'));
  }
};

export function registerSuffixResolver(name, fn) {
  if (typeof name !== 'string' || !name || typeof fn !== 'function') {
    throw new Error('registerSuffixResolver requires (name, function)');
  }
  dynamicSuffixResolvers[name] = fn;
  return true;
}

// ---------------------------------------------------------------------------
// Chat Settings value text. Verbatim copy of the formatting logic in
// adminCommand.chatSettingsValueText (kept local to avoid an import cycle:
// adminCommand → menuSender → menuRenderer → menuResolvers → adminCommand).
// Parity-tested in Phase 5 (p11test).
// ---------------------------------------------------------------------------

function settingsOnOff(language, value) {
  return toSmallCaps(t(language, value === true ? 'admin.systemSettings.enabled' : 'admin.systemSettings.disabled'));
}

export function chatSettingsValue(language, key) {
  const lang = language || 'en';
  let s = {};
  let typing = {};
  try {
    s = getChatSettings() || {};
  } catch { /* defaults below */ }
  try {
    typing = getTypingSettings() || {};
  } catch { /* defaults below */ }
  const value = key.startsWith('typing')
    ? { typingGlobal: typing.globalEnabled, typingOverride: typing.allowUserOverride, typingReceipts: typing.readReceiptsEnabled, typingTargeting: typing.defaults?.targeting, typingDefaultType: typing.defaults?.typingType }[key]
    : s[key];
  switch (key) {
    case 'chatEnabled':
    case 'autoTranslate':
    case 'contextAwareness':
    case 'dryRunMode':
    case 'logChatMatches':
    case 'contextAwarenessEnabled':
    case 'replyStylePersonalization':
    case 'followUps':
    case 'rateLimitEnabled':
    case 'typingGlobal':
    case 'typingOverride':
    case 'typingReceipts':
      return settingsOnOff(lang, value === true);
    case 'rateLimitMaxReplies':
      return `${value}/window`;
    case 'rateLimitWindowMs':
      return `${Math.round((Number(value) || 60000) / 1000)}s`;
    case 'rateLimitBehavior':
      return toSmallCaps(t(lang, `chatSettings.rateLimitBehavior_${value === 'polite' ? 'polite' : 'silent'}`));
    case 'typingTargeting': {
      const n = value && typeof value === 'object'
        ? ['mainMenu', 'submenuTransition', 'chatReply', 'confirmation', 'error'].filter((k) => value[k] === true).length
        : 0;
      return `${n}/5`;
    }
    case 'typingDefaultType':
      return toSmallCaps(t(lang, `typing.type_${value === 'recording' ? 'recording' : 'composing'}`));
    case 'followUpChance':
      return `${Math.round((Number(value) || 0) * 100)}%`;
    case 'contextExpiryMs':
      return `${Math.round((Number(value) || 120000) / 1000)}s`;
    case 'fuzzyMatching':
    case 'fallbackBehavior':
    case 'priorityMode':
      return toSmallCaps(t(lang, `chatSettings.${key}Value_${value}`));
    case 'defaultCooldownSeconds':
      return value > 0 ? `${value}s` : toSmallCaps(t(lang, 'chatSettings.valueNone'));
    case 'maxRepliesPerMinute':
      return value > 0 ? `${value}/min` : toSmallCaps(t(lang, 'chatSettings.valueUnlimited'));
    case 'languageFilter': {
      const all = ['en', 'fr', 'de', 'es', 'ar'];
      const list = Array.isArray(value) ? value : all;
      return list.length >= all.length ? toSmallCaps(t(lang, 'chatSettings.valueAll')) : list.join(',');
    }
    case 'chatReplyDelayMs':
      return value == null ? toSmallCaps(t(lang, 'chatSettings.valueGlobal')) : `${value}ms`;
    default:
      return String(value ?? '');
  }
}

function settingsSuffix(key) {
  return (user, language) => ': ' + chatSettingsValue(language, key);
}

Object.assign(dynamicSuffixResolvers, {
  chatEnabledState: settingsSuffix('chatEnabled'),
  fuzzyModeState: settingsSuffix('fuzzyMatching'),
  cooldownState: settingsSuffix('defaultCooldownSeconds'),
  fallbackState: settingsSuffix('fallbackBehavior'),
  priorityState: settingsSuffix('priorityMode'),
  autoTranslateState: settingsSuffix('autoTranslate'),
  contextAwarenessState: settingsSuffix('contextAwareness'),
  maxRepliesState: settingsSuffix('maxRepliesPerMinute'),
  dryRunState: settingsSuffix('dryRunMode'),
  logMatchesState: settingsSuffix('logChatMatches'),
  languageFilterState: settingsSuffix('languageFilter'),
  delayOverrideState: settingsSuffix('chatReplyDelayMs'),
  antiRepetitionState: settingsSuffix('antiRepetition'),
  weightedRandomState: settingsSuffix('weightedRandom'),
  contextAwarenessEnabledState: settingsSuffix('contextAwarenessEnabled'),
  contextExpiryState: settingsSuffix('contextExpiryMs'),
  toneDetectionState: settingsSuffix('toneDetection'),
  timeAwarenessState: settingsSuffix('timeAwareness'),
  replyStyleState: settingsSuffix('replyStylePersonalization'),
  followUpsState: settingsSuffix('followUps'),
  followUpChanceState: settingsSuffix('followUpChance'),
  abTestingState: settingsSuffix('abTesting'),
  contextBoostState: settingsSuffix('contextPriorityBoost'),
  rateLimitState: settingsSuffix('rateLimitEnabled'),
  rateLimitMaxState: settingsSuffix('rateLimitMaxReplies'),
  rateLimitWindowState: settingsSuffix('rateLimitWindowMs'),
  snippetDepthState: settingsSuffix('snippetMaxDepth'),
  typingAnimationState: settingsSuffix('typingGlobal'),
  typingTargetingState: settingsSuffix('typingTargeting'),
  typingOverrideState: settingsSuffix('typingOverride'),
  typingReceiptsState: settingsSuffix('typingReceipts'),
  typingDefaultTypeState: settingsSuffix('typingDefaultType'),
  ignoreListCountState: (user, language) => {
    let n = 0;
    try {
      n = getIgnoreList().length;
    } catch { /* count stays 0 */ }
    return ` (${n})`;
  },
  // Permission lock suffix for admin options carrying opt.perm. Mirrors the
  // legacy builder: no perm → no suffix; lacking perm → ' 🔒'.
  permLock: (user, language, opt) => lockSuffix(user, opt),
  // Quick Actions combined state+lock rows (legacy appends lock after state).
  quickMaintenanceState: (user, language, opt) => {
    let on = false;
    try {
      on = settingsService.getSettings().maintenanceMode === true;
    } catch { /* default off */ }
    return ': ' + toSmallCaps(t(language || 'en', on ? 'admin.systemSettings.statusOn' : 'admin.systemSettings.statusOff')) + lockSuffix(user, opt);
  },
  quickNotifsState: (user, language, opt) => {
    let on = true;
    try {
      on = settingsService.getSettings().adminNotificationsEnabled !== false;
    } catch { /* default on */ }
    return ': ' + toSmallCaps(t(language || 'en', on ? 'admin.systemSettings.statusOn' : 'admin.systemSettings.statusOff')) + lockSuffix(user, opt);
  }
});

function lockSuffix(user, opt) {
  try {
    if (!opt || !opt.perm) return '';
    const jid = user?.jid || user?.sender;
    if (!jid) return '';
    return hasPermission(jid, opt.perm) ? '' : ' 🔒';
  } catch {
    return '';
  }
}

// Card/body/dashboard/summary/progress resolvers are registered by their
// owning handlers at load time (avoids import cycles: the renderer looks
// them up by name at render time). Line resolvers return arrays of verbatim
// lines; progress resolvers return a prefix string ('✅'/'⬜'/'').
export const cardResolvers = {};
export const bodyResolvers = {};
export const dashboardResolvers = {};
export const summaryResolvers = {};
export const progressResolvers = {};

export function registerCardResolver(name, fn) {
  if (typeof name !== 'string' || !name || typeof fn !== 'function') {
    throw new Error('registerCardResolver requires (name, function)');
  }
  cardResolvers[name] = fn;
  return true;
}

export function registerBodyResolver(name, fn) {
  if (typeof name !== 'string' || !name || typeof fn !== 'function') {
    throw new Error('registerBodyResolver requires (name, function)');
  }
  bodyResolvers[name] = fn;
  return true;
}

export function registerDashboardResolver(name, fn) {
  if (typeof name !== 'string' || !name || typeof fn !== 'function') {
    throw new Error('registerDashboardResolver requires (name, function)');
  }
  dashboardResolvers[name] = fn;
  return true;
}

export function registerSummaryResolver(name, fn) {
  if (typeof name !== 'string' || !name || typeof fn !== 'function') {
    throw new Error('registerSummaryResolver requires (name, function)');
  }
  summaryResolvers[name] = fn;
  return true;
}

export function registerProgressResolver(name, fn) {
  if (typeof name !== 'string' || !name || typeof fn !== 'function') {
    throw new Error('registerProgressResolver requires (name, function)');
  }
  progressResolvers[name] = fn;
  return true;
}
