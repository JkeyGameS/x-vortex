import { getUserByJidSync } from '../services/userService.js';
import { handleStatsReply } from '../handlers/statsCommand.js';
import { handleTutorialReply } from '../handlers/tutorialCommand.js';
import { handleInfoReply } from '../handlers/infoCommand.js';
import { handleFeedbackReply } from '../handlers/feedbackCommand.js';
import { handleFaqMain } from '../handlers/faqCommand.js';
import { handleSnippetImpex } from '../handlers/chatCommand.js';
import config from '../config/config.js';
import sessionManager from '../utils/sessionManager.js';
import settingsService from '../services/settingsService.js';
import { sendText } from '../services/messageService.js';
import { toSmallCaps } from '../utils/smallCaps.js';
import { t } from '../services/localeService.js';
import {
  dispatchProfileAction,
  sendLanguageSelection,
  togglePreference,
  sendTypingMenu
} from '../handlers/profileCommand.js';
import {
  toggleChatSystemSetting,
  toggleTypingAdminSetting,
  showChatSettingsFuzzy,
  showChatSettingsCooldown,
  showChatSettingsFallback,
  showChatSettingsPriority,
  showChatSettingsMaxReplies,
  showChatSettingsIgnoreList,
  showChatSettingsLanguageFilter,
  showChatSettingsDelayOverride,
  showChatSettingsContextExpiry,
  showContextRegistry,
  showToneWordsMenu,
  showFollowUpChanceMenu,
  showContextBoostMenu,
  showRateLimitMaxMenu,
  showRateLimitWindowMenu,
  showSnippetDepthMenu,
  showTypingTargetingMenu,
  showTypingDefaultTypeMenu,
  sendCombinedExport,
  promptCombinedImport,
  sendAnalyticsExport,
  promptAnalyticsImport,
  sendChatFaqMenu,
  sendChatSettingsPanel,
  sendChatFaqStatsPanel,
  handleAdminReply,
  handleQuickActionsReply,
  handleBroadcastReply,
  handleSystemSettingsReply,
  handleBackupRestoreReply,
  handleScheduledTasksReply,
  handleAdminSearchReply,
  handleAnalyticsReply,
  handleGroupedAdminReply,
  handleLogsReply
} from '../handlers/adminCommand.js';
import { handleUserManagementReply } from '../handlers/userManagementCommand.js';
import {
  sendChatPanel,
  sendAddRuleMenu,
  showChatViewMenu,
  showChatManageMenu,
  showStructuredSearchPrompt,
  showChatImportExportMenu,
  showChatStats,
  handleSnippetsMenu,
  sendSnippetsMenu,
  showUnmatchedList,
  showCleanupSuggestions
} from '../handlers/chatCommand.js';
import { sendFaqMainPanel, handleFaqAddMenu, handleFaqViewMenu, handleFaqManageMenu, handleFaqImportExportMenu, handleFaqStatsPanel } from '../handlers/faqCommand.js';

function languageOf(sender) {
  const user = getUserByJidSync(sender);
  return user?.language || config.defaultLanguage;
}

const dispatch = (menuConfigAction) => async (context) => {
  const language = languageOf(context.sender);
  return dispatchProfileAction(context, language, menuConfigAction);
};

async function preferencesInvalidMax(language, sender) {
  try {
    const { materializeDefinition } = await import('../utils/menuRenderer.js');
    const { getMenu } = await import('../config/menus/registry.js');
    const user = getUserByJidSync(sender);
    const def = materializeDefinition(getMenu('preferences'), user, language);
    return (def?.options || []).length;
  } catch {
    return 5;
  }
}

