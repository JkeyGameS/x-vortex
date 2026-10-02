import { t } from '../services/localeService.js';
import { toSmallCaps } from './smallCaps.js';
import { getSettings as getChatSettings, getIgnoreList } from '../services/chatSettingsService.js';
import { getTypingSettings } from '../services/typingSettingsService.js';
import { hasPermission } from '../services/rolesService.js';
import settingsService from '../services/settingsService.js';
import { readBotNotifyToggles } from '../config/notificationToggles.js';
import sessionManager from './sessionManager.js';
import { getEntriesPage, getCurrentVersion } from '../services/changelogService.js';
import { getPendingDrafts } from '../services/changelogDraftService.js';
import { changelogOptions, formatEntryHeading } from './changelogFormat.js';
import * as messageSettings from '../services/messageSettingsService.js';
import { MESSAGE_MODES } from '../services/messageSettingsService.js';
import * as customCommandStore from '../services/customCommandService.js';

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
  },
  // Bot lifecycle notification toggles (admin menu).
  botNotifsAllState: (user, language) => {
    const n = readBotNotifs();
    return ': ' + toSmallCaps(t(language || 'en', n.enabled !== false ? 'common.onFlag' : 'common.offFlag'));
  },
  botNotifs_onStartupState: (user, language) => botNotifsSuffix('onStartup', language),
  botNotifs_onShutdownState: (user, language) => botNotifsSuffix('onShutdown', language),
  botNotifs_onCrashState: (user, language) => botNotifsSuffix('onCrash', language),
  botNotifs_onNewUserState: (user, language) => botNotifsSuffix('onNewUser', language),
  botNotifs_onOnboardingCompleteState: (user, language) => botNotifsSuffix('onOnboardingComplete', language),
  codeChangeState: (user, language) => botNotifsSuffix('onCodeChange', language)
};

/**
 * Bot notification state is read from the canonical toggle table so the menu
 * suffix and the senders can never disagree about what is on.
 */
function readBotNotifs() {
  return readBotNotifyToggles();
}

function botNotifsSuffix(key, language) {
  const n = readBotNotifs();
  const on = n.enabled && n[key];
  return ': ' + toSmallCaps(t(language || 'en', on ? 'common.onFlag' : 'common.offFlag'));
}

// ---------------------------------------------------------------------------
// Message display modes. Suffixes show which mode is currently selected, or a
// lock marker when the admin has disabled user overrides.
// ---------------------------------------------------------------------------

const MODE_LABEL_KEYS = {
  edit: 'menu.message_display.edit',
  send_new: 'menu.message_display.send_new',
  delete_send: 'menu.message_display.delete_send',
  hybrid: 'menu.message_display.hybrid'
};

function currentUserMode(user) {
  const set = messageSettings.getSettings();
  const pref = user?.preferences?.messageDisplayMode;
  if (set.allowUserOverride && pref && MESSAGE_MODES.includes(pref)) return pref;
  if (set.defaultMode && set.defaultMode !== 'hybrid') return set.defaultMode;
  return set.defaultMode || 'hybrid';
}

function modeSuffix(mode, language) {
  return ': *' + toSmallCaps(t(language || 'en', MODE_LABEL_KEYS[mode] || MODE_LABEL_KEYS.hybrid)) + '*';
}

for (const _mode of ['edit', 'send_new', 'delete_send', 'hybrid']) {
  dynamicSuffixResolvers['messageMode_' + _mode + 'State'] = (user, language) => {
    const set = messageSettings.getSettings();
    // Locked by admin -> show the lock, never the selection.
    if (!set.allowUserOverride) return ' 🔒';
    if (!set.userOverrideRange.includes(_mode)) return ' 🔒';
    return currentUserMode(user) === _mode ? modeSuffix(_mode, language) : '';
  };
}

dynamicSuffixResolvers.messageDisplayAdmin_default_modeState = (user, language) =>
  modeSuffix(messageSettings.getSettings().defaultMode, language);

dynamicSuffixResolvers.messageDisplayAdmin_user_overrideState = (user, language) =>
  ': ' + toSmallCaps(t(language || 'en', messageSettings.getSettings().allowUserOverride ? 'common.onFlag' : 'common.offFlag'));

dynamicSuffixResolvers.messageDisplayAdmin_per_menu_overrideState = (user, language) =>
  ': ' + toSmallCaps(t(language || 'en', messageSettings.getSettings().perMenuOverrideEnabled ? 'common.onFlag' : 'common.offFlag'));

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
// lines; progress resolvers return a prefix string ('✅'/'⬜'/' '').
export const cardResolvers = {};
export const bodyResolvers = {};
export const dashboardResolvers = {};
export const summaryResolvers = {};
export const progressResolvers = {};