export const profileCustomHandlers = {
  // Profile view options (menuConfig actions, feature gate included).
  dispatch_profile_edit: dispatch('profile.edit'),
  dispatch_profile_stats: dispatch('profile.stats'),
  dispatch_profile_preferences: dispatch('profile.preferences'),
  dispatch_profile_copyid: dispatch('profile.copyid'),
  // Edit Profile field options.
  dispatch_edit_name: dispatch('profile.edit.name'),
  dispatch_edit_username: dispatch('profile.edit.username'),
  dispatch_edit_bio: dispatch('profile.edit.bio'),
  dispatch_edit_timezone: dispatch('profile.edit.timezone'),
  dispatch_edit_picture: dispatch('profile.edit.picture'),
  dispatch_edit_country: dispatch('profile.edit.country'),
  dispatch_edit_birthday: dispatch('profile.edit.birthday'),
  // Preferences options.
  pref_change_language: async (context) => sendLanguageSelection(context, languageOf(context.sender)),
  pref_toggle_notifications: async (context) => togglePreference(context, languageOf(context.sender), 'notifications'),
  pref_toggle_announcements: async (context) => togglePreference(context, languageOf(context.sender), 'announcements'),
  pref_typing_menu: async (context) => {
    const session = sessionManager.getSession(context.sender, context.chatId || context.sender) || {};
    const ret = session.currentMenu === 'pref_advanced' ? 'pref_advanced' : 'preferences';
    return sendTypingMenu(context, languageOf(context.sender), ret);
  },
  pref_dispatch_message_settings: dispatch('profile.messageSettings'),
  // Legacy: available-but-unhandled preferences only show an invalid message.
  pref_unhandled_feature: async (context) => {
    const language = languageOf(context.sender);
    const max = await preferencesInvalidMax(language, context.sender);
    await sendText(context.sock, context.sender, toSmallCaps(t(language, 'common.invalidChoiceMinMax', { min: 0, max })));
  }
};

// ---------------------------------------------------------------------------
// Chat & FAQ cluster (Phase 5). Thin delegates to existing senders/flows so
// legacy behavior (submenus, toggles, imports) is preserved exactly.
// ---------------------------------------------------------------------------

const toggleSetting = (key) => async (context) => toggleChatSystemSetting(context, key);
const toggleTyping = (key) => async (context) => toggleTypingAdminSetting(context, key);

export const chatFaqCustomHandlers = {
  // Hub options (unmigrated targets).
  hub_faq: async (context) => sendFaqMainPanel(context),
  hub_stats: async (context) => sendChatFaqStatsPanel(context),
  hub_unmatched: async (context) => showUnmatchedList(context),
  hub_cleanup: async (context) => showCleanupSuggestions(context),
  // Chat Responses options (all unmigrated builders).
  resp_add: async (context) => sendAddRuleMenu(context),
  resp_view: async (context) => showChatViewMenu(context),
  resp_manage: async (context) => showChatManageMenu(context),
  resp_search: async (context) => showStructuredSearchPrompt(context),
  resp_impexport: async (context) => showChatImportExportMenu(context),
  resp_stats: async (context) => showChatStats(context),
  // Chat Settings toggles (chat-settings service).
  cs_toggle_chat_enabled: toggleSetting('chatEnabled'),
  cs_toggle_auto_translate: toggleSetting('autoTranslate'),
  cs_toggle_context_awareness: toggleSetting('contextAwareness'),
  cs_toggle_dry_run: toggleSetting('dryRunMode'),
  cs_toggle_log_matches: toggleSetting('logChatMatches'),
  cs_toggle_anti_repetition: toggleSetting('antiRepetition'),
  cs_toggle_weighted_random: toggleSetting('weightedRandom'),
  cs_toggle_context_awareness_enabled: toggleSetting('contextAwarenessEnabled'),
  cs_toggle_tone_detection: toggleSetting('toneDetection'),
  cs_toggle_time_awareness: toggleSetting('timeAwareness'),
  cs_toggle_reply_style: toggleSetting('replyStylePersonalization'),
  cs_toggle_follow_ups: toggleSetting('followUps'),
  cs_toggle_ab_testing: toggleSetting('abTesting'),
  cs_toggle_rate_limit: toggleSetting('rateLimitEnabled'),
  // Chat Settings toggles (typing service).
  cs_toggle_typing_animation: toggleTyping('globalEnabled'),
  cs_toggle_typing_override: toggleTyping('allowUserOverride'),
  cs_toggle_typing_receipts: toggleTyping('readReceiptsEnabled'),
  // Chat Settings submenu openers (existing unmigrated submenus).
  cs_open_fuzzy: async (context) => showChatSettingsFuzzy(context),
  cs_open_cooldown: async (context) => showChatSettingsCooldown(context),
  cs_open_fallback: async (context) => showChatSettingsFallback(context),
  cs_open_priority: async (context) => showChatSettingsPriority(context),
  cs_open_max_replies: async (context) => showChatSettingsMaxReplies(context),
  cs_open_ignore_list: async (context) => showChatSettingsIgnoreList(context),
  cs_open_language_filter: async (context) => showChatSettingsLanguageFilter(context),
  cs_open_delay_override: async (context) => showChatSettingsDelayOverride(context),
  cs_open_context_expiry: async (context) => showChatSettingsContextExpiry(context),
  cs_open_context_registry: async (context) => showContextRegistry(context),
  cs_open_tone_words: async (context) => showToneWordsMenu(context),
  cs_open_followup_chance: async (context) => showFollowUpChanceMenu(context),
  cs_open_context_boost: async (context) => showContextBoostMenu(context),
  cs_open_rate_limit_max: async (context) => showRateLimitMaxMenu(context),
  cs_open_rate_limit_window: async (context) => showRateLimitWindowMenu(context),
  cs_open_snippet_depth: async (context) => showSnippetDepthMenu(context),
  cs_open_typing_targeting: async (context) => showTypingTargetingMenu(context),
  cs_open_typing_default_type: async (context) => showTypingDefaultTypeMenu(context),
  // Snippets options (existing flows).
  snippet_list: async (context) => handleSnippetsMenu(context, '1'),
  snippet_add: async (context) => handleSnippetsMenu(context, '2'),
  snippet_edit: async (context) => handleSnippetsMenu(context, '3'),
  snippet_delete: async (context) => handleSnippetsMenu(context, '4'),
  snippet_translate: async (context) => handleSnippetsMenu(context, '5'),
  snippet_impexport: async (context) => handleSnippetsMenu(context, '6'),
  // Import/export options (existing flows).
  ie_export_all: async (context) => sendCombinedExport(context, 'all'),
  ie_import_all: async (context) => promptCombinedImport(context, 'all'),
  ie_export_chat: async (context) => sendCombinedExport(context, 'chat'),
  ie_import_chat: async (context) => promptCombinedImport(context, 'chat'),
  ie_export_faq: async (context) => sendCombinedExport(context, 'faq'),
  ie_import_faq: async (context) => promptCombinedImport(context, 'faq'),
  ie_export_analytics: async (context) => sendAnalyticsExport(context),
  ie_import_analytics: async (context) => promptAnalyticsImport(context)
};

// FAQ submenu options. These menus are currently intercepted by a dedicated
// legacy branch in index.js (which dispatches the raw input straight to the
// FAQ handler), so these entries are not on the live path today. They are
// registered anyway so every `custom:` name a definition declares actually
// resolves — otherwise removing that legacy branch would silently break the
// whole FAQ submenu. The option numbers match the legacy handler's cases 1..N.
const faqSub = (fn, input) => async (context) => fn(context, input);

Object.assign(chatFaqCustomHandlers, {
  // faq_add
  faq_add_quick: faqSub(handleFaqAddMenu, '1'),
  faq_add_advanced: faqSub(handleFaqAddMenu, '2'),
  faq_add_template: faqSub(handleFaqAddMenu, '3'),
  faq_add_bulk: faqSub(handleFaqAddMenu, '4'),
  faq_add_unmatched: faqSub(handleFaqAddMenu, '5'),
  faq_add_duplicate: faqSub(handleFaqAddMenu, '6'),
  faq_add_resume: faqSub(handleFaqAddMenu, '7'),
  faq_add_example: faqSub(handleFaqAddMenu, '8'),
  faq_add_multilang: faqSub(handleFaqAddMenu, '9'),
  // faq_view
  faq_view_all: faqSub(handleFaqViewMenu, '1'),
  faq_view_lang: faqSub(handleFaqViewMenu, '2'),
  faq_view_category: faqSub(handleFaqViewMenu, '3'),
  faq_view_enabled: faqSub(handleFaqViewMenu, '4'),
  faq_view_disabled: faqSub(handleFaqViewMenu, '5'),
  faq_view_drafts: faqSub(handleFaqViewMenu, '6'),
  faq_view_recent: faqSub(handleFaqViewMenu, '7'),
  faq_view_favorites: faqSub(handleFaqViewMenu, '8'),
  // faq_manage
  faq_manage_edit: faqSub(handleFaqManageMenu, '1'),
  faq_manage_delete: faqSub(handleFaqManageMenu, '2'),
  faq_manage_toggle: faqSub(handleFaqManageMenu, '3'),
  faq_manage_duplicate: faqSub(handleFaqManageMenu, '4'),
  faq_manage_enable_all: faqSub(handleFaqManageMenu, '5'),
  faq_manage_disable_all: faqSub(handleFaqManageMenu, '6'),
  faq_manage_bulk: faqSub(handleFaqManageMenu, '7'),
  // faq_import_export
  faq_ie_export: faqSub(handleFaqImportExportMenu, '1'),
  faq_ie_import: faqSub(handleFaqImportExportMenu, '2'),
  faq_ie_csv: faqSub(handleFaqImportExportMenu, '3'),
  faq_ie_snapshots: faqSub(handleFaqImportExportMenu, '4'),
  // faq_stats
  faq_stats_dashboard: faqSub(handleFaqStatsPanel, '1')
});