// Changelog Manager summary: current version plus how many drafts await review.
registerSummaryResolver('changelogManagerSummary', () => {
  const version = getCurrentVersion();
  const pending = getPendingDrafts().length;
  return [
    { static: toSmallCaps(t('en', 'menu.changelog_manager.current_version')) + ': *', dynamic: version + '*' },
    { static: toSmallCaps(t('en', 'menu.changelog_manager.pending_drafts')) + ': *', dynamic: String(pending) + '*' }
  ];
});

// Message display summaries (registered eagerly: no cycle risk, the service
// only reads/writes data/messageSettings.json).
registerSummaryResolver('customCommandsSummary', (user, language) => {
  // Read lazily to avoid pulling the store into the renderer's import graph.
  const svc = customCommandStore;
  if (!svc) return [];
  const all = svc.getAllCustomCommands();
  const enabled = all.filter((c) => c.enabled).length;
  return [
    toSmallCaps(t(language || 'en', 'menu.custom_commands.total')) + ': ' + all.length +
    ' · ' + toSmallCaps(t(language || 'en', 'menu.custom_commands.enabled')) + ': ' + enabled +
    ' · ' + toSmallCaps(t(language || 'en', 'menu.custom_commands.disabled')) + ': ' + (all.length - enabled)
  ];
});

registerSummaryResolver('messageDisplaySummary', (user, language) => {
  const set = messageSettings.getSettings();
  const lines = [];
  lines.push(toSmallCaps(t(language || 'en', 'menu.message_display.current')) + ': *' + toSmallCaps(t(language || 'en', MODE_LABEL_KEYS[currentUserMode(user)] || MODE_LABEL_KEYS.hybrid)) + '*');
  if (!set.allowUserOverride) {
    lines.push('🔒 ' + toSmallCaps(t(language || 'en', 'menu.message_display.lockedByAdmin')));
  }
  return lines;
});

registerSummaryResolver('messageDisplayAdminSummary', (user, language) => {
  const set = messageSettings.getSettings();
  return [
    toSmallCaps(t(language || 'en', 'menu.message_display_admin.defaultModeLabel')) + ': *' + toSmallCaps(t(language || 'en', MODE_LABEL_KEYS[set.defaultMode] || MODE_LABEL_KEYS.hybrid)) + '*',
    toSmallCaps(t(language || 'en', 'menu.message_display_admin.userOverrideLabel')) + ': ' + toSmallCaps(t(language || 'en', set.allowUserOverride ? 'common.onFlag' : 'common.offFlag')),
    toSmallCaps(t(language || 'en', 'menu.message_display_admin.perMenuOverrideLabel')) + ': ' + toSmallCaps(t(language || 'en', set.perMenuOverrideEnabled ? 'common.onFlag' : 'common.offFlag'))
  ];
});

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

// ---------------------------------------------------------------------------
// Changelog body (Info -> Version History).
//
// A bodyResolver menu owns its whole layout (menuRenderer returns early), so
// this renders the heading line, current version, one page of entries, the
// paginated option rows and the back row. Static text is small-capped;
// version numbers, dates and change text are dynamic and stay as-is.
// ---------------------------------------------------------------------------

registerBodyResolver('changelogBody', async (user, language, ctx) => {
  const session = ctx?.sender ? sessionManager.getSession(ctx.sender, ctx.chatId || ctx.sender) || {} : {};
  const page = getEntriesPage(session.changelogPage || 1, 2);
  const lang = language || 'en';
  const L = (key) => toSmallCaps(t(lang, key));
  const lines = [];

  lines.push({ static: L('menu.info.version_history.currentVersion') + ': *', dynamic: `${getCurrentVersion()}*` });
  lines.push('');

  if (!page.entries.length) {
    lines.push(L('menu.info.version_history.empty'));
  } else {
    for (const entry of page.entries) {
      // Dynamic: emoji + version + date are not small-capped.
      lines.push({ static: '', dynamic: formatEntryHeading(entry) });
      for (const change of entry.changes || []) {
        lines.push({ static: '', dynamic: '• ' + toSmallCaps(change) });
      }
      lines.push('');
    }
  }

  for (const opt of changelogOptions(page)) {
    lines.push({ static: '', dynamic: `${opt.number}. ${opt.emoji} ${toSmallCaps(t(lang, opt.labelKey))}` });
  }

  lines.push('');
  lines.push({ static: '', dynamic: `0. ${toSmallCaps(t(lang, 'common.back'))}` });
  lines.push('');
  lines.push({ static: '', dynamic: `_${L('menu.replyPrompt')}_` });
  return lines;
});