// ---------------------------------------------------------------------------
// Admin cluster (Phase 6). Re-dispatch through legacy reply handlers so
// permission gates, locks, confirmations, and sub-flows behave identically.
// ---------------------------------------------------------------------------

const redispatch = (fn, input) => async (context) => fn(context, input);

export const adminCustomHandlers = {
  // Admin Panel options (legacy lock + perm gates preserved in handleAdminReply).
  admin_opt_quick: redispatch(handleAdminReply, '1'),
  admin_opt_stats: redispatch(handleAdminReply, '2'),
  admin_opt_broadcast: redispatch(handleAdminReply, '3'),
  admin_opt_users: redispatch(handleAdminReply, '4'),
  admin_opt_system: redispatch(handleAdminReply, '5'),
  admin_opt_chatfaq: redispatch(handleAdminReply, '6'),
  admin_opt_backup: redispatch(handleAdminReply, '7'),
  admin_opt_feedback: redispatch(handleAdminReply, '8'),
  admin_opt_test: redispatch(handleAdminReply, '9'),
  admin_opt_analytics: redispatch(handleAdminReply, '10'),
  admin_opt_search: redispatch(handleAdminReply, '11'),
  admin_opt_scheduled: redispatch(handleAdminReply, '12'),
  admin_opt_help: redispatch(handleAdminReply, '13'),
  // Quick Actions options.
  quick_broadcast: redispatch(handleQuickActionsReply, '1'),
  quick_maintenance: redispatch(handleQuickActionsReply, '2'),
  quick_purge_test: redispatch(handleQuickActionsReply, '3'),
  quick_admin_notifs: redispatch(handleQuickActionsReply, '4'),
  quick_emergency: redispatch(handleQuickActionsReply, '5'),
  // Broadcast options.
  broadcast_send_now: redispatch(handleBroadcastReply, '1'),
  broadcast_schedule: redispatch(handleBroadcastReply, '2'),
  broadcast_templates: redispatch(handleBroadcastReply, '3'),
  // User Management options.
  users_search: redispatch(handleUserManagementReply, '1'),
  users_list: redispatch(handleUserManagementReply, '2'),
  users_delete: redispatch(handleUserManagementReply, '3'),
  users_block: redispatch(handleUserManagementReply, '4'),
  users_unblock: redispatch(handleUserManagementReply, '5'),
  users_list_blocked: redispatch(handleUserManagementReply, '6'),
  users_purge_test: redispatch(handleUserManagementReply, '7'),
  users_advanced: redispatch(handleUserManagementReply, '8'),
  users_bulk: redispatch(handleUserManagementReply, '9'),
  users_segments: redispatch(handleUserManagementReply, '10'),
  // System Settings options.
  sys_general: redispatch(handleSystemSettingsReply, '1'),
  sys_admin_access: redispatch(handleSystemSettingsReply, '2'),
  sys_feature_flags: redispatch(handleSystemSettingsReply, '3'),
  sys_notifications: redispatch(handleSystemSettingsReply, '4'),
  sys_conversation: redispatch(handleSystemSettingsReply, '5'),
  sys_updates: redispatch(handleSystemSettingsReply, '6'),
  sys_data: redispatch(handleSystemSettingsReply, '7'),
  sys_logs: redispatch(handleSystemSettingsReply, '8'),
  // Backup options.
  backup_export: redispatch(handleBackupRestoreReply, '1'),
  backup_import: redispatch(handleBackupRestoreReply, '2'),
  backup_view: redispatch(handleBackupRestoreReply, '3'),
  // Logs options (live 'logs' state handler).
  logs_admin: async (context) => handleLogsReply(context, '1'),
  logs_error: async (context) => handleLogsReply(context, '2'),
  // Analytics options.
  analytics_top: redispatch(handleAnalyticsReply, '1'),
  analytics_response: redispatch(handleAnalyticsReply, '2')
};

// ---------------------------------------------------------------------------
// User-facing cluster (Phase 7). Static-submenu opens render new menus
// (with legacy side effects replicated); stateful flows re-dispatch legacy.
// ---------------------------------------------------------------------------

export const userCustomHandlers = {
  // Settings menu option 9 (help). Currently handled by the dedicated
  // `session.currentMenu === 'settings'` branch in index.js; registered here
  // so the declared `custom:` name resolves if that branch is ever removed.
  settings_help: async (context) => {
    const sender = context.sender;
    const chatId = context.chatId || sender;
    const { getUserByJid } = await import('../services/userService.js');
    const user = await getUserByJid(sender);
    const language = user?.language || config.defaultLanguage;
    const { buildMenuHelp } = await import('../utils/menuHelp.js');
    const { sendMenu } = await import('../utils/messageHelper.js');
    sessionManager.setState(sender, chatId, { currentMenu: 'help', helpFrom: 'settings' });
    await sendMenu({ sock: context.sock, sender, chatId, text: buildMenuHelp('settings', language), transitionKey: 'help_show' });
  },
  // Statistics options (legacy gates/flows preserved).
  stats_my: redispatch(handleStatsReply, '1'),
  stats_top_commands: redispatch(handleStatsReply, '2'),
  stats_top_users: redispatch(handleStatsReply, '3'),
  stats_feedback: redispatch(handleStatsReply, '4'),
  stats_advanced: redispatch(handleStatsReply, '5'),
  // Tutorial options (legacy marks progress; sub senders self-route new).
  tut_getting_started: redispatch(handleTutorialReply, '1'),
  tut_profile_guide: redispatch(handleTutorialReply, '3'),
  tut_settings_prefs: redispatch(handleTutorialReply, '4'),
  tut_self_destruct: redispatch(handleTutorialReply, '5'),
  tut_feedback: redispatch(handleTutorialReply, '6'),
  tut_whats_new: redispatch(handleTutorialReply, '8'),
  // Tutorial stateful flows (fully legacy, commands passed through).
  tut_useful_commands: async (context) => handleTutorialReply(context, '2'),
  tut_quick_tips: async (context) => handleTutorialReply(context, '7'),
  tut_search: async (context) => handleTutorialReply(context, '9'),
  // Info subs (new render, no side effects).
  info_about: redispatch(handleInfoReply, '1'),
  info_version: redispatch(handleInfoReply, '2'),
  info_developer: redispatch(handleInfoReply, '3'),
  info_website: redispatch(handleInfoReply, '4'),
  // Feedback flows (all stateful, fully legacy).
  fb_rate: redispatch(handleFeedbackReply, '1'),
  fb_bug: redispatch(handleFeedbackReply, '2'),
  fb_suggest: redispatch(handleFeedbackReply, '3'),
  fb_contact: redispatch(handleFeedbackReply, '4'),
  fb_history: redispatch(handleFeedbackReply, '5'),
  // FAQ mains/subs (legacy flows; renders self-route when migrated).
  faq_add: redispatch(handleFaqMain, '1'),
  faq_view: redispatch(handleFaqMain, '2'),
  faq_manage: redispatch(handleFaqMain, '3'),
  faq_search: redispatch(handleFaqMain, '4'),
  faq_impexport: redispatch(handleFaqMain, '5'),
  faq_stats: redispatch(handleFaqMain, '6'),
  // Snippet import/export options.
  snip_impex_export: redispatch(handleSnippetImpex, '1'),
  snip_impex_import: redispatch(handleSnippetImpex, '2')
};

// ---------------------------------------------------------------------------
// Bot lifecycle notifications (admin-only). Toggles persist through the
// settings service; each re-renders the menu with a live on/off suffix.
// ---------------------------------------------------------------------------

const BOT_NOTIF_KEYS = {
  toggleAll: null,
  onStartup: 'botNotifyOnStartup',
  onShutdown: 'botNotifyOnShutdown',
  onCrash: 'botNotifyOnCrash'
};

function readBotNotifSettings() {
  const s = settingsService.getSettings() || {};
  return {
    enabled: s.botNotificationsEnabled !== false,
    onStartup: s.botNotifyOnStartup !== false,
    onShutdown: s.botNotifyOnShutdown !== false,
    onCrash: s.botNotifyOnCrash !== false
  };
}

async function toggleBotNotifications(context, which) {
  const { sendMenuById } = await import('./menuSender.js');
  const { logAdminAction } = await import('../services/adminLogService.js');
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = context.language || config.defaultLanguage;
  const before = readBotNotifSettings();

  const patch = {};
  let label;
  if (which === 'toggleAll') {
    const next = !before.enabled;
    patch.botNotificationsEnabled = next;
    label = `bot notifications ${next ? 'on' : 'off'}`;
  } else {
    const key = BOT_NOTIF_KEYS[which];
    const next = !before[which];
    patch[key] = next;
    label = `bot notify ${which} ${next ? 'on' : 'off'}`;
  }
  settingsService.updateSettings(patch);
  logAdminAction(sender, 'settings_change', label);

  const stateText = which === 'toggleAll'
    ? (before.enabled ? 'off' : 'on')
    : (before[which] ? 'off' : 'on');
  return sendMenuById(
    'bot_notifications',
    { sock: context.sock, sender, chatId, user: context.user || null, language },
    'bot_notifications',
    { resultLine: t(language, stateText === 'on' ? 'menu.bot_notifications.resultOn' : 'menu.bot_notifications.resultOff'), sessionMenu: 'bot_notifications' }
  );
}

export const botNotificationCustomHandlers = {
  botnotifs_all: (context) => toggleBotNotifications(context, 'toggleAll'),
  botnotifs_startup: (context) => toggleBotNotifications(context, 'onStartup'),
  botnotifs_shutdown: (context) => toggleBotNotifications(context, 'onShutdown'),
  botnotifs_crash: (context) => toggleBotNotifications(context, 'onCrash'),
  sys_bot_notifications: async (context) => {
    const { sendMenuById } = await import('./menuSender.js');
    const chatId = context.chatId || context.sender;
    const language = context.language || config.defaultLanguage;
    return sendMenuById(
      'bot_notifications',
      { sock: context.sock, sender: context.sender, chatId, user: context.user || null, language },
      'system_bot_notifications',
      { sessionMenu: 'bot_notifications' }
    );
  }
};

// ---------------------------------------------------------------------------
// Message display modes. Users pick their own mode; admins own the global
// default and the two override switches.
// ---------------------------------------------------------------------------

const MODE_LABEL_KEYS = {
  edit: 'menu.message_display.edit',
  send_new: 'menu.message_display.send_new',
  delete_send: 'menu.message_display.delete_send',
  hybrid: 'menu.message_display.hybrid'
};

async function reRender(context, menuId, transitionKey, resultKey, params) {
  const { sendMenuById } = await import('./menuSender.js');
  const chatId = context.chatId || context.sender;
  const language = context.language || config.defaultLanguage;
  const user = context.user || null;
  let resultLine = null;
  if (resultKey) resultLine = t(language, resultKey, params);
  return sendMenuById(
    menuId,
    { sock: context.sock, sender: context.sender, chatId, user, language },
    transitionKey,
    { resultLine, sessionMenu: menuId }
  );
}

async function setUserMessageMode(context, mode) {
  const msg = await import('../services/messageSettingsService.js');
  const { getUserByJid, updateUser } = await import('../services/userService.js');
  const set = msg.getSettings();
  const sender = context.sender;
  const language = context.language || config.defaultLanguage;

  if (!set.allowUserOverride) {
    // Admin locked overrides: refuse and explain, do not change anything.
    return reRender(context, 'message_display', 'message_display', 'menu.message_display.lockedByAdmin');
  }
  if (!set.userOverrideRange.includes(mode)) {
    return reRender(context, 'message_display', 'message_display', 'menu.message_display.notAvailable');
  }
  const user = context.user || (await getUserByJid(sender));
  const next = { ...(user?.preferences || {}), messageDisplayMode: mode };
  await updateUser(sender, { preferences: next });
  // Keep the in-memory user fresh so the re-render shows the new selection.
  if (context.user) context.user.preferences = next;
  return reRender(context, 'message_display', 'message_display', 'menu.message_display.selected', {
    mode: toSmallCaps(t(language, MODE_LABEL_KEYS[mode] || MODE_LABEL_KEYS.hybrid))
  });
}

async function adminSetDefaultMode(context) {
  const msg = await import('../services/messageSettingsService.js');
  const { logAdminAction } = await import('../services/adminLogService.js');
  const set = msg.getSettings();
  const language = context.language || config.defaultLanguage;
  // Cycle edit -> send_new -> delete_send -> hybrid.
  const order = msg.MESSAGE_MODES;
  const next = order[(order.indexOf(set.defaultMode) + 1) % order.length];
  msg.updateSetting('defaultMode', next);
  logAdminAction(context.sender, 'message_mode_default_changed', next);
  return reRender(context, 'message_display_admin', 'message_display_admin', 'menu.message_display_admin.defaultSet', {
    mode: toSmallCaps(t(language, MODE_LABEL_KEYS[next] || MODE_LABEL_KEYS.hybrid))
  });
}

async function toggleUserOverride(context) {
  const msg = await import('../services/messageSettingsService.js');
  const { logAdminAction } = await import('../services/adminLogService.js');
  const set = msg.getSettings();
  const next = !set.allowUserOverride;
  msg.updateSetting('allowUserOverride', next);
  logAdminAction(context.sender, 'user_override_toggled', next ? 'on' : 'off');
  return reRender(context, 'message_display_admin', 'message_display_admin',
    next ? 'menu.message_display_admin.userOverrideOn' : 'menu.message_display_admin.userOverrideOff');
}

async function togglePerMenuOverride(context) {
  const msg = await import('../services/messageSettingsService.js');
  const { logAdminAction } = await import('../services/adminLogService.js');
  const set = msg.getSettings();
  const next = !set.perMenuOverrideEnabled;
  msg.updateSetting('perMenuOverrideEnabled', next);
  logAdminAction(context.sender, 'per_menu_override_toggled', next ? 'on' : 'off');
  return reRender(context, 'message_display_admin', 'message_display_admin',
    next ? 'menu.message_display_admin.perMenuOn' : 'menu.message_display_admin.perMenuOff');
}

export const messageDisplayCustomHandlers = {
  set_user_mode_edit: (context) => setUserMessageMode(context, 'edit'),
  set_user_mode_send_new: (context) => setUserMessageMode(context, 'send_new'),
  set_user_mode_delete_send: (context) => setUserMessageMode(context, 'delete_send'),
  set_user_mode_hybrid: (context) => setUserMessageMode(context, 'hybrid'),
  set_message_mode_default: adminSetDefaultMode,
  toggle_user_override: toggleUserOverride,
  toggle_per_menu_override: togglePerMenuOverride,
  sys_message_display: (context) => reRender(context, 'message_display_admin', 'system_message_display', null)
};

// ---------------------------------------------------------------------------
// Custom Commands admin menu. Each row opens a wizard that owns its own input
// prompts; the dispatcher routes 'custom_command_*' states back to the wizard.
// ---------------------------------------------------------------------------

const ccWizard = () => import('./customCommandWizard.js');

export const customCommandCustomHandlers = {
  custom_cmds_list: (context) => ccWizard().then((w) => w.startListWizard(context)),
  custom_cmds_add: (context) => ccWizard().then((w) => w.startAddWizard(context)),
  custom_cmds_edit: (context) => ccWizard().then((w) => w.startEditWizard(context)),
  custom_cmds_delete: (context) => ccWizard().then((w) => w.startDeleteWizard(context)),
  custom_cmds_toggle: (context) => ccWizard().then((w) => w.startToggleWizard(context)),
  custom_cmds_impex: (context) => ccWizard().then((w) => w.startImportExport(context)),
  sys_custom_commands: async (context) => {
    const { sendMenuById } = await import('./menuSender.js');
    const chatId = context.chatId || context.sender;
    const language = context.language || config.defaultLanguage;
    return sendMenuById('custom_commands', { sock: context.sock, sender: context.sender, chatId, user: context.user || null, language }, 'system_custom_commands', { sessionMenu: 'custom_commands' });
  }
};
