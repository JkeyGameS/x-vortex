import makeWASocket, { useMultiFileAuthState, DisconnectReason } from '@whiskeysockets/baileys';
import config from './config/config.js';
import logger from './utils/logger.js';
import sessionManager from './utils/sessionManager.js';
import { sendText } from './services/messageService.js';
import { toSmallCaps } from './utils/smallCaps.js';
import { t } from './services/localeService.js';
import { loadCommands } from './handlers/commandHandler.js';
import { startHealthServer, stopHealthServer } from './healthServer.js';
import { setQR, clearQR } from './utils/qrState.js';
import { loadChangelog } from './services/changelogService.js';
import { loadBotContent } from './services/botContentService.js';
import { SUB_STATES as CHANGELOG_SUB_STATES } from './handlers/changelogManagerCommand.js';
import { dispatchCommand } from './handlers/commandDispatch.js';
import { handleLanguageSelection, buildLanguageMenu } from './handlers/languageCommand.js';
import {
  sendAdminPanel,
  handleAdminReply,
  handleCombinedImportInput,
  handleCombinedImportPolicy,
  handleChatTestPanelReply,
  handleTestReply,
  handleBroadcastInput,
  handleBroadcastReply,
  handleBroadcastScheduleText,
  handleBroadcastScheduleTime,
  handleConfirmationReply,
  handleManageUsersReply,
  handleManageUsersSearch,
  handleManageUsersDelete,
  handleManageUsersBlock,
  handleBlockedUsersMenu,
  handleBlockedBlockJid,
  handleBlockedBlockReason,
  handleBlockedUnblockJid,
  handleTemplateReply,
  handleTemplateNameInput,
  handleTemplateTextInput,
  handleTemplateUseList,
  handleTemplatePreview,
  handleTemplateEdit,
  handleTemplateDeleteList,
  handleGeneralSettingsReply,
  handleAdminAccessReply,
  handleAdminAccessAddInput,
  handleAdminAccessRemoveReply,
  handleAdminAccessRemoveConfirm,
  handleNotificationsReply,
  handleUpdatesReply,
  handleDataReply,
  handleLogsReply,
  handleQuickActionsReply,
  handleQuickConfirmReply,
  handleAdminSearchReply,
  handleAdminSearchResultsReply,
  handleAdminSearchDetailReply,
  handleScheduledTasksReply,
  handleScheduledTaskDetailReply,
  handleEmergencyReply,
  handleEmergencyConfirmReply,
  handleRolesReply,
  handleRolesUserReply,
  handleRolesSetReply,
  handleSystemSettingsNameInput,
  sendConversationSettingsPanel,
  handleConversationReply,
  handleFeatureFlagsReply,
  sendFeatureFlagsPanel,
  sendSystemSettingsPanel,
  showErrorLog,
  handleScheduleReply,
  handleScheduleListReply,
  handleScheduleDetailReply,
  handleScheduleEditReply,
  handleScheduleEditMessage,
  handleBroadcastScheduleManual,
  handleBroadcastScheduleRepeat,
  handleScheduleEmptyReply,
  sendManageUsersPanel,
  sendBlockedUsersPanel,
  sendUserManagementMenu,
  sendChatFaqMenu,
  sendChatFaqStatsPanel,
  sendChatSettingsPanel,
  handleChatSettingsReply,
  handleChatSettingsFuzzy,
  handleChatSettingsCooldown,
  handleChatSettingsFallback,
  handleChatSettingsPriority,
  handleChatSettingsMaxReplies,
  handleChatSettingsIgnoreList,
  handleChatSettingsLanguageFilter,
  handleChatSettingsDelayOverride,
  handleChatSettingsContextExpiry,
  handleContextRegistry,
  handleToneWordsMenu,
  handleFollowUpChanceMenu,
  handleContextBoostMenu,
  showRateLimitMaxMenu,
  handleRateLimitMaxMenu,
  showRateLimitWindowMenu,
  handleRateLimitWindowMenu,
  showSnippetDepthMenu,
  handleSnippetDepthMenu,
  handleTypingTargetingMenu,
  handleTypingDefaultTypeMenu,
  showRateLimitLogMenu,
  showDryRunLogMenu,
  handleDryRunLogMenu,
  showDryRunLogDetail,
  handleDryRunLogClear,
  sendDryRunExport,
  showReplyAnalyticsMenu,
  handleReplyAnalyticsMenu,
  showRuleAnalyticsDetail,
  handleRuleAnalyticsDetail,
  handleReplyAnalyticsReset,
  sendAnalyticsExport,
  promptAnalyticsImport,
  handleAnalyticsImportInput,
  sendAdminBackupMenu,
  sendAdminLogsMenu,
  handleGroupedAdminReply,
  sendTemplateSubmenu,
  buildTestMenu
} from './handlers/adminCommand.js';
import { MAIN_MENU_FEATURES, sendMigratedMainMenu, command as startCommand } from './handlers/startCommand.js';
import {
  handleChatReply, handleChatAddStart, handleChatAddTriggerInput, handleChatAddTriggerEdit,
  handleChatAddCustomTrigger, handleChatAddReplies, handleChatAddPreview, handleChatAddLanguage,
  handleChatAddStyle, handleChatAddEmoji, handleChatAddAnotherLang,
  handleChatEditMenu, handleChatEditTriggers, handleChatEditReplies, handleChatEditWeights, handleAddReplyTags, handleEditReplyTags, handleAddReplyStyles, handleEditReplyStyles, handleChatEditLanguage,
  handleChatEditPriority, handleChatEditStyle, handleChatSearchInput, handleChatImportInput,
  handleChatTestSelect, handleChatTestResult, handleChatBulkConfirm, handleChatFilterLanguage,
  handleChatDuplicateSelect, handleChatDuplicateLanguage, handleChatDuplicateModify, handleTriggerVariations,
  handleTriggerVariationsAdd, handleResponsePreview, handlePriorityReorder,
  handleResponseAction, handleCooldownMenu, handleCooldownCustom, handleActiveDatesMenu,
  handleContextMenu, handleContextInput, handleContextConfirm, handleSetsContextMenu,
  handleSetsContextInput, handleContextExpiry, handleEditContextMenu, handleEditContextInput,
  handleEditContextExpiry,
  handleActiveDateInput, handleRuleEditSelect, handleRuleDeleteSelect,
  handleRuleToggleSelect, handleAddRuleMenu, handleDraftsList, handleDraftDetail,
  handleDraftDelete, handleUnmatchedDetail, handleTemplateLibrary, handleTemplateCategory,
  handleTemplatePackPreview, handleTemplateLanguageSelect, handleTemplatePreviewEdit,
  handleTemplatePreviewEditInput, handleTemplateUninstall, handleTemplateDuplicateConfirm,
  handleTemplateCreatePack, handleTemplateImportExport, handleTemplateImportConfirm,
  handleTemplateFeatured, handleTemplateSearch, handleTemplateTagFilter, handlePackUpdates,
  handleSmartSuggestions, handleBulkToggleMenu, handleTemplateSnapshots,
  handleCleanupSuggestions, handleCleanupGroup,
  sendChatPanel, handleStructuredChatReply, handleCreateFromExample, handleMultiLanguageAdd,
  saveWizardDraft, handleWizardExit,
  sendSnippetsMenu, handleSnippetsMenu, handleSnippetAddName, handleSnippetText,
  handleSnippetPick, handleSnippetTranslatePick, handleSnippetTranslateLang,
  handleSnippetTranslateText, handleSnippetImpex, handleSnippetImport,
  showAddReplySnippetPrompt, handleAddReplySnippet, handleAddReplySnippetPick,
  showBulkDeleteMenu, handleBulkDeleteMenu, handleBulkDeleteFilterPick,
  handleBulkDeleteConfirm, showTrashMoveMenu, handleTrashMoveMenu,
  handleTrashMoveFilterPick, showTrashMenu, handleTrashMenu,
  showPackUninstallMenu, handlePackUninstallMenu
} from './handlers/chatCommand.js';
import {
  handleFaqReply, handleFaqAddQuestion, handleFaqAddAnswer, handleFaqAddKeywords,
  handleFaqAddKeywordsInput, handleFaqAddCategory, handleFaqAddLanguage, handleFaqAddAnotherLang,
  handleFaqEditMenu, handleFaqEditAnswer, handleFaqEditKeywords, handleFaqEditCategory,
  handleFaqEditLanguage, handleFaqEditPriority, handleFaqSearchInput, handleFaqImportInput,
  handleFaqTestSelect, handleFaqTestResult, handleFaqBulkConfirm, handleFaqFilterCategory,
  handleFaqDuplicateSelect, handleFaqDuplicateLanguage, handleFaqResponsePreview,
  handleFaqList, handleFaqEditSelect, handleFaqDeleteSelect, handleFaqToggleSelect,
  sendFaqPanel, sendFaqMainPanel, handleFaqMain, showFaqAddMenu, handleFaqAddMenu,
  showFaqViewMenu, handleFaqViewMenu, showFaqManageMenu, handleFaqManageMenu,
  handleFaqViewList, handleFaqViewByLang, handleFaqViewByCategory, showFaqDetail,
  handleFaqDetail, handleFaqBulkToggleMenu, showFaqStatsPanel, handleFaqStatsPanel,
  showFaqPerformanceDashboard, showFaqSearchPrompt, handleFaqSearchPrompt,
  showFaqSearchResults, handleFaqSearchResults, showFaqTestQuestion, handleFaqTestQuestion,
  showFaqBatchTest, handleFaqBatchTest, showFaqImportExportMenu, handleFaqImportExportMenu,
  showFaqSnapshots, handleFaqSnapshots, showFaqCleanupSuggestions, handleFaqCleanupSuggestions,
  showFaqCleanupGroup, handleFaqCleanupGroup, startFaqQuickAdd, handleFaqQuickAdd,
  handleFaqQuickAddKeywords, handleFaqQuickAddKeywordsInput, handleFaqQuickAddAnswer,
  handleFaqQuickAddDone, showFaqExitConfirm, handleFaqExitConfirm, showFaqBulkAdd,
  handleFaqBulkAdd, showFaqFromUnmatched, handleFaqFromUnmatched, showFaqDraftsList,
  handleFaqDraftsList, showFaqCreateFromExample, handleFaqCreateFromExample,
  showFaqMultilangAdd, handleFaqMultilangAdd, showFaqTemplateLibrary, handleFaqTemplateLibrary,
  showFaqTemplateCategory, handleFaqTemplateCategory, showFaqTemplatePackPreview,
  handleFaqTemplatePackPreview, showFaqTemplateLanguageSelect, handleFaqTemplateLanguageSelect,
  handleFaqTemplateDuplicateConfirm, showFaqTemplatePreviewEdit, handleFaqTemplatePreviewEdit,
  handleFaqTemplatePreviewEditInput, showFaqTemplateUninstall, handleFaqTemplateUninstall,
  showFaqTemplateImportExport, handleFaqTemplateImportExport, showFaqPackUpdates, handleFaqPackUpdates
} from './handlers/faqCommand.js';
import {
  handleProcessingInterrupt,
  handleExportsListReply, handleExportsDetailReply, handleExportsRenameInput,
  handleImportPolicy
} from './handlers/exportCommand.js';
import { ensureExportsDir } from './services/exportService.js';
import { openProfile, handleProfileReply, openProfileView, openEditProfile, openStats, openPreferences, openLanguageSelection, featureBlockedReply, backToMain } from './handlers/profileCommand.js';
import { openSettings } from './handlers/settingsCommand.js';
import { handleUserManagementReply } from './handlers/userManagementCommand.js';
import { openTutorial, handleTutorialReply } from './handlers/tutorialCommand.js';
import { handleRestoreData } from './handlers/restoreCommand.js';
import {
  getUserByJid,
  updateLastActive,
  trackUserMessage,
  deleteTestUsers
} from './services/userService.js';
import { sendMenu } from './utils/messageHelper.js';
import * as reportService from './services/reportService.js';
import * as conversationService from './services/conversationService.js';
import * as chatNotifyService from './services/chatNotifyService.js';
import { buildMenuHelp } from './utils/menuHelp.js';
import { openHelp, getHelpPage } from './handlers/helpCommand.js';
import { openInfo, handleInfoReply } from './handlers/infoCommand.js';
import { openStatsMenu, handleStatsReply } from './handlers/statsCommand.js';
import { handleAnalyticsReply, handleAnalyticsDetailReply, handleMaintMenuReply, handleMaintScheduleReply, handleMaintWindowsReply, handleMaintWindowDetailReply } from './handlers/adminCommand.js';
import { openFeedback, handleFeedbackReply, handleFeedbackAdminReply } from './handlers/feedbackCommand.js';
import { setLastError } from './utils/errorTracker.js';
import settingsService from './services/settingsService.js';
import {
  recordLastSeen,
  flushLastSeen,
  shouldWelcomeBack,
  buildWelcomeBackMessage,
  renderWelcomeBack
} from './services/welcomeBackService.js';
import { isWelcomeBackEnabled, welcomeBackTipShownPatch } from './config/welcomeBackToggles.js';
import { pickSpeaker } from './utils/pickSpeaker.js';
import { getMenu } from './config/menus/registry.js';
import { resolveMenuOption, runMenuAction } from './utils/menuRouter.js';
import { sendMenuById } from './utils/menuSender.js';
import { cancelStartHint } from './services/startHintService.js';
import { sendResumePrompt, handleResumeReply } from './handlers/resumeHandler.js';
import * as blockedUsers from './services/blockedUsersService.js';
import * as scheduleService from './services/scheduleService.js';
import * as featureScheduleService from './services/featureScheduleService.js';
import { isFeatureEnabled, getFeature } from './services/featureFlagService.js';
import { getRecentErrors, addError } from './services/errorLogService.js';
import { handleTryReply } from './handlers/tryCommand.js';
import * as selfDestructService from './services/selfDestructService.js';
import * as chatRuleService from './services/chatRuleService.js';

const SLEEP_ANIMATION_DELAY_MS = 8000;
const SLEEP_REMINDER_LIMIT = 3;
const SLEEP_REMINDER_DELETE_DELAY_MS = 10000;

function sleepDelay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function testSessionIsEnding(sender, chatId) {
  return sessionManager.getSession(sender, chatId)?.isEndingTestSession === true;
}

async function sendTestAnimationMenu({ sock, sender, chatId, text, transitionKey }) {
  sessionManager.setState(sender, chatId, { testAnimationBusy: true });
  try {
    if (testSessionIsEnding(sender, chatId)) return false;
    await sendMenu({ sock, sender, chatId, text, transitionKey });
    return true;
  } finally {
    sessionManager.setState(sender, chatId, { testAnimationBusy: false });
  }
}

function sleepMenuText(language, heading, body) {
  return '> *' + toSmallCaps(t(language, heading)) + '*\n\n' + toSmallCaps(body);
}

function sleepConfirmationText(language) {
  return sleepMenuText(language, 'sleep.title', [
    t(language, 'sleep.confirmQuestion'),
    '',
    '1. ' + t(language, 'admin.yes'),
    '2. ' + t(language, 'admin.no'),
    '',
    t(language, 'sleep.replyPrompt')
  ].join('\n'));
}

async function sendSleepingReminder({ sock, sender, chatId, language }) {
  const session = sessionManager.getSession(sender, chatId) || {};
  const reminderCount = session.sleepReminderCount || 0;
  if (reminderCount >= SLEEP_REMINDER_LIMIT) return;

  sessionManager.setState(sender, chatId, {
    sleepReminderCount: reminderCount + 1
  });

  try {
    const sent = await sock.sendMessage(sender, {
      text: '😴 ' + toSmallCaps(t(language, 'sleep.reminder'))
    });
    const reminderKey = sent?.key || null;
    sessionManager.setState(sender, chatId, {
      sleepReminderKey: reminderKey
    });

    if (reminderKey) {
      setTimeout(async () => {
        try {
          await sock.sendMessage(sender, { delete: reminderKey });
        } catch (err) {
          logger.warn({ err }, 'Sleeping reminder delete failed');
        }
        const currentSession = sessionManager.getSession(sender, chatId) || {};
        if (currentSession.sleepReminderKey === reminderKey) {
          sessionManager.setState(sender, chatId, { sleepReminderKey: null });
        }
      }, SLEEP_REMINDER_DELETE_DELAY_MS);
    }
  } catch (err) {
    logger.warn({ err, sender }, 'Sleeping reminder send failed');
  }
}

function sleepAnimationText(language, key, dots, emoji) {
  return sleepMenuText(language, 'sleep.title', t(language, key) + dots + '\n' + emoji);
}

async function sendSleepFinalMessage({ sock, sender, chatId, language }) {
  const sent = await sendTestAnimationMenu({ sock, sender, chatId, text: sleepMenuText(language, 'sleep.brand', [
    t(language, 'sleep.description'),
    '',
    t(language, 'sleep.finalMessage'),
    '',
    t(language, 'sleep.wakeInstruction')
  ].join('\n')), transitionKey: 'sleep_final_edit_or_new' });
  if (!sent) return false;
  sessionManager.setState(sender, chatId, {
    isSleeping: true,
    currentMenu: 'sleeping',
    sleepReminderCount: 0,
    sleepReminderKey: null
  });
  return true;
}

async function runSleepAnimation({ sock, sender, chatId, language }) {
  const stages = [
    ['.', ''],
    ['..', ''],
    ['...', ''],
    [' 😴', '']
  ];
  for (const [dots, emoji] of stages) {
    if (testSessionIsEnding(sender, chatId)) return;
    if (!await sendTestAnimationMenu({ sock, sender, chatId, text: sleepAnimationText(language, 'sleep.preparing', dots, emoji), transitionKey: 'sleep_animation' })) return;
    await sleepDelay(SLEEP_ANIMATION_DELAY_MS);
  }
  if (testSessionIsEnding(sender, chatId)) return;
  await sendSleepFinalMessage({ sock, sender, chatId, language });
}

async function runWakeAnimation({ sock, sender, chatId, pushName, language }) {
  const stages = [
    ['.', ''],
    ['..', ''],
    ['...', ''],
    [' 😃', '']
  ];
  for (const [dots, emoji] of stages) {
    if (testSessionIsEnding(sender, chatId)) return;
    if (!await sendTestAnimationMenu({ sock, sender, chatId, text: sleepAnimationText(language, 'sleep.wakingUp', dots, emoji), transitionKey: 'wake_animation' })) return;
    await sleepDelay(SLEEP_ANIMATION_DELAY_MS);
  }
  if (testSessionIsEnding(sender, chatId)) return;
  sessionManager.setState(sender, chatId, {
    isSleeping: false,
    currentMenu: 'main',
    sleepReminderCount: 0,
    sleepReminderKey: null
  });
  await startCommand.execute({ sock, sender, chatId, pushName, transitionKey: 'sleep_final' });
}

async function wakeWithoutAnimation({ sock, sender, chatId, pushName, language }) {
  sessionManager.setState(sender, chatId, {
    isSleeping: false,
    currentMenu: 'main',
    sleepReminderCount: 0,
    sleepReminderKey: null
  });
  await startCommand.execute({ sock, sender, chatId, pushName, transitionKey: 'sleep_final' });
}

function startPeriodicCleanup() {
  setInterval(async () => {
    try {
      const removed = await deleteTestUsers();
      if (removed > 0) {
        logger.info({ removed }, 'Periodic test-user cleanup completed');
      }
    } catch (err) {
      setLastError(err);
      logger.error({ err }, 'Periodic test-user cleanup failed');
    }
  }, config.testUserCleanupIntervalMs || 3600000);
}

// Live socket handle for the lifecycle service's shutdown notification.
let lifecycleSock = null;

async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState(config.sessionPath);

  // PaaS liveness probe. Started before the socket so the platform sees a
  // healthy process even while WhatsApp is still handshaking. A bind failure is
  // logged and ignored -- it must never stop the bot.
  startHealthServer();
  logger.info(
    { port: process.env.PORT || 3000 },
    `[HEALTH] QR page will be available at http://localhost:${process.env.PORT || 3000}/qr/page once Baileys generates a QR`
  );

  // Admin-editable content. Must load before anything reads getContent(): the
  // menu registry resolves labels through resolvers that read timing and
  // language display, and every onboarding string resolves on first use.
  loadBotContent();

  // Version history for the Info menu. Loaded eagerly so the first open does
  // not pay a disk read; a missing file degrades to an empty changelog.
  loadChangelog();

  // Release the probe port on shutdown. Deliberately does not call process.exit:
  // lifecycleService owns the graceful-shutdown path.
  const closeHealth = () => { stopHealthServer(); };
  // Persist batched lastSeen values, otherwise up to one flush interval of
  // presence data is lost on every restart.
  const flushPresence = () => {
    try { flushLastSeen(); } catch { /* shutdown must not throw */ }
  };
  process.once('exit', flushPresence);
  process.once('SIGINT', closeHealth);
  process.once('SIGTERM', closeHealth);

  const sock = makeWASocket({
    auth: state,
  });

  sessionManager.setSock(sock);
  reportService.setSock(sock);
  lifecycleSock = sock;
  scheduleService.setSock(sock);
  featureScheduleService.setSock(sock);
  chatNotifyService.setSock(sock);
  selfDestructService.setSock(sock);
  ensureExportsDir();
  // Re-arm the temporary conversation-disable timer after a restart.
  conversationService.rearmConversationAutoEnable().catch(err => {
    logger.error({ err }, 'Failed to re-arm conversation auto-enable on startup');
  });
  // Re-schedule any persisted broadcasts that were pending from before a restart.
  scheduleService.loadSchedulesAndSchedule().catch(err => {
    logger.error({ err }, 'Failed to load scheduled broadcasts on startup');
  });
  // Compare built-in template pack versions against installed rules.
  import('./services/chatTemplateService.js').then(({ checkForPackUpdates }) => {
    try {
      checkForPackUpdates();
    } catch (err) {
      logger.error({ err }, 'Failed to check template pack updates on startup');
    }
  }).catch(err => {
    logger.error({ err }, 'Failed to load template service on startup');
  });
  import('./services/faqTemplateService.js').then(({ checkForFaqPackUpdates }) => {
    try {
      checkForFaqPackUpdates();
    } catch (err) {
      logger.error({ err }, 'Failed to check FAQ pack updates on startup');
    }
  }).catch(err => {
    logger.error({ err }, 'Failed to load FAQ template service on startup');
  });
  // Re-arm any persisted scheduled feature changes from before a restart.
  featureScheduleService.loadSchedulesAndSchedule().catch(err => {
    logger.error({ err }, 'Failed to load scheduled feature changes on startup');
  });
  // Apply persisted maintenance windows (may enable maintenance immediately).
  Promise.resolve()
    .then(() => import('./services/maintenanceScheduleService.js'))
    .then(({ applyScheduledWindows }) => applyScheduledWindows())
    .catch(err => {
      logger.error({ err }, 'Failed to load maintenance windows on startup');
    });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    // Device locale/platform for first-time language onboarding.
    // NOTE: with this Baileys version connection.update never carries
    // node.userAgent (the 'open' event is emitted with only { connection }), and
    // the value Baileys does send is a hardcoded 'en' from its own getUserAgent()
    // for the *bot's* client, not the contacting user's device. This hook is kept
    // so a real value is used if a future version ever surfaces one; until then
    // detection falls back to the default language.
    if (update?.node?.userAgent) {
      const { recordDeviceLocale, recordDevicePlatform, getDeviceLocale, getDevicePlatform } =
        await import('./handlers/languageOnboardingHandler.js');
      const ua = update.node.userAgent;
      if (ua.localeLanguageIso6391 || ua.os) {
        recordDeviceLocale(ua.localeLanguageIso6391);
        recordDevicePlatform(ua.platform, ua.os);
        logger.info({ locale: getDeviceLocale(), platform: getDevicePlatform() }, '[ONBOARD] device info captured');
      }
    }

    if (qr) {
      // On a PaaS platform the terminal is wrapped and the ASCII art cannot be
      // scanned, so the payload is stored and rendered as a PNG by the health
      // server instead.
      setQR(qr);
      logger.info({ url: `http://localhost:${process.env.PORT || 3000}/qr/page` }, '[BAILEYS] New QR available — open /qr/page in the browser to scan');
    }

    if (connection === 'close') {
      const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
      logger.info({ shouldReconnect }, 'Connection closed');
      if (shouldReconnect) {
        startBot();
      }
    } else if (connection === 'open') {
      clearQR();
      logger.info('Bot connected successfully — QR cleared');
      // Lifecycle: detect a previous unclean stop BEFORE marking this boot,
      // otherwise markStartup() overwrites lastStartedAt and every fresh
      // start would look like a crash.
      const lifecycle = await import('./services/lifecycleService.js');
      const crashInfo = lifecycle.detectPreviousCrash();
      lifecycle.markStartup();
      if (!global.__startupNotified) {
        global.__startupNotified = true;
        // Delay so WhatsApp is fully ready before pushing.
        setTimeout(async () => {
          try {
            await lifecycle.notifyAdminsStartup(sock);
            if (crashInfo.crashed) await lifecycle.notifyAdminsCrash(sock, crashInfo);
          } catch (err) {
            // A failed notification must never stop the bot from running.
            logger.error({ err }, '[LIFECYCLE] startup notification failed');
          }
        }, 3000);
      }

      // Dev-change notifications: report entries newer than the last one shown
      // to admins. Separate guard and delay from the lifecycle block above so a
      // reconnect cannot fire it twice, and delayed so it lands after the
      // startup/crash notices rather than interleaving with them.
      if (!global.__devChangesNotified) {
        global.__devChangesNotified = true;
        setTimeout(async () => {
          try {
            const { notifyPendingDevChanges } = await import('./services/devChangeNotifier.js');
            await notifyPendingDevChanges(sock);
          } catch (err) {
            // A failed notification must never stop the bot from running.
            logger.error({ err }, '[DEV_CHANGES] startup notification failed');
          }
        }, 5000);
      }
    }
  });

  // Load all commands
  const commands = await loadCommands();

  // Track command timestamps per user for spam detection
  const spamTimestamps = new Map();

  // Per-user cooldown tracking
  const cooldownMap = new Map();
  const isAdminOperator = (jid) => (config.adminJids || []).includes(jid);
  const bypassCooldown = (jid) => config.adminBypassCooldown && isAdminOperator(jid);

  // Track which regular users have already been notified of maintenance mode,
  // so we don't spam them on every single message.
  const maintenanceNotified = new Set();

  function applyCooldown(sender, isAction) {
    if (!isAction) return false;
    const now = Date.now();
    const last = cooldownMap.get(sender) || 0;
    if (!bypassCooldown(sender) && last && (now - last) < (config.commandCooldownMs || 1000)) {
      return true; // blocked
    }
    cooldownMap.set(sender, now);
    return false;
  }

  function isActionText(session, trimmedText, isCommand) {
    if (isCommand) return true;
    if (!session?.currentMenu) return false;
    if (!/^\d+$/.test(trimmedText)) return false;
    if (session.currentMenu === 'settings') return true;
    if (session.currentMenu.startsWith('tutorial_')) return true;
    if (session.currentMenu.startsWith('admin_')) return true;
    return ['main', 'admin', 'test_submenu', 'backup_restore', 'confirmation', 'language_selection', 'tutorial_main', 'tutorial_getting_started', 'tutorial_commands', 'tutorial_profile_guide', 'tutorial_settings', 'tutorial_selfdestruct', 'tutorial_feedback', 'system_settings', 'general_settings', 'admin_access', 'admin_access_add', 'admin_access_remove', 'admin_access_remove_confirm', 'notifications', 'updates', 'data_management', 'logs', 'templates', 'template_use_list', 'template_delete_list', 'command_analytics', 'blocked_users_menu', 'feature_flags', 'change_marker_scope', 'change_marker_status_list', 'change_marker_bulk_confirm', 'change_marker_value', 'change_marker_custom_input', 'change_marker_bulk_confirm_value', 'marker_nav', 'marker_submenu_action', 'marker_picker', 'marker_change_confirm', 'marker_custom_input', 'status_change', 'status_confirm', 'feature_notify', 'broadcast_schedule', 'broadcast_schedule_list', 'broadcast_schedule_detail', 'broadcast_schedule_edit', 'exports_menu', 'exports_detail', 'exports_import_policy', 'exports_rename_input', 'info', 'info_about', 'info_version', 'info_developer', 'info_website', 'feedback_main', 'feedback_rating', 'feedback_rating_followup', 'feedback_rating_done', 'feedback_bug_category', 'feedback_bug_prompt', 'feedback_bug_anon', 'feedback_bug_done', 'feedback_suggestion_prompt', 'feedback_suggestion_anon', 'feedback_suggestion_done', 'feedback_history', 'feedback_history_detail', 'feedback_history_edit_rating', 'feedback_history_edit_desc', 'feedback_history_delete_confirm', 'feedback_rating_confirm', 'feedback_rating_motivation', 'feedback_rating_farewell', 'feedback_contact', 'admin_quick_actions', 'admin_quick_confirm', 'admin_search', 'admin_search_results', 'admin_search_detail', 'admin_scheduled_tasks', 'admin_scheduled_detail', 'admin_emergency', 'admin_emergency_confirm', 'admin_roles', 'admin_roles_user', 'admin_roles_set', 'user_management_bulk', 'user_management_bulk_filter', 'user_management_bulk_param', 'user_management_bulk_message', 'user_management_bulk_preview', 'user_management_segments', 'user_management_segment_name', 'user_management_segment_filter', 'user_management_segment_param', 'user_management_segment_delete', 'user_management_segment_delete_confirm', 'user_management_segment_broadcast', 'user_management_segment_msg', 'user_management_segment_confirm', 'maint_menu', 'maint_schedule_start', 'maint_schedule_end', 'maint_windows', 'maint_window_detail', 'command_analytics_top', 'command_analytics_response', 'stats_main', 'stats_my', 'stats_top_commands', 'stats_top_users', 'stats_feedback', 'stats_advanced', 'stats_adv_language', 'stats_adv_features', 'stats_adv_peak', 'stats_adv_rate', 'stats_adv_trend', 'stats_adv_keywords', 'feedback_admin', 'feedback_admin_list', 'feedback_admin_search', 'feedback_admin_delete', 'feedback_admin_delete_all_confirm', 'feedback_admin_type', 'feedback_admin_detail', 'feedback_admin_detail_delete_confirm', 'feedback_admin_reply_jid', 'feedback_admin_reply_list', 'feedback_admin_reply_method', 'feedback_admin_reply_presets', 'feedback_admin_reply_custom', 'feedback_admin_reply_confirm', 'feedback_admin_presets', 'feedback_admin_preset_list', 'feedback_admin_preset_add', 'feedback_admin_preset_confirm', 'feedback_admin_preset_delete'].includes(session.currentMenu);
  }

  async function showHelpFor({ sender, chatId }, menu) {
    const user = await getUserByJid(sender);
    const language = user?.language || config.defaultLanguage;
    const helpId = { test_submenu: 'test', language_selection: 'language', settings: 'settings' }[menu] || menu;
    sessionManager.setState(sender, chatId, { currentMenu: 'help', helpFrom: menu });
    const text = buildMenuHelp(helpId, language);
    const { sendMenu } = await import('./utils/messageHelper.js');
    await sendMenu({ sock, sender, chatId, text, transitionKey: 'help_show' });
  }

  async function returnFromHelp({ sender, chatId, pushName }) {
    const session = sessionManager.getSession(sender, chatId) || {};
    const helpFrom = session.helpFrom || 'main';
    const user = await getUserByJid(sender);
    const language = user?.language || config.defaultLanguage;
    const { sendMenu } = await import('./utils/messageHelper.js');

    let text;
    let transitionKey;
    let nextMenu;

    if (helpFrom === 'admin') {
      await sendAdminPanel({ sock, sender, chatId, user, language, transitionKey: 'help_back' });
      sessionManager.setState(sender, chatId, { currentMenu: 'admin', helpFrom: null });
      return;
    } else if (helpFrom === 'test_submenu') {
      text = buildTestMenu(language);
      transitionKey = 'test_submenu';
      nextMenu = 'test_submenu';
    } else if (helpFrom === 'language_selection') {
      text = buildLanguageMenu();
      transitionKey = 'language_selection';
      nextMenu = 'language_selection';
    } else if (helpFrom === 'system_settings') {
      await sendSystemSettingsPanel({ sock, sender, chatId });
      sessionManager.setState(sender, chatId, { currentMenu: 'system_settings', helpFrom: null });
      return;
    } else if (helpFrom === 'conversation_settings') {
      await sendConversationSettingsPanel({ sock, sender, chatId });
      sessionManager.setState(sender, chatId, { currentMenu: 'conversation_settings', helpFrom: null });
      return;
    } else if (helpFrom === 'profile') {
      await openProfileView({ sock, sender, chatId });
      sessionManager.setState(sender, chatId, { helpFrom: null });
      return;
    } else if (helpFrom === 'profile_edit') {
      await openEditProfile({ sock, sender, chatId });
      sessionManager.setState(sender, chatId, { helpFrom: null });
      return;
    } else if (helpFrom === 'stats') {
      await openStats({ sock, sender, chatId });
      sessionManager.setState(sender, chatId, { helpFrom: null });
      return;
    } else if (helpFrom === 'preferences') {
      await openPreferences({ sock, sender, chatId });
      sessionManager.setState(sender, chatId, { helpFrom: null });
      return;
    } else if (helpFrom === 'settings') {
      await openSettings({ sock, sender, chatId });
      sessionManager.setState(sender, chatId, { helpFrom: null });
      return;
    } else if (['admin_users', 'chat_faq_menu', 'admin_backup', 'admin_logs'].includes(helpFrom)) {
      const grouped = {
        admin_users: sendUserManagementMenu,
        chat_faq_menu: sendChatFaqMenu,
        admin_backup: sendAdminBackupMenu,
        admin_logs: sendAdminLogsMenu
      }[helpFrom];
      await grouped({ sock, sender, chatId });
      sessionManager.setState(sender, chatId, { helpFrom: null });
      return;
    } else if (helpFrom === 'pref_language_selection') {
      await openLanguageSelection({ sock, sender, chatId });
      sessionManager.setState(sender, chatId, { helpFrom: null });
      return;
    } else {
      await sendMigratedMainMenu({ sock, sender, chatId, user, language, transitionKey: 'help_back' });
      sessionManager.setState(sender, chatId, { currentMenu: 'main', helpFrom: null });
      return;
    }

    sessionManager.setState(sender, chatId, { currentMenu: nextMenu, helpFrom: null });
    await sendMenu({ sock, sender, chatId, text, transitionKey: 'help_back' });
  }

  // Handle incoming messages
  sock.ev.on('messages.upsert', async ({ messages }) => {
    try {
      const msg = messages[0];

      if (!msg.message || msg.key.fromMe) return;

      // Ignore all group messages for now (group features come later). This
      // must happen before any text extraction, session touch, language
      // enforcement, or command processing, so groups never get a reply.
      const isGroup = msg.key.remoteJid.endsWith('@g.us');
      if (isGroup) {
        logger.debug({ jid: msg.key.remoteJid }, 'Ignoring group message');
        return;
      }

      const sender = msg.key.remoteJid;
      const chatId = sender;
      const pushName = msg.pushName || 'User';

      sessionManager.touch(sender, chatId);

      // Best-effort read receipt (typing preferences hierarchy decides).
      try {
        const { markReadSoon } = await import('./utils/typingHelper.js');
        markReadSoon(sock, sender, msg.key);
      } catch { /* read receipts must never break message flow */ }

      // Ignore messages from blocked users (admins bypass the block list).
      if (blockedUsers.isBlocked(sender) && !isAdminOperator(sender)) return;

      // Extract text from different message types
      let text = '';
      let documentBuffer = null;
      if (msg.message.conversation) {
        text = msg.message.conversation;
      } else if (msg.message.extendedTextMessage?.text) {
        text = msg.message.extendedTextMessage.text;
      } else if (msg.message.imageMessage?.caption) {
        text = msg.message.imageMessage.caption;
      } else if (msg.message.videoMessage?.caption) {
        text = msg.message.videoMessage.caption;
      } else if (msg.message.documentMessage) {
        try {
          const { downloadMediaMessage } = await import('@whiskeysockets/baileys');
          const buf = await downloadMediaMessage(msg, 'buffer', {}, {
            logger,
            reuploadRequest: sock.updateMediaMessage
          });
          documentBuffer = buf;
        } catch (dlErr) {
          logger.warn({ err: dlErr }, 'Failed to download document');
        }
      }

      if (!text && !documentBuffer) return;

      // Count every incoming user message toward their "messages sent" stat.
      await trackUserMessage(sender);

      const session = sessionManager.getSession(sender, chatId);
      const trimmedText = (text || '').trim();
      const isCommand = text.startsWith(config.prefix);

      if (session?.isEndingTestSession === true) return;

      // Any new message cancels a pending /start hint: the user is demonstrably
      // present, so nudging them to type /start would be noise.
      cancelStartHint(sender);

      // /try end must interrupt anything (Part 1).
      //
      // The language-selection gate below rejects any input while a test user
      // has no language, which trapped the admin: they could not leave try mode
      // from the exact screen they were trying to leave. This intercept sits
      // ahead of the cooldown check, the onboarding stage check, language
      // enforcement, chat-rule matching and command dispatch, and the return
      // guarantees no other handler sees the message.
      if (/^\/try[\s]+(end|exit|stop)$/i.test(trimmedText) && session?.isTestActive) {
        try {
          const { endTrySession } = await import('./handlers/tryCommand.js');
          await endTrySession({ sock, sender, chatId, pushName, text: trimmedText });
        } catch (err) {
          logger.error({ err, sender }, '[TRY] endTrySession failed');
        }
        return;
      }

      // Resolve the user's language once per message for localized feedback.
      const userInfo = await getUserByJid(sender);
      const language = userInfo?.language || config.defaultLanguage;
      const tr = (key, params) => toSmallCaps(t(language, key, params));

      // Speaker coordinator (Prompt C).
      //
      // Exactly one flow answers each inbound message. Previously the
      // welcome-back greeting, the cooldown-expiry branch and the onboarding
      // gate could all fire on the same input and produce two or three replies.
      {
        const seen = recordLastSeen(sender, userInfo);
        const speaker = pickSpeaker({
          user: userInfo,
          session,
          gap: seen.gap
        });

        // A pending resume confirmation outranks everything, including
        // commands: the only valid input is yes or no.
        if (session?.awaitingResumeConfirmation === true) {
          await handleResumeReply({ sock, sender, chatId, pushName, text: trimmedText }, session, userInfo);
          return;
        }

        // Cooldown expiry and "came back later" share one prompt. The lock has
        // already expired by the time we get here, so it is released now.
        if (speaker === 'cooldown' || speaker === 'resume') {
          sessionManager.setState(sender, chatId, {
            awaitingResumeConfirmation: true,
            resumeFromStage: session?.onboardingStage || 'confirm_detected',
            cooldownJustExpired: false,
            languageOnboardingLockedUntil: null
          });
          await sendResumePrompt(
            { sock, sender, chatId, pushName },
            session,
            userInfo,
            seen.gap
          );
          logger.info(
            { sender, speaker, gapMs: seen.gap },
            '[RESUME] prompt sent, message consumed'
          );
          return;
        }

        // Welcome-back applies only to a finished user; a half-onboarded one
        // gets the resume prompt above instead.
        if (speaker === 'welcomeBack') {
          const gate = shouldWelcomeBack({
            user: userInfo,
            session,
            gap: seen.gap,
            previousLastSeen: seen.previous,
            enabled: isWelcomeBackEnabled()
          });
          if (gate.ok) {
            const wb = buildWelcomeBackMessage(userInfo, gate.gap, { livePushName: msg.pushName, jid: sender });
            await sendText(sock, sender, renderWelcomeBack(wb, language), { type: 'silent' });
            if (wb.showTip) settingsService.updateSettings(welcomeBackTipShownPatch());
            // Not sent when the message is a command that answers itself --
            // /start would otherwise send the menu twice.
            if (!isCommand) {
              sessionManager.setState(sender, chatId, { currentMenu: 'main' });
              await sendMigratedMainMenu({
                sock, sender, chatId, user: userInfo, language, transitionKey: 'welcome_back'
              });
            }
            logger.info(
              { sender, gapMs: gate.gap, variant: wb.variant, category: wb.category },
              '[WELCOME] greeted a returning user'
            );
            // Welcome-back is one of the two things that schedules the /start
            // hint. The menu below (or the command's own reply) cancels it.
            try {
              const { scheduleStartHint } = await import('./services/startHintService.js');
              scheduleStartHint(sender, { sock, sender, chatId, user: userInfo, session }, 'welcomeBack');
            } catch { /* a missing hint must never break a greeting */ }
          }
        }
      }

      // Smart first-time language onboarding owns the reply while active and
      // outranks every other flow, commands included (A8/C2). Also the silent
      // cooldown lock. Returns true when the message was consumed.
      {
        const { handleLanguageOnboardingGate } = await import('./handlers/languageOnboardingHandler.js');
        const consumed = await handleLanguageOnboardingGate(
          { sock, sender, chatId, pushName, text, deviceLocale: msg?.deviceLocale },
          session,
          userInfo
        );
        if (consumed) return;
      }

      if (isCommand && session?.currentMenu === 'language_selection' && !userInfo?.language) {
        // A /try control command must never be swallowed by the language gate
        // (Part 1): during try mode the test user has no language, so this is
        // exactly where "/try end" used to die.
        if (!/^\/try(\s|$)/i.test(trimmedText)) {
          await sendText(sock, sender, tr('conversation.languageGate'));
          await sendMenu({ sock, sender, chatId, text: buildLanguageMenu(), transitionKey: 'language_selection' });
        }
        sessionManager.setState(sender, chatId, { currentMenu: 'language_selection', isLanguageSelectionPending: true });
        return;
      }

      // Sleeping users can only wake with the /start command.
      if (session?.isSleeping) {
        if (isCommand && text.slice(config.prefix.length).trim().toLowerCase() === 'start') {
          if (settingsService.getSettings().sleepAnimationEnabled) {
            await runWakeAnimation({ sock, sender, chatId, pushName, language });
          } else {
            await wakeWithoutAnimation({ sock, sender, chatId, pushName, language });
          }
        } else {
          await sendSleepingReminder({ sock, sender, chatId, language });
        }
        return;
      }

      // Track last activity for profile display.
      await updateLastActive(sender);

      // Maintenance mode: block all non-admin commands and menu interactions.
      const settings = settingsService.getSettings();
      if (settings.maintenanceMode) {
        if (isAdminOperator(sender)) {
          maintenanceNotified.delete(sender);
        } else {
          if (!maintenanceNotified.has(sender)) {
            maintenanceNotified.add(sender);
            await sendText(sock, sender,
              '>*' + tr('common.maintenanceHeading') + '*\n\n' +
              tr('common.maintenanceNotice')
            );
          }
              if (testSessionIsEnding(sender, chatId)) return;
              if (!await sendTestAnimationMenu({ sock, sender, chatId, text: sleepAnimationText(language, 'sleep.preparing', dots, emoji), transitionKey: 'sleep_animation' })) return;
        }
      } else if (maintenanceNotified.size > 0) {
            if (testSessionIsEnding(sender, chatId)) return;
        maintenanceNotified.clear();
      }

      // Global help navigation (tutorial from main menu / standalone /help).
      // Inline help (option 9 in menus) keeps its per-menu static content and
      // returns to the source menu on `0`. Commands are handled before this
      // block so they always interrupt the help menu.
      if (session?.currentMenu === 'help' && !isCommand) {
        const helpFrom = session.helpFrom || 'command';

        // Legacy inline help (option 9): back returns to the source menu.
        if (helpFrom !== 'main' && helpFrom !== 'command') {
          if (trimmedText === '0') {
            await returnFromHelp({ sender, chatId, pushName });
          } else {
            await sendText(sock, sender, tr('common.reply0Back'));
          }
          return;
        }

        const lang = userInfo?.language || config.defaultLanguage;
        const info = await getHelpPage({ language: lang, page: session.helpPage || 1, isAdmin: isAdminOperator(sender), origin: helpFrom });

        if (trimmedText === '0') {
          if (helpFrom === 'main') {
            // Back: return to the main menu, resetting pagination state.
            sessionManager.setState(sender, chatId, { currentMenu: 'main', helpPage: null, helpFrom: null });
            await sendMigratedMainMenu({ sock, sender, chatId, user: userInfo, language: lang, transitionKey: 'help_back_to_main' });
          } else {
            // Cancel: delete the help message and clear the session. If the
            // deletion fails (e.g. message too old), just clear the session.
            const lastKey = session.lastMenuKey;
            if (lastKey) {
              try {
                await sock.sendMessage(sender, { delete: lastKey });
              } catch (err) {
                logger.warn({ err }, 'Help cancel delete failed');
              }
            }
            sessionManager.clear(sender, chatId);
          }
          return;
        }

        if (/^\d+$/.test(trimmedText)) {
          if (info.seeMore != null && trimmedText === String(info.seeMore)) {
            const next = await getHelpPage({ language: lang, page: (session.helpPage || 1) + 1, isAdmin: isAdminOperator(sender), origin: helpFrom });
            sessionManager.setState(sender, chatId, {
              currentMenu: 'help',
              helpPage: (session.helpPage || 1) + 1,
              helpFrom
            });
            await sendMenu({ sock, sender, chatId, text: next.text, transitionKey: 'help_to_help_page' });
          } else {
            // No "See More" on this page / wrong number: keep the menu shown.
            await sendText(sock, sender, tr('common.invalidChoiceValid'));
          }
          return;
        }

        await sendText(sock, sender, tr('common.invalidChoiceValid'));
        return;
      }

      // Cooldown: only for commands and numeric menu actions.
      if (applyCooldown(sender, isActionText(session, trimmedText, isCommand))) {
        await sendText(sock, sender, tr('common.cooldown'));
        return;
      }

      // Admin-lock: while a process is running, block non-zero admin input and
      // allow 0 to cancel. Must run before any other menu/command handling.
      const isTryEndCommand = isCommand && /^try\s+end(?:\s|$)/i.test(text.slice(config.prefix.length).trim());
      if (session?.isProcessing === true && !isTryEndCommand) {
        const consumed = await handleProcessingInterrupt({ sock, sender, chatId, pushName }, trimmedText);
        if (consumed) return;
      }

      // Commands always interrupt interactive menus: a valid command overrides
      // the session (menu commands set the new menu themselves), while an
      // unknown command replies with an error and keeps the current session.
      if (isCommand) {
        const [cmdName, ...args] = text.slice(config.prefix.length).trim().split(/\s+/);
        const permissionJid = session?.isTestActive && session.testSession?.testUserJid && cmdName.toLowerCase() !== 'try'
          ? session.testSession.testUserJid
          : sender;
        await dispatchCommand({
          commands,
          cmdName,
          args,
          context: { sock, sender, chatId, pushName },
          language,
          tr,
          isAdminOperator,
          permissionJid,
          isGroup: chatId.endsWith('@g.us'),
          spamTimestamps,
          spamThreshold: config.spamThreshold,
          spamWindowMs: config.spamWindowMs
        });
        return;
      }

      // Migrated menu cluster (Phases 5-6): session keeps legacy ids, the
      // registry speaks new ids. Runs before all specific menu branches so
      // numbered inputs never fall through to chat rule matching. Phases 3-4
      // states keep their existing dedicated branches below (untouched).
      const migratedChatFaqId = {
        chat_faq_menu: 'chat_faq',
        chat_responses_main: 'chat_responses',
        chat_settings: 'chat_settings',
        chat_snippets: 'snippets',
        chat_test_panel: 'test_panel',
        chat_import_export: 'chat_import_export',
        admin: 'adminPanel',
        admin_quick_actions: 'quick_actions',
        broadcast_submenu: 'broadcast',
        admin_users: 'user_management',
        system_settings: 'system_settings',
        admin_backup: 'backup_restore',
        logs: 'logs',
        admin_search: 'admin_search',
        admin_scheduled_tasks: 'scheduled_tasks',
        command_analytics: 'analytics',
        settings: 'settings',
        stats_main: 'statistics',
        tutorial_main: 'tutorial',
        tutorial_getting_started: 'tutorial_getting_started',
        tutorial_profile_guide: 'tutorial_profile_guide',
        tutorial_settings: 'tutorial_settings_prefs',
        tutorial_selfdestruct: 'tutorial_self_destruct',
        tutorial_feedback: 'tutorial_feedback',
        tutorial_what_new: 'tutorial_whats_new',
        info: 'info',
        info_about: 'info_about',
        info_version: 'info_version',
        info_developer: 'info_developer',
        info_website: 'info_website',
        feedback_main: 'feedback',
        faq_main: 'faq',
        faq_add: 'faq_add',
        faq_view: 'faq_view',
        faq_manage: 'faq_manage',
        faq_import_export: 'faq_import_export',
        faq_stats: 'faq_stats',
        faq_search: 'faq_search',
        chat_snippet_impex: 'snippet_impex',
        bot_notifications: 'bot_notifications',
        message_display: 'message_display',
        message_display_admin: 'message_display_admin',
        changelog_manager: 'changelog_manager'
      }[session?.currentMenu || ''];
      if (migratedChatFaqId) {
        // Legacy parity: admin-only menus ignore non-admin input entirely.
        // User-facing menus (settings, stats, tutorial, info, feedback) skip this.
        if (['chat_faq_menu', 'chat_responses_main', 'chat_settings', 'chat_snippets', 'chat_test_panel', 'chat_import_export', 'admin', 'admin_quick_actions', 'broadcast_submenu', 'admin_users', 'system_settings', 'admin_backup', 'logs', 'admin_search', 'admin_scheduled_tasks', 'command_analytics', 'faq_main', 'faq_add', 'faq_view', 'faq_manage', 'faq_import_export', 'faq_stats', 'faq_search', 'chat_snippet_impex', 'bot_notifications', 'message_display', 'message_display_admin', 'changelog_manager'].includes(session?.currentMenu || '')) {
          if (!isAdminOperator(sender)) return;
        }
        const clusterUser = await getUserByJid(sender);
        const clusterLang = clusterUser?.language || config.defaultLanguage;
        const legacyMenu = session.currentMenu;
        // Legacy parity: '9' in user settings opens help (mirrors the
        // inline-help branch below, which runs later).
        if (legacyMenu === 'settings' && trimmedText === '9') {
          await showHelpFor({ sender, chatId }, 'settings');
          return;
        }
        const { resolveMenuOption, runMenuAction } = await import('./utils/menuRouter.js');
        const { sendMenuById } = await import('./utils/menuSender.js');
        const { allMenuCustomHandlers } = await import('./utils/menuCustomHandlers.js');
        const { sendText: clusterSendText } = await import('./services/messageService.js');
        const { toSmallCaps: clusterCaps } = await import('./utils/smallCaps.js');
        const { t: clusterT } = await import('./services/localeService.js');
        const clusterInvalid = async (max) => {
          await clusterSendText(sock, sender, clusterCaps(clusterT(clusterLang, 'common.invalidChoiceMinMax', { min: 0, max })));
        };
        // Free-text / legacy-processed panels: render migrated, input stays
        // fully on legacy processors (test panel, admin search, scheduled
        // tasks with its cancel/pagination numbers).
        if (legacyMenu === 'chat_test_panel' && trimmedText !== '0') {
          const { handleChatTestPanelReply } = await import('./handlers/adminCommand.js');
          await handleChatTestPanelReply({ sock, sender, chatId, pushName }, trimmedText);
          return;
        }
        if (legacyMenu === 'admin_search') {
          const { handleAdminSearchReply } = await import('./handlers/adminCommand.js');
          await handleAdminSearchReply({ sock, sender, chatId, pushName }, trimmedText);
          return;
        }
        if (legacyMenu === 'admin_scheduled_tasks') {
          const { handleScheduledTasksReply } = await import('./handlers/adminCommand.js');
          await handleScheduledTasksReply({ sock, sender, chatId, pushName }, trimmedText);
          return;
        }
        // Inline help fallback. Only fires when the current menu definition has
        // NO option with this number — otherwise a real option (e.g. system
        // settings 9/10, user management 9/10) would be shadowed by help.
        if (trimmedText === '9' || trimmedText === '10') {
          const { getMenu: getRegisteredMenu } = await import('./config/menus/registry.js');
          const def = getRegisteredMenu(migratedChatFaqId);
          let hasOption = false;
          if (def && typeof def.dynamicOptions === 'function') {
            try { hasOption = (def.dynamicOptions() || []).some((o) => String(o.number) === trimmedText); } catch { hasOption = false; }
          } else if (Array.isArray(def?.options)) {
            hasOption = def.options.some((o) => String(o.number) === trimmedText);
          }
          if (!hasOption) {
            await showHelpFor({ sender, chatId }, legacyMenu);
            return;
          }
        }
        const clusterResult = resolveMenuOption(migratedChatFaqId, trimmedText, clusterUser, clusterLang);
        if (clusterResult.kind === 'back') {
          if (clusterResult.to === 'adminPanel') {
            const { sendAdminPanel } = await import('./handlers/adminCommand.js');
            const backKey = {
              chat_faq_menu: 'chat_faq_to_admin', admin_backup: 'backup_to_admin', admin_logs: 'logs_to_admin',
              admin_users: 'users_to_admin', system_settings: 'system_to_admin', broadcast_submenu: 'broadcast_to_admin',
              admin_quick_actions: 'admin_panel', command_analytics: 'admin_panel', admin_search: 'admin_panel',
              admin_scheduled_tasks: 'admin_panel', chat_import_export: 'chat_faq_to_admin'
            }[legacyMenu] || 'admin_panel';
            await sendAdminPanel({ sock, sender, chatId, pushName }, { transitionKey: backKey });
            return;
          }
          if (clusterResult.to === 'main_menu') {
            const { sendMainMenuBack } = await import('./handlers/startCommand.js');
            const mainBackKey = {
              settings: 'main_to_main', stats_main: 'stats_back_to_main', tutorial_main: 'tutorial_to_main',
              info: 'info_back_to_main', feedback_main: 'feedback_back_to_main'
            }[legacyMenu] || 'admin_to_main';
            await sendMainMenuBack({ sock, sender, chatId, pushName }, mainBackKey);
            return;
          }
          await sendMenuById(clusterResult.to, { sock, sender, chatId, user: clusterUser, language: clusterLang });
          return;
        }
        if (clusterResult.kind === 'action') {
          await runMenuAction(clusterResult.action, {
            sock, sender, chatId, pushName, user: clusterUser, language: clusterLang, commands,
            sendMenuFn: async (menuId) => sendMenuById(menuId, { sock, sender, chatId, user: clusterUser, language: clusterLang }),
            handlers: allMenuCustomHandlers
          });
          return;
        }
        // Invalid: legacy per-state behavior (menu stays as-is).
        if (legacyMenu === 'chat_faq_menu') {
          const { sendChatFaqMenu } = await import('./handlers/adminCommand.js');
          await sendChatFaqMenu({ sock, sender, chatId, pushName });
          return;
        }
        if (legacyMenu === 'chat_responses_main') {
          await clusterSendText(sock, sender, tr('chatResponses.invalidNumber', { min: 0, max: 6 }));
          return;
        }
        if (legacyMenu === 'chat_settings') {
          const { sendChatSettingsPanel } = await import('./handlers/adminCommand.js');
          await clusterInvalid(35);
          await sendChatSettingsPanel({ sock, sender, chatId, pushName });
          return;
        }
        if (legacyMenu === 'chat_snippets') {
          const { sendSnippetsMenu } = await import('./handlers/chatCommand.js');
          await sendSnippetsMenu({ sock, sender, chatId, pushName });
          return;
        }
        if (legacyMenu === 'chat_import_export') {
          await clusterInvalid(8);
          return;
        }
        if (legacyMenu === 'admin') {
          await clusterInvalid(13);
          return;
        }
        if (legacyMenu === 'admin_quick_actions') {
          await clusterInvalid(5);
          return;
        }
        if (legacyMenu === 'broadcast_submenu') {
          await clusterInvalid(3);
          return;
        }
        if (legacyMenu === 'admin_users') {
          const { sendUserManagementMenu } = await import('./handlers/userManagementCommand.js');
          await sendUserManagementMenu({ sock, sender, chatId, pushName });
          return;
        }
        if (legacyMenu === 'system_settings') {
          await clusterInvalid(8);
          return;
        }
        if (legacyMenu === 'admin_backup') {
          const { sendAdminBackupMenu } = await import('./handlers/adminCommand.js');
          await sendAdminBackupMenu({ sock, sender, chatId, pushName });
          return;
        }
        if (legacyMenu === 'admin_logs') {
          const { sendAdminLogsMenu } = await import('./handlers/adminCommand.js');
          await sendAdminLogsMenu({ sock, sender, chatId, pushName });
          return;
        }
        if (legacyMenu === 'command_analytics') {
          await clusterInvalid(2);
          return;
        }
        if (legacyMenu === 'logs') {
          await clusterInvalid(2);
          return;
        }
        if (legacyMenu === 'admin') {
          await clusterInvalid(13);
          return;
        }
        if (legacyMenu === 'admin_quick_actions') {
          await clusterInvalid(5);
          return;
        }
        if (legacyMenu === 'broadcast_submenu') {
          await clusterInvalid(3);
          return;
        }
        if (legacyMenu === 'admin_users') {
          const { sendUserManagementMenu } = await import('./handlers/userManagementCommand.js');
          await sendUserManagementMenu({ sock, sender, chatId, pushName });
          return;
        }
        if (legacyMenu === 'system_settings') {
          await clusterInvalid(8);
          return;
        }
        if (legacyMenu === 'admin_backup') {
          const { sendAdminBackupMenu } = await import('./handlers/adminCommand.js');
          await sendAdminBackupMenu({ sock, sender, chatId, pushName });
          return;
        }
        // Phase-7 invalid paths: re-dispatch legacy processors with the
        // original input (exact edge behavior preserved).
        if (legacyMenu === 'settings') {
          await clusterSendText(sock, sender, clusterCaps(clusterT(clusterLang, 'common.invalidChoiceValid')));
          return;
        }
        if (legacyMenu === 'stats_main') {
          const { handleStatsReply } = await import('./handlers/statsCommand.js');
          await handleStatsReply({ sock, sender, chatId, pushName }, trimmedText);
          return;
        }
        if ((legacyMenu || '').startsWith('tutorial_')) {
          const { handleTutorialReply } = await import('./handlers/tutorialCommand.js');
          await handleTutorialReply({ sock, sender, chatId, pushName, language: clusterLang, commands, isAdmin: isAdminOperator(sender), user: clusterUser }, trimmedText);
          return;
        }
        if (legacyMenu === 'info' || (legacyMenu || '').startsWith('info_')) {
          const { handleInfoReply } = await import('./handlers/infoCommand.js');
          await handleInfoReply({ sock, sender, chatId, pushName }, trimmedText);
          return;
        }
        if (legacyMenu === 'feedback_main') {
          const { handleFeedbackReply } = await import('./handlers/feedbackCommand.js');
          await handleFeedbackReply({ sock, sender, chatId, pushName }, trimmedText);
          return;
        }
        if (legacyMenu === 'faq_main') {
          const { handleFaqMain } = await import('./handlers/faqCommand.js');
          await handleFaqMain({ sock, sender, chatId, pushName }, trimmedText);
          return;
        }
        if (['faq_add', 'faq_view', 'faq_manage', 'faq_import_export', 'faq_stats'].includes(legacyMenu)) {
          const { handleFaqAddMenu, handleFaqViewMenu, handleFaqManageMenu, handleFaqImportExportMenu, handleFaqStatsPanel } = await import('./handlers/faqCommand.js');
          const subHandlers = { faq_add: handleFaqAddMenu, faq_view: handleFaqViewMenu, faq_manage: handleFaqManageMenu, faq_import_export: handleFaqImportExportMenu, faq_stats: handleFaqStatsPanel };
          await subHandlers[legacyMenu]({ sock, sender, chatId, pushName }, trimmedText);
          return;
        }
        if (legacyMenu === 'faq_search') {
          const { handleFaqSearchPrompt } = await import('./handlers/faqCommand.js');
          await handleFaqSearchPrompt({ sock, sender, chatId, pushName }, trimmedText);
          return;
        }
        if (legacyMenu === 'chat_snippet_impex') {
          const { handleSnippetImpex } = await import('./handlers/chatCommand.js');
          await handleSnippetImpex({ sock, sender, chatId, pushName }, trimmedText);
          return;
        }
        return;
      }

      if (['try_timer', 'try_timer_custom', 'try_timer_confirmation'].includes(session?.currentMenu)) {
        await handleTryReply({ sock, sender, chatId, pushName }, trimmedText);
        return;
      }

        // Inline help selection (option 9) in interactive menus
      if (['main', 'admin', 'test_submenu', 'backup_restore', 'system_settings', 'conversation_settings', 'language_selection', 'settings', 'admin_users', 'admin_chat_faq', 'admin_backup', 'admin_logs'].includes(session?.currentMenu) && ((trimmedText === '9' && session?.currentMenu !== 'admin') || (session?.currentMenu === 'admin' && trimmedText === '13') || (session?.currentMenu === 'system_settings' && trimmedText === '10'))) {
        await showHelpFor({ sender, chatId }, session.currentMenu);
        return;
      }

      // Language selection
      if (session?.currentMenu === 'language_selection') {
        if (/^[1-5]$/.test(trimmedText)) {
          await handleLanguageSelection({ sock, sender, chatId, pushName }, trimmedText);
        } else if (!userInfo?.language) {
          // Safety net: never trap a /try control command behind the language
          // gate (Part 1). It falls through to command dispatch instead.
          if (!/^\/try(\s|$)/i.test(trimmedText)) {
            sessionManager.setState(sender, chatId, { isLanguageSelectionPending: true });
            await sendText(sock, sender, tr('conversation.languageGate'));
            await sendMenu({ sock, sender, chatId, text: buildLanguageMenu(), transitionKey: 'language_selection' });
          }
        } else {
          await sendText(sock, sender, tr('common.invalidChoiceMinMax', { min: 1, max: 5 }));
        }
        return;
      }

      // Confirmation reply for pending admin actions.
      // Some flows use 0 to go back and custom options like Enable/Disable.
      if (session?.currentMenu === 'confirmation') {
        if (['0', '1', '2'].includes(trimmedText)) {
          await handleConfirmationReply({ sock, sender, chatId, pushName }, trimmedText);
        } else {
          await sendText(sock, sender, tr('common.pleaseYesNo'));
        }
        return;
      }

      // Admin panel reply
      if (session?.currentMenu === 'admin') {
        if (/^(1[0-3]|[0-9])$/.test(trimmedText)) {
          await handleAdminReply({ sock, sender, chatId, pushName }, trimmedText);
        } else {
          await sendText(sock, sender, tr('common.invalidChoiceValid'));
        }
        return;
      }

      // Admin quick actions reply
      if (session?.currentMenu === 'admin_quick_actions') {
        if (/^[0-5]$/.test(trimmedText)) {
          await handleQuickActionsReply({ sock, sender, chatId, pushName }, trimmedText);
        } else {
          await sendText(sock, sender, tr('common.invalidChoiceMinMax', { min: 0, max: 5 }));
        }
        return;
      }

      if (session?.currentMenu === 'admin_quick_confirm') {
        if (/^[0-2]$/.test(trimmedText)) {
          await handleQuickConfirmReply({ sock, sender, chatId, pushName }, trimmedText);
        } else {
          await sendText(sock, sender, tr('common.invalidChoiceMinMax', { min: 0, max: 2 }));
        }
        return;
      }

      // Admin search reply (free-text keyword stage)
      if (session?.currentMenu === 'admin_search') {
        await handleAdminSearchReply({ sock, sender, chatId, pushName }, trimmedText);
        return;
      }

      if (session?.currentMenu === 'admin_search_results') {
        if (/^([0-9]|10)$/.test(trimmedText)) {
          await handleAdminSearchResultsReply({ sock, sender, chatId, pushName }, trimmedText);
        } else {
          await sendText(sock, sender, tr('common.invalidChoice'));
        }
        return;
      }

      if (session?.currentMenu === 'admin_search_detail') {
        if (trimmedText === '0') {
          await handleAdminSearchDetailReply({ sock, sender, chatId, pushName }, trimmedText);
        } else {
          await sendText(sock, sender, tr('common.reply0Back'));
        }
        return;
      }

      // Scheduled tasks overview reply
      if (session?.currentMenu === 'admin_scheduled_tasks') {
        if (/^([0-9]|10)$/.test(trimmedText)) {
          await handleScheduledTasksReply({ sock, sender, chatId, pushName }, trimmedText);
        } else {
          await sendText(sock, sender, tr('common.invalidChoice'));
        }
        return;
      }

      if (session?.currentMenu === 'admin_scheduled_detail') {
        if (/^[0-1]$/.test(trimmedText)) {
          await handleScheduledTaskDetailReply({ sock, sender, chatId, pushName }, trimmedText);
        } else {
          await sendText(sock, sender, tr('common.invalidChoiceMinMax', { min: 0, max: 1 }));
        }
        return;
      }

      // Emergency commands reply
      if (session?.currentMenu === 'admin_emergency') {
        if (/^[0-4]$/.test(trimmedText)) {
          await handleEmergencyReply({ sock, sender, chatId, pushName }, trimmedText);
        } else {
          await sendText(sock, sender, tr('common.invalidChoiceMinMax', { min: 0, max: 4 }));
        }
        return;
      }

      if (session?.currentMenu === 'admin_emergency_confirm') {
        if (/^[0-2]$/.test(trimmedText)) {
          await handleEmergencyConfirmReply({ sock, sender, chatId, pushName }, trimmedText);
        } else {
          await sendText(sock, sender, tr('common.invalidChoiceMinMax', { min: 0, max: 2 }));
        }
        return;
      }

      // Role management reply
      if (session?.currentMenu === 'admin_roles') {
        if (/^[0-2]$/.test(trimmedText)) {
          await handleRolesReply({ sock, sender, chatId, pushName }, trimmedText);
        } else {
          await sendText(sock, sender, tr('common.invalidChoiceMinMax', { min: 0, max: 2 }));
        }
        return;
      }

      if (session?.currentMenu === 'admin_roles_user') {
        await handleRolesUserReply({ sock, sender, chatId, pushName }, trimmedText);
        return;
      }

      if (session?.currentMenu === 'admin_roles_set') {
        if (/^[0-5]$/.test(trimmedText)) {
          await handleRolesSetReply({ sock, sender, chatId, pushName }, trimmedText);
        } else {
          await sendText(sock, sender, tr('common.invalidChoiceMinMax', { min: 0, max: 5 }));
        }
        return;
      }

      if (['admin_users', 'chat_faq_menu', 'chat_stats', 'chat_import_export', 'admin_backup', 'admin_logs'].includes(session?.currentMenu)) {
        if (session.currentMenu === 'admin_users') {
          await handleUserManagementReply({ sock, sender, chatId, pushName, language }, trimmedText);
        } else {
          await handleGroupedAdminReply({ sock, sender, chatId, pushName }, session.currentMenu, trimmedText);
        }
        return;
      }

      if (session?.currentMenu === 'chat_ie_import') {
        if (!isAdminOperator(sender)) return;
        await handleCombinedImportInput({ sock, sender, chatId, pushName }, trimmedText);
        return;
      }
      if (session?.currentMenu === 'chat_ie_policy') {
        if (!isAdminOperator(sender)) return;
        await handleCombinedImportPolicy({ sock, sender, chatId, pushName }, trimmedText);
        return;
      }
      if (session?.currentMenu === 'chat_test_panel') {
        if (!isAdminOperator(sender)) return;
        await handleChatTestPanelReply({ sock, sender, chatId, pushName }, trimmedText);
        return;
      }
      if (session?.currentMenu === 'chat_performance_dashboard') {
        if (!isAdminOperator(sender)) return;
        await sendChatFaqStatsPanel({ sock, sender, chatId, pushName });
        return;
      }
      if (session?.currentMenu === 'chat_reply_analytics') {
        if (!isAdminOperator(sender)) return;
        await handleReplyAnalyticsMenu({ sock, sender, chatId, pushName }, trimmedText);
        return;
      }
      if (session?.currentMenu === 'chat_reply_analytics_detail') {
        if (!isAdminOperator(sender)) return;
        await handleRuleAnalyticsDetail({ sock, sender, chatId, pushName }, trimmedText);
        return;
      }
      if (session?.currentMenu === 'chat_reply_analytics_reset') {
        if (!isAdminOperator(sender)) return;
        await handleReplyAnalyticsReset({ sock, sender, chatId, pushName }, trimmedText);
        return;
      }
      if (session?.currentMenu === 'chat_analytics_import') {
        if (!isAdminOperator(sender)) return;
        const content = documentBuffer ? documentBuffer.toString('utf8') : trimmedText;
        await handleAnalyticsImportInput({ sock, sender, chatId, pushName }, content);
        return;
      }
      if (session?.currentMenu === 'chat_settings_context_boost') {
        if (!isAdminOperator(sender)) return;
        await handleContextBoostMenu({ sock, sender, chatId, pushName }, trimmedText);
        return;
      }
      if (session?.currentMenu === 'chat_settings_rate_limit_max') {
        if (!isAdminOperator(sender)) return;
        await handleRateLimitMaxMenu({ sock, sender, chatId, pushName }, trimmedText);
        return;
      }
      if (session?.currentMenu === 'chat_settings_rate_limit_window') {
        if (!isAdminOperator(sender)) return;
        await handleRateLimitWindowMenu({ sock, sender, chatId, pushName }, trimmedText);
        return;
      }
      if (session?.currentMenu === 'chat_settings_snippet_depth') {
        if (!isAdminOperator(sender)) return;
        await handleSnippetDepthMenu({ sock, sender, chatId, pushName }, trimmedText);
        return;
      }
      if (session?.currentMenu === 'chat_settings_typing_targeting') {
        if (!isAdminOperator(sender)) return;
        await handleTypingTargetingMenu({ sock, sender, chatId, pushName }, trimmedText);
        return;
      }
      if (session?.currentMenu === 'chat_settings_typing_type') {
        if (!isAdminOperator(sender)) return;
        await handleTypingDefaultTypeMenu({ sock, sender, chatId, pushName }, trimmedText);
        return;
      }
      if (session?.currentMenu === 'chat_rate_limit_log') {
        if (!isAdminOperator(sender)) return;
        if (trimmedText === '0') await sendChatFaqStatsPanel({ sock, sender, chatId, pushName });
        else await showRateLimitLogMenu({ sock, sender, chatId, pushName });
        return;
      }
      if (session?.currentMenu === 'chat_dryrun_log') {
        if (!isAdminOperator(sender)) return;
        await handleDryRunLogMenu({ sock, sender, chatId, pushName }, trimmedText);
        return;
      }
      if (session?.currentMenu === 'chat_dryrun_log_detail') {
        if (!isAdminOperator(sender)) return;
        await showDryRunLogMenu({ sock, sender, chatId, pushName });
        return;
      }
      if (session?.currentMenu === 'chat_dryrun_log_clear') {
        if (!isAdminOperator(sender)) return;
        await handleDryRunLogClear({ sock, sender, chatId, pushName }, trimmedText);
        return;
      }
      if (session?.currentMenu === 'chat_settings') {
        if (!isAdminOperator(sender)) return;
        await handleChatSettingsReply({ sock, sender, chatId, pushName }, trimmedText);
        return;
      }
      if (session?.currentMenu === 'chat_settings_fuzzy') {
        if (!isAdminOperator(sender)) return;
        await handleChatSettingsFuzzy({ sock, sender, chatId, pushName }, trimmedText);
        return;
      }
      if (session?.currentMenu === 'chat_settings_cooldown') {
        if (!isAdminOperator(sender)) return;
        await handleChatSettingsCooldown({ sock, sender, chatId, pushName }, trimmedText);
        return;
      }
      if (session?.currentMenu === 'chat_settings_fallback') {
        if (!isAdminOperator(sender)) return;
        await handleChatSettingsFallback({ sock, sender, chatId, pushName }, trimmedText);
        return;
      }
      if (session?.currentMenu === 'chat_settings_priority') {
        if (!isAdminOperator(sender)) return;
        await handleChatSettingsPriority({ sock, sender, chatId, pushName }, trimmedText);
        return;
      }
      if (session?.currentMenu === 'chat_settings_max_replies') {
        if (!isAdminOperator(sender)) return;
        await handleChatSettingsMaxReplies({ sock, sender, chatId, pushName }, trimmedText);
        return;
      }
      if (session?.currentMenu === 'chat_settings_ignore_list') {
        if (!isAdminOperator(sender)) return;
        await handleChatSettingsIgnoreList({ sock, sender, chatId, pushName }, trimmedText);
        return;
      }
      if (session?.currentMenu === 'chat_settings_language_filter') {
        if (!isAdminOperator(sender)) return;
        await handleChatSettingsLanguageFilter({ sock, sender, chatId, pushName }, trimmedText);
        return;
      }
      if (session?.currentMenu === 'chat_settings_delay_override') {
        if (!isAdminOperator(sender)) return;
        await handleChatSettingsDelayOverride({ sock, sender, chatId, pushName }, trimmedText);
        return;
      }

      if (session?.currentMenu?.startsWith('user_management_')) {
        await handleUserManagementReply({ sock, sender, chatId, pushName, language }, trimmedText);
        return;
      }

      // Admin test submenu reply
      if (session?.currentMenu === 'test_submenu') {
        if (/^[0-5]$/.test(trimmedText)) {
          await handleTestReply({ sock, sender, chatId, pushName }, trimmedText);
        } else {
          await sendText(sock, sender, tr('common.invalidChoiceMinMax', { min: 0, max: 5 }));
        }
        return;
      }

      // Admin backup & restore submenu reply.
      // NOTE: the backup menu sets sessionMenu 'admin_backup', which is handled
      // by the migrated cluster branch before reaching here. This 'backup_restore'
      // branch was unreachable and advertised max 2 for a 3-option menu.

      // Admin system settings submenu reply
      // NOTE: currentMenu === 'system_settings' is handled earlier by the migrated
      // cluster branch (it returns before reaching here), so there is no legacy
      // switch for it any more — options come from the menu definition.

      // Grouped system settings submenus reply
      if (session?.currentMenu === 'general_settings') {
        // Mirror the rendered menu: 5 options + back, plus option 9
        // (Welcome Back Messages). 6-8 are unassigned, so they fall through
        // to the handler's invalid-choice branch.
        if (/^[0-9]$/.test(trimmedText)) {
          await handleGeneralSettingsReply({ sock, sender, chatId, pushName }, trimmedText);
        } else {
          await sendText(sock, sender, tr('common.invalidChoiceMinMax', { min: 0, max: 9 }));
        }
        return;
      }

      if (session?.currentMenu === 'admin_access') {
        // Mirror the rendered menu: 4 options + back (option 4 = Admin Management).
        if (/^[0-4]$/.test(trimmedText)) {
          await handleAdminAccessReply({ sock, sender, chatId, pushName }, trimmedText);
        } else {
          await sendText(sock, sender, tr('common.invalidChoiceMinMax', { min: 0, max: 4 }));
        }
        return;
      }

      if (session?.currentMenu === 'admin_access_add') {
        await handleAdminAccessAddInput({ sock, sender, chatId, pushName }, trimmedText);
        return;
      }

      if (session?.currentMenu === 'admin_access_remove') {
        await handleAdminAccessRemoveReply({ sock, sender, chatId, pushName }, trimmedText);
        return;
      }

      if (session?.currentMenu === 'admin_access_remove_confirm') {
        if (/^[0-2]$/.test(trimmedText)) {
          await handleAdminAccessRemoveConfirm({ sock, sender, chatId, pushName }, trimmedText);
        } else {
          await sendText(sock, sender, tr('common.invalidChoiceMinMax', { min: 0, max: 2 }));
        }
        return;
      }

      if (session?.currentMenu === 'notifications') {
        if (/^[0-2]$/.test(trimmedText)) {
          await handleNotificationsReply({ sock, sender, chatId, pushName }, trimmedText);
        } else {
          await sendText(sock, sender, tr('common.invalidChoiceMinMax', { min: 0, max: 2 }));
        }
        return;
      }

      if (session?.currentMenu === 'updates') {
        if (/^[0-1]$/.test(trimmedText)) {
          await handleUpdatesReply({ sock, sender, chatId, pushName }, trimmedText);
        } else {
          await sendText(sock, sender, tr('common.invalidChoiceMinMax', { min: 0, max: 1 }));
        }
        return;
      }

      if (session?.currentMenu === 'data_management') {
        if (/^[0-2]$/.test(trimmedText)) {
          await handleDataReply({ sock, sender, chatId, pushName }, trimmedText);
        } else {
          await sendText(sock, sender, tr('common.invalidChoiceMinMax', { min: 0, max: 2 }));
        }
        return;
      }

      if (session?.currentMenu === 'logs') {
        if (/^[0-2]$/.test(trimmedText)) {
          await handleLogsReply({ sock, sender, chatId, pushName }, trimmedText);
        } else {
          await sendText(sock, sender, tr('common.invalidChoiceMinMax', { min: 0, max: 2 }));
        }
        return;
      }

      // Conversation chat submenu reply (admin): free-text accepted on the
      // custom-duration stage, numeric choices elsewhere.
      if (['conversation_settings', 'conversation_temp_duration', 'conversation_temp_custom', 'conversation_notify_list'].includes(session?.currentMenu)) {
        await handleConversationReply({ sock, sender, chatId, pushName }, trimmedText);
        return;
      }

      // Feature flags submenu reply (admin)
      if (['feature_flags', 'change_marker_scope', 'change_marker_status_list', 'change_marker_bulk_confirm', 'change_marker_value', 'change_marker_custom_input', 'change_marker_bulk_confirm_value', 'marker_nav', 'marker_submenu_action', 'marker_picker', 'marker_change_confirm', 'marker_custom_input', 'status_change', 'status_confirm'].includes(session?.currentMenu)) {
        // Free-text stages (custom emoji, message input, schedule time) accept any input.
        // Paginated list needs 0-12 (10 items + Next/Previous), other pickers need
        // 0-6 — accept any integer here and let handleFeatureFlagsReply validate.
        const freeform = ['feature_marker_custom', 'feature_customize_msg_input', 'feature_schedule_time', 'feature_schedule_manual'].includes(session?.pendingAction);
        if (freeform || /^\d+$/.test(trimmedText)) {
          await handleFeatureFlagsReply({ sock, sender, chatId, pushName }, trimmedText);
        } else {
          await sendText(sock, sender, tr('common.invalidChoice'));
        }
        return;
      }

      // Error log viewer back (admin)
      if (session?.currentMenu === 'error_log') {
        if (trimmedText === '0') {
          await sendSystemSettingsPanel({ sock, sender, chatId, pushName });
        } else {
          await sendText(sock, sender, tr('common.reply0Back'));
        }
        return;
      }

      // Admin system settings bot-name input capture
      if (session?.currentMenu === 'system_settings_name_input') {
        await handleSystemSettingsNameInput({ sock, sender, chatId, pushName }, trimmedText);
        return;
      }

      // Broadcast input capture (admin) — send now
      if (session?.currentMenu === 'broadcast_input' && session?.broadcastReply === true) {
        await handleBroadcastInput({ sock, sender, chatId, pushName }, trimmedText);
        return;
      }

      // Broadcast submenu reply (admin)
      if (session?.currentMenu === 'broadcast_submenu') {
        if (/^[0-3]$/.test(trimmedText)) {
          await handleBroadcastReply({ sock, sender, chatId, pushName }, trimmedText);
        } else {
          await sendText(sock, sender, tr('common.invalidChoiceMinMax', { min: 0, max: 3 }));
        }
        return;
      }

      // Broadcast scheduling text/time capture (admin)
      if (session?.currentMenu === 'broadcast_schedule_text') {
        await handleBroadcastScheduleText({ sock, sender, chatId, pushName }, trimmedText);
        return;
      }
      if (session?.currentMenu === 'broadcast_schedule_time') {
        await handleBroadcastScheduleTime({ sock, sender, chatId, pushName }, trimmedText);
        return;
      }
      if (session?.currentMenu === 'broadcast_schedule_manual') {
        await handleBroadcastScheduleManual({ sock, sender, chatId, pushName }, trimmedText);
        return;
      }

      // Schedule submenu reply (admin)
      if (session?.currentMenu === 'broadcast_schedule') {
        if (/^[0-3]$/.test(trimmedText)) {
          await handleScheduleReply({ sock, sender, chatId, pushName }, trimmedText);
        } else {
          await sendText(sock, sender, tr('common.invalidChoiceMinMax', { min: 0, max: 3 }));
        }
        return;
      }

      // Schedule empty notice reply (admin)
      if (session?.currentMenu === 'broadcast_schedule_empty') {
        await handleScheduleEmptyReply({ sock, sender, chatId, pushName }, trimmedText);
        return;
      }

      // Schedule list selection (admin)
      if (session?.currentMenu === 'broadcast_schedule_list') {
        await handleScheduleListReply({ sock, sender, chatId, pushName }, trimmedText);
        return;
      }

      // Schedule detail reply (admin)
      if (session?.currentMenu === 'broadcast_schedule_detail') {
        if (/^[0-2]$/.test(trimmedText)) {
          await handleScheduleDetailReply({ sock, sender, chatId, pushName }, trimmedText);
        } else {
          await sendText(sock, sender, tr('common.invalidChoiceMinMax', { min: 0, max: 2 }));
        }
        return;
      }

      // Schedule edit reply (admin)
      if (session?.currentMenu === 'broadcast_schedule_edit') {
        if (/^[0-3]$/.test(trimmedText)) {
          await handleScheduleEditReply({ sock, sender, chatId, pushName }, trimmedText);
        } else {
          await sendText(sock, sender, tr('common.invalidChoiceMinMax', { min: 0, max: 3 }));
        }
        return;
      }

      // Schedule repeat selection (admin)
      if (session?.currentMenu === 'broadcast_schedule_repeat') {
        if (/^[0-5]$/.test(trimmedText)) {
          await handleBroadcastScheduleRepeat({ sock, sender, chatId, pushName }, trimmedText);
        } else {
          await sendText(sock, sender, tr('common.invalidChoiceMinMax', { min: 0, max: 5 }));
        }
        return;
      }

      // Schedule edit message capture (admin)
      if (session?.currentMenu === 'broadcast_schedule_edit_message') {
        await handleScheduleEditMessage({ sock, sender, chatId, pushName }, trimmedText);
        return;
      }

      // Manage users submenu reply (admin)
      if (session?.currentMenu === 'manage_users') {
        if (/^[0-3]$/.test(trimmedText)) {
          await handleManageUsersReply({ sock, sender, chatId, pushName }, trimmedText);
        } else {
          await sendText(sock, sender, tr('common.invalidChoiceMinMax', { min: 0, max: 3 }));
        }
        return;
      }

      // Manage users search/delete/block input capture (admin)
      if (session?.currentMenu === 'manage_users_search_input') {
        await handleManageUsersSearch({ sock, sender, chatId, pushName }, trimmedText);
        return;
      }
      if (session?.currentMenu === 'manage_users_delete_input') {
        await handleManageUsersDelete({ sock, sender, chatId, pushName }, trimmedText);
        return;
      }
      if (session?.currentMenu === 'manage_users_block_input') {
        await handleManageUsersBlock({ sock, sender, chatId, pushName }, trimmedText);
        return;
      }

      // User details view (back to manage users)
      if (session?.currentMenu === 'user_details') {
        if (trimmedText === '0') {
          await sendManageUsersPanel({ sock, sender, chatId, pushName });
        } else {
          await sendText(sock, sender, tr('common.reply0Back'));
        }
        return;
      }

      // Templates submenu reply (admin)
      if (session?.currentMenu === 'templates') {
        if (/^[0-3]$/.test(trimmedText)) {
          await handleTemplateReply({ sock, sender, chatId, pushName }, trimmedText);
        } else {
          await sendText(sock, sender, tr('common.invalidChoiceMinMax', { min: 0, max: 3 }));
        }
        return;
      }

      // Template use list / preview / edit / delete / save (admin)
      if (session?.currentMenu === 'template_use_list') {
        await handleTemplateUseList({ sock, sender, chatId, pushName }, trimmedText);
        return;
      }
      if (session?.currentMenu === 'template_preview') {
        await handleTemplatePreview({ sock, sender, chatId, pushName }, trimmedText);
        return;
      }
      if (session?.currentMenu === 'template_edit') {
        await handleTemplateEdit({ sock, sender, chatId, pushName }, trimmedText);
        return;
      }
      if (session?.currentMenu === 'template_save_name') {
        await handleTemplateNameInput({ sock, sender, chatId, pushName }, trimmedText);
        return;
      }
      if (session?.currentMenu === 'template_save_text') {
        await handleTemplateTextInput({ sock, sender, chatId, pushName }, trimmedText);
        return;
      }
      if (session?.currentMenu === 'template_delete_list') {
        await handleTemplateDeleteList({ sock, sender, chatId, pushName }, trimmedText);
        return;
      }

      // Command analytics menu + detail views (admin)
      if (session?.currentMenu === 'command_analytics') {
        if (/^[0-2]$/.test(trimmedText)) {
          await handleAnalyticsReply({ sock, sender, chatId, pushName }, trimmedText);
        } else {
          await sendText(sock, sender, tr('common.invalidChoiceMinMax', { min: 0, max: 2 }));
        }
        return;
      }

      if (session?.currentMenu === 'command_analytics_top' || session?.currentMenu === 'command_analytics_response') {
        if (trimmedText === '0') {
          await handleAnalyticsDetailReply({ sock, sender, chatId, pushName }, trimmedText);
        } else {
          await sendText(sock, sender, tr('common.reply0Back'));
        }
        return;
      }

      // Maintenance mode submenu + scheduling (admin)
      if (session?.currentMenu === 'maint_menu') {
        if (/^[0-4]$/.test(trimmedText)) {
          await handleMaintMenuReply({ sock, sender, chatId, pushName }, trimmedText);
        } else {
          await sendText(sock, sender, tr('common.invalidChoiceMinMax', { min: 0, max: 4 }));
        }
        return;
      }

      if (session?.currentMenu === 'maint_schedule_start') {
        await handleMaintScheduleReply({ sock, sender, chatId, pushName }, trimmedText, 'start');
        return;
      }

      if (session?.currentMenu === 'maint_schedule_end') {
        await handleMaintScheduleReply({ sock, sender, chatId, pushName }, trimmedText, 'end');
        return;
      }

      if (session?.currentMenu === 'maint_windows') {
        await handleMaintWindowsReply({ sock, sender, chatId, pushName }, trimmedText);
        return;
      }

      if (session?.currentMenu === 'maint_window_detail') {
        if (/^[0-2]$/.test(trimmedText)) {
          await handleMaintWindowDetailReply({ sock, sender, chatId, pushName }, trimmedText);
        } else {
          await sendText(sock, sender, tr('common.invalidChoiceMinMax', { min: 0, max: 2 }));
        }
        return;
      }

      // Blocked users submenu reply (admin)
      if (session?.currentMenu === 'blocked_users_menu') {
        if (/^[0-3]$/.test(trimmedText)) {
          await handleBlockedUsersMenu({ sock, sender, chatId, pushName }, trimmedText);
        } else {
          await sendText(sock, sender, tr('common.invalidChoiceMinMax', { min: 0, max: 3 }));
        }
        return;
      }

      // Blocked user block/unblock input capture (admin)
      if (session?.currentMenu === 'blocked_block_jid') {
        await handleBlockedBlockJid({ sock, sender, chatId, pushName }, trimmedText);
        return;
      }
      if (session?.currentMenu === 'blocked_block_reason') {
        await handleBlockedBlockReason({ sock, sender, chatId, pushName }, trimmedText);
        return;
      }
      if (session?.currentMenu === 'blocked_unblock_jid') {
        await handleBlockedUnblockJid({ sock, sender, chatId, pushName }, trimmedText);
        return;
      }

      // Restore data capture (admin): accepts text JSON or pasted backup
      if (session?.currentMenu === 'awaiting_restore_data') {
        const content = documentBuffer ? documentBuffer.toString('utf8') : trimmedText;
        if (!content) {
          await sendText(sock, sender, tr('common.restoreNoContent'));
          return;
        }
        await handleRestoreData({ sock, sender, chatId, pushName }, content);
        return;
      }

      // Chat Responses submenu + wizard (admin)
      const wizardMenus = [
        'chat_add_start', 'chat_add_triggers', 'chat_add_trigger_edit',
        'chat_trigger_variations', 'chat_trigger_variations_add', 'chat_quick_ai',
        'chat_quick_replies', 'chat_quick_preview', 'chat_quick_language', 'chat_add_replies',
        'chat_response_action', 'chat_cooldown', 'chat_cooldown_custom', 'chat_active_dates',
        'chat_active_start', 'chat_active_end', 'chat_add_style', 'chat_add_emoji',
        'chat_create_from_example', 'chat_create_from_example_reply', 'chat_multi_language_add',
        'chat_multilang_reply_input'
      ];
      if (wizardMenus.includes(session?.currentMenu) && ['save', '💾'].includes(trimmedText.toLowerCase())) {
        if (!isAdminOperator(sender)) return;
        await saveWizardDraft({ sock, sender, chatId, pushName }, session.currentMenu);
        return;
      }
      if (wizardMenus.includes(session?.currentMenu) && ['0', 'cancel'].includes(trimmedText.toLowerCase())) {
        if (!isAdminOperator(sender)) return;
        if (await handleWizardExit({ sock, sender, chatId, pushName }, trimmedText)) return;
      }
      if (session?.currentMenu === 'chat_duplicate_confirm') {
        if (!isAdminOperator(sender)) return;
        if (trimmedText === '1') {
          sessionManager.setState(sender, chatId, { currentMenu: 'chat_quick_replies' });
        } else if (trimmedText === '2') {
          const duplicate = chatRuleService.getRule(session.pendingData?.existingId);
          sessionManager.setState(sender, chatId, { currentMenu: 'chat_quick_replies', chatDraft: { triggers: [session.pendingData.trigger], replies: [], language: duplicate?.language || language } });
        } else {
          return;
        }
      }
      if (['chat_responses_main', 'chat_view_rules', 'chat_view_list', 'chat_manage_rules', 'chat_search', 'chat_search_results', 'chat_import_export', 'chat_rule_detail', 'chat_stats'].includes(session?.currentMenu)) {
        if (!isAdminOperator(sender)) return;
        if (/^\d+$/.test(trimmedText) || ['chat_search', 'chat_import_export'].includes(session.currentMenu)) {
          await handleStructuredChatReply({ sock, sender, chatId, pushName }, trimmedText);
        } else {
          await sendText(sock, sender, tr('chatResponses.invalidNumber', { min: 0, max: 6 }));
        }
        return;
      }
      if (session?.currentMenu === 'chat_add_rule') {
        if (!isAdminOperator(sender)) return;
        await handleAddRuleMenu({ sock, sender, chatId, pushName }, trimmedText);
        return;
      }
      if (['chat_create_from_example', 'chat_create_from_example_reply'].includes(session?.currentMenu)) {
        if (!isAdminOperator(sender)) return;
        await handleCreateFromExample({ sock, sender, chatId, pushName }, trimmedText);
        return;
      }
      if (['chat_multi_language_add', 'chat_multilang_reply_input'].includes(session?.currentMenu)) {
        if (!isAdminOperator(sender)) return;
        await handleMultiLanguageAdd({ sock, sender, chatId, pushName }, trimmedText);
        return;
      }
      if (session?.currentMenu === 'chat_quick_triggers') {
        if (!isAdminOperator(sender)) return;
        await handleQuickTriggers({ sock, sender, chatId, pushName }, trimmedText);
        return;
      }
      if (session?.currentMenu === 'chat_quick_ai') {
        if (!isAdminOperator(sender)) return;
        await handleQuickAi({ sock, sender, chatId, pushName }, trimmedText);
        return;
      }
      if (session?.currentMenu === 'chat_quick_replies') {
        if (!isAdminOperator(sender)) return;
        await handleQuickReplies({ sock, sender, chatId, pushName }, trimmedText);
        return;
      }
      if (session?.currentMenu === 'chat_quick_preview') {
        if (!isAdminOperator(sender)) return;
        await handleQuickPreview({ sock, sender, chatId, pushName }, trimmedText);
        return;
      }
      if (session?.currentMenu === 'chat_quick_language') {
        if (!isAdminOperator(sender)) return;
        await handleQuickLanguage({ sock, sender, chatId, pushName }, trimmedText);
        return;
      }
      if (session?.currentMenu === 'chat_template_library') {
        if (!isAdminOperator(sender)) return;
        await handleTemplateLibrary({ sock, sender, chatId, pushName }, trimmedText);
        return;
      }
      if (session?.currentMenu === 'chat_template_category') {
        if (!isAdminOperator(sender)) return;
        await handleTemplateCategory({ sock, sender, chatId, pushName }, trimmedText);
        return;
      }
      if (session?.currentMenu === 'chat_template_create_pack') {
        if (!isAdminOperator(sender)) return;
        await handleTemplateCreatePack({ sock, sender, chatId, pushName }, trimmedText);
        return;
      }
      if (session?.currentMenu === 'chat_template_import_export') {
        if (!isAdminOperator(sender)) return;
        const content = session.pendingData?.awaitingImport && documentBuffer ? documentBuffer.toString('utf8') : null;
        await handleTemplateImportExport({ sock, sender, chatId, pushName }, trimmedText, content);
        return;
      }
      if (session?.currentMenu === 'chat_template_import_confirm') {
        if (!isAdminOperator(sender)) return;
        await handleTemplateImportConfirm({ sock, sender, chatId, pushName }, trimmedText);
        return;
      }
      if (session?.currentMenu === 'chat_template_pack_preview') {
        if (!isAdminOperator(sender)) return;
        await handleTemplatePackPreview({ sock, sender, chatId, pushName }, trimmedText);
        return;
      }
      if (session?.currentMenu === 'chat_template_language_select') {
        if (!isAdminOperator(sender)) return;
        await handleTemplateLanguageSelect({ sock, sender, chatId, pushName }, trimmedText);
        return;
      }
      if (session?.currentMenu === 'chat_template_preview_edit') {
        if (!isAdminOperator(sender)) return;
        await handleTemplatePreviewEdit({ sock, sender, chatId, pushName }, trimmedText);
        return;
      }
      if (session?.currentMenu === 'chat_template_preview_edit_input') {
        if (!isAdminOperator(sender)) return;
        await handleTemplatePreviewEditInput({ sock, sender, chatId, pushName }, trimmedText);
        return;
      }
      if (session?.currentMenu === 'chat_template_uninstall') {
        if (!isAdminOperator(sender)) return;
        await handleTemplateUninstall({ sock, sender, chatId, pushName }, trimmedText);
        return;
      }
      if (session?.currentMenu === 'chat_template_duplicate_confirm') {
        if (!isAdminOperator(sender)) return;
        await handleTemplateDuplicateConfirm({ sock, sender, chatId, pushName }, trimmedText);
        return;
      }
      if (session?.currentMenu === 'template_featured') {
        if (!isAdminOperator(sender)) return;
        await handleTemplateFeatured({ sock, sender, chatId, pushName }, trimmedText);
        return;
      }
      if (session?.currentMenu === 'template_search') {
        if (!isAdminOperator(sender)) return;
        await handleTemplateSearch({ sock, sender, chatId, pushName }, trimmedText);
        return;
      }
      if (session?.currentMenu === 'template_tag_filter') {
        if (!isAdminOperator(sender)) return;
        await handleTemplateTagFilter({ sock, sender, chatId, pushName }, trimmedText);
        return;
      }
      if (session?.currentMenu === 'pack_updates_list') {
        if (!isAdminOperator(sender)) return;
        await handlePackUpdates({ sock, sender, chatId, pushName }, trimmedText);
        return;
      }
      if (session?.currentMenu === 'chat_smart_suggestions') {
        if (!isAdminOperator(sender)) return;
        await handleSmartSuggestions({ sock, sender, chatId, pushName }, trimmedText);
        return;
      }
      if (['chat_bulk_toggle_lang', 'chat_bulk_toggle_category', 'chat_bulk_toggle_pack'].includes(session?.currentMenu)) {
        if (!isAdminOperator(sender)) return;
        await handleBulkToggleMenu({ sock, sender, chatId, pushName }, trimmedText);
        return;
      }
      if (['chat_snapshots', 'chat_snapshot_restore'].includes(session?.currentMenu)) {
        if (!isAdminOperator(sender)) return;
        await handleTemplateSnapshots({ sock, sender, chatId, pushName }, trimmedText);
        return;
      }
      if (session?.currentMenu === 'chat_cleanup_suggestions') {
        if (!isAdminOperator(sender)) return;
        await handleCleanupSuggestions({ sock, sender, chatId, pushName }, trimmedText);
        return;
      }
      if (session?.currentMenu === 'chat_cleanup_group') {
        if (!isAdminOperator(sender)) return;
        await handleCleanupGroup({ sock, sender, chatId, pushName }, trimmedText);
        return;
      }
      if (session?.currentMenu === 'chat_bulk_add') {
        if (!isAdminOperator(sender)) return;
        await handleBulkAddInput({ sock, sender, chatId, pushName }, trimmedText);
        return;
      }
      if (session?.currentMenu === 'chat_bulk_preview') {
        if (!isAdminOperator(sender)) return;
        await handleBulkPreview({ sock, sender, chatId, pushName }, trimmedText);
        return;
      }
      if (session?.currentMenu === 'chat_bulk_language') {
        if (!isAdminOperator(sender)) return;
        await handleBulkLanguage({ sock, sender, chatId, pushName }, trimmedText);
        return;
      }
      if (session?.currentMenu === 'chat_bulk_policy') {
        if (!isAdminOperator(sender)) return;
        await handleBulkPolicy({ sock, sender, chatId, pushName }, trimmedText);
        return;
      }
      if (session?.currentMenu === 'chat_unmatched') {
        if (!isAdminOperator(sender)) return;
        await handleUnmatchedList({ sock, sender, chatId, pushName }, trimmedText);
        return;
      }
      if (session?.currentMenu === 'chat_snippets') {
        if (!isAdminOperator(sender)) return;
        await handleSnippetsMenu({ sock, sender, chatId, pushName }, trimmedText);
        return;
      }
      if (session?.currentMenu === 'chat_snippet_add') {
        if (!isAdminOperator(sender)) return;
        await handleSnippetAddName({ sock, sender, chatId, pushName }, trimmedText);
        return;
      }
      if (session?.currentMenu === 'chat_snippet_text' || session?.currentMenu === 'chat_snippet_edit_text') {
        if (!isAdminOperator(sender)) return;
        await handleSnippetText({ sock, sender, chatId, pushName }, trimmedText, session?.currentMenu === 'chat_snippet_edit_text' ? 'edit' : 'add');
        return;
      }
      if (session?.currentMenu === 'chat_snippet_edit') {
        if (!isAdminOperator(sender)) return;
        await handleSnippetPick({ sock, sender, chatId, pushName }, trimmedText, 'edit');
        return;
      }
      if (session?.currentMenu === 'chat_snippet_delete') {
        if (!isAdminOperator(sender)) return;
        await handleSnippetPick({ sock, sender, chatId, pushName }, trimmedText, 'delete');
        return;
      }
      if (session?.currentMenu === 'chat_snippet_translate') {
        if (!isAdminOperator(sender)) return;
        await handleSnippetTranslatePick({ sock, sender, chatId, pushName }, trimmedText);
        return;
      }
      if (session?.currentMenu === 'chat_snippet_translate_lang') {
        if (!isAdminOperator(sender)) return;
        await handleSnippetTranslateLang({ sock, sender, chatId, pushName }, trimmedText);
        return;
      }
      if (session?.currentMenu === 'chat_snippet_translate_text') {
        if (!isAdminOperator(sender)) return;
        await handleSnippetTranslateText({ sock, sender, chatId, pushName }, trimmedText);
        return;
      }
      if (session?.currentMenu === 'chat_snippet_impex') {
        if (!isAdminOperator(sender)) return;
        await handleSnippetImpex({ sock, sender, chatId, pushName }, trimmedText);
        return;
      }
      if (session?.currentMenu === 'chat_snippet_import') {
        if (!isAdminOperator(sender)) return;
        const content = documentBuffer ? documentBuffer.toString('utf8') : trimmedText;
        await handleSnippetImport({ sock, sender, chatId, pushName }, content);
        return;
      }
      if (session?.currentMenu === 'chat_add_reply_snippet') {
        if (!isAdminOperator(sender)) return;
        await handleAddReplySnippet({ sock, sender, chatId, pushName }, trimmedText);
        return;
      }
      if (session?.currentMenu === 'chat_add_reply_snippet_pick') {
        if (!isAdminOperator(sender)) return;
        await handleAddReplySnippetPick({ sock, sender, chatId, pushName }, trimmedText);
        return;
      }
      if (session?.currentMenu === 'chat_bulk_delete') {
        if (!isAdminOperator(sender)) return;
        await handleBulkDeleteMenu({ sock, sender, chatId, pushName }, trimmedText);
        return;
      }
      if (session?.currentMenu === 'chat_bulk_delete_lang' || session?.currentMenu === 'chat_bulk_delete_category') {
        if (!isAdminOperator(sender)) return;
        await handleBulkDeleteFilterPick({ sock, sender, chatId, pushName }, trimmedText);
        return;
      }
      if (session?.currentMenu === 'chat_bulk_delete_confirm') {
        if (!isAdminOperator(sender)) return;
        await handleBulkDeleteConfirm({ sock, sender, chatId, pushName }, trimmedText);
        return;
      }
      if (session?.currentMenu === 'chat_trash_move') {
        if (!isAdminOperator(sender)) return;
        await handleTrashMoveMenu({ sock, sender, chatId, pushName }, trimmedText);
        return;
      }
      if (session?.currentMenu === 'chat_trash_move_lang' || session?.currentMenu === 'chat_trash_move_category') {
        if (!isAdminOperator(sender)) return;
        await handleTrashMoveFilterPick({ sock, sender, chatId, pushName }, trimmedText);
        return;
      }
      if (session?.currentMenu === 'chat_trash') {
        if (!isAdminOperator(sender)) return;
        await handleTrashMenu({ sock, sender, chatId, pushName }, trimmedText);
        return;
      }
      if (session?.currentMenu === 'chat_bulk_uninstall_pack') {
        if (!isAdminOperator(sender)) return;
        await handlePackUninstallMenu({ sock, sender, chatId, pushName }, trimmedText);
        return;
      }
      if (session?.currentMenu === 'chat_recent') {
        if (!isAdminOperator(sender)) return;
        await handleRecentMenu({ sock, sender, chatId, pushName }, trimmedText);
        return;
      }
      if (session?.currentMenu === 'chat_recent_open' || session?.currentMenu === 'chat_recent_add' || session?.currentMenu === 'chat_recent_remove') {
        if (!isAdminOperator(sender)) return;
        const menu = session.currentMenu;
        if (menu === 'chat_recent_open') await handleRecentOpen({ sock, sender, chatId, pushName }, trimmedText);
        else await handleRecentFavToggle({ sock, sender, chatId, pushName }, trimmedText, menu === 'chat_recent_add');
        return;
      }
      if (session?.currentMenu === 'chat_rule_edit') {
        if (!isAdminOperator(sender)) return;
        await handleRuleEditSelect({ sock, sender, chatId, pushName }, trimmedText);
        return;
      }
      if (session?.currentMenu === 'chat_rule_delete') {
        if (!isAdminOperator(sender)) return;
        await handleRuleDeleteSelect({ sock, sender, chatId, pushName }, trimmedText);
        return;
      }
      if (session?.currentMenu === 'chat_rule_toggle') {
        if (!isAdminOperator(sender)) return;
        await handleRuleToggleSelect({ sock, sender, chatId, pushName }, trimmedText);
        return;
      }
      if (session?.currentMenu === 'chat_add_rule') {
        if (!isAdminOperator(sender)) return;
        await handleAddRuleMenu({ sock, sender, chatId, pushName }, trimmedText);
        return;
      }
      if (session?.currentMenu === 'chat_drafts') {
        if (!isAdminOperator(sender)) return;
        await handleDraftsList({ sock, sender, chatId, pushName }, trimmedText);
        return;
      }
      if (session?.currentMenu === 'chat_draft_detail') {
        if (!isAdminOperator(sender)) return;
        await handleDraftDetail({ sock, sender, chatId, pushName }, trimmedText);
        return;
      }
      if (session?.currentMenu === 'chat_draft_delete') {
        if (!isAdminOperator(sender)) return;
        await handleDraftDelete({ sock, sender, chatId, pushName }, trimmedText);
        return;
      }
      if (session?.currentMenu === 'chat_unmatched_detail') {
        if (!isAdminOperator(sender)) return;
        await handleUnmatchedDetail({ sock, sender, chatId, pushName }, trimmedText);
        return;
      }
      if (session?.currentMenu === 'faq_list') {
        if (!isAdminOperator(sender)) return;
        await handleFaqList({ sock, sender, chatId, pushName }, trimmedText);
        return;
      }
      if (session?.currentMenu === 'faq_edit_select') {
        if (!isAdminOperator(sender)) return;
        await handleFaqEditSelect({ sock, sender, chatId, pushName }, trimmedText);
        return;
      }
      if (session?.currentMenu === 'faq_delete_select') {
        if (!isAdminOperator(sender)) return;
        await handleFaqDeleteSelect({ sock, sender, chatId, pushName }, trimmedText);
        return;
      }
      if (session?.currentMenu === 'faq_toggle_select') {
        if (!isAdminOperator(sender)) return;
        await handleFaqToggleSelect({ sock, sender, chatId, pushName }, trimmedText);
        return;
      }
      if (session?.currentMenu === 'chat_test_select') {
        if (!isAdminOperator(sender)) return;
        await handleChatTestSelect({ sock, sender, chatId, pushName }, trimmedText);
        return;
      }
      if (session?.currentMenu === 'chat_test_result') {
        if (!isAdminOperator(sender)) return;
        await handleChatTestResult({ sock, sender, chatId, pushName }, trimmedText);
        return;
      }
      if (session?.currentMenu === 'chat_bulk_confirm') {
        if (!isAdminOperator(sender)) return;
        await handleChatBulkConfirm({ sock, sender, chatId, pushName }, trimmedText);
        return;
      }
      if (session?.currentMenu === 'chat_filter_language') {
        if (!isAdminOperator(sender)) return;
        await handleChatFilterLanguage({ sock, sender, chatId, pushName }, trimmedText);
        return;
      }
      if (session?.currentMenu === 'chat_duplicate_select') {
        if (!isAdminOperator(sender)) return;
        await handleChatDuplicateSelect({ sock, sender, chatId, pushName }, trimmedText);
        return;
      }
      if (session?.currentMenu === 'chat_duplicate_language') {
        if (!isAdminOperator(sender)) return;
        await handleChatDuplicateLanguage({ sock, sender, chatId, pushName }, trimmedText);
        return;
      }
      if (session?.currentMenu === 'chat_duplicate_modify') {
        if (!isAdminOperator(sender)) return;
        await handleChatDuplicateModify({ sock, sender, chatId, pushName }, trimmedText);
        return;
      }
      if (session?.currentMenu === 'chat_exit_confirm') {
        if (!isAdminOperator(sender)) return;
        await handleExitConfirm({ sock, sender, chatId, pushName }, trimmedText);
        return;
      }
      if (session?.currentMenu === 'chat_add_start') {
        if (!isAdminOperator(sender)) return;
        await handleChatAddStart({ sock, sender, chatId, pushName }, trimmedText);
        return;
      }
      if (session?.currentMenu === 'chat_add_triggers') {
        if (!isAdminOperator(sender)) return;
        await handleChatAddTriggerInput({ sock, sender, chatId, pushName }, trimmedText);
        return;
      }
      if (session?.currentMenu === 'chat_add_trigger_edit') {
        if (!isAdminOperator(sender)) return;
        await handleChatAddTriggerEdit({ sock, sender, chatId, pushName }, trimmedText.toLowerCase());
        return;
      }
      if (session?.currentMenu === 'chat_add_custom_trigger') {
        if (!isAdminOperator(sender)) return;
        await handleChatAddCustomTrigger({ sock, sender, chatId, pushName }, trimmedText);
        return;
      }
      if (session?.currentMenu === 'chat_add_replies') {
        if (!isAdminOperator(sender)) return;
        await handleChatAddReplies({ sock, sender, chatId, pushName }, trimmedText);
        return;
      }
      if (session?.currentMenu === 'chat_add_preview') {
        if (!isAdminOperator(sender)) return;
        await handleChatAddPreview({ sock, sender, chatId, pushName }, trimmedText.toLowerCase());
        return;
      }
      if (session?.currentMenu === 'chat_add_language') {
        if (!isAdminOperator(sender)) return;
        await handleChatAddLanguage({ sock, sender, chatId, pushName }, trimmedText);
        return;
      }
      if (session?.currentMenu === 'chat_priority_reorder') {
        if (!isAdminOperator(sender)) return;
        await handlePriorityReorder({ sock, sender, chatId, pushName }, trimmedText);
        return;
      }
      if (session?.currentMenu === 'chat_trigger_variations') {
        if (!isAdminOperator(sender)) return;
        await handleTriggerVariations({ sock, sender, chatId, pushName }, trimmedText);
        return;
      }
      if (session?.currentMenu === 'chat_trigger_variations_add') {
        if (!isAdminOperator(sender)) return;
        await handleTriggerVariationsAdd({ sock, sender, chatId, pushName }, trimmedText);
        return;
      }
      if (session?.currentMenu === 'chat_response_preview') {
        if (!isAdminOperator(sender)) return;
        await handleResponsePreview({ sock, sender, chatId, pushName }, trimmedText);
        return;
      }
      if (session?.currentMenu === 'chat_response_action') {
        if (!isAdminOperator(sender)) return;
        await handleResponseAction({ sock, sender, chatId, pushName }, trimmedText);
        return;
      }
      if (session?.currentMenu === 'chat_cooldown') {
        if (!isAdminOperator(sender)) return;
        await handleCooldownMenu({ sock, sender, chatId, pushName }, trimmedText);
        return;
      }
      if (session?.currentMenu === 'chat_add_context') {
        if (!isAdminOperator(sender)) return;
        await handleContextMenu({ sock, sender, chatId, pushName }, trimmedText);
        return;
      }
      if (session?.currentMenu === 'chat_add_context_input') {
        if (!isAdminOperator(sender)) return;
        await handleContextInput({ sock, sender, chatId, pushName }, trimmedText);
        return;
      }
      if (session?.currentMenu === 'chat_add_context_confirm') {
        if (!isAdminOperator(sender)) return;
        await handleContextConfirm({ sock, sender, chatId, pushName }, trimmedText);
        return;
      }
      if (session?.currentMenu === 'chat_add_context_sets') {
        if (!isAdminOperator(sender)) return;
        await handleSetsContextMenu({ sock, sender, chatId, pushName }, trimmedText);
        return;
      }
      if (session?.currentMenu === 'chat_add_context_sets_input') {
        if (!isAdminOperator(sender)) return;
        await handleSetsContextInput({ sock, sender, chatId, pushName }, trimmedText);
        return;
      }
      if (session?.currentMenu === 'chat_add_context_expiry') {
        if (!isAdminOperator(sender)) return;
        await handleContextExpiry({ sock, sender, chatId, pushName }, trimmedText);
        return;
      }
      if (session?.currentMenu === 'chat_edit_context') {
        if (!isAdminOperator(sender)) return;
        await handleEditContextMenu({ sock, sender, chatId, pushName }, trimmedText);
        return;
      }
      if (session?.currentMenu === 'chat_edit_context_input') {
        if (!isAdminOperator(sender)) return;
        await handleEditContextInput({ sock, sender, chatId, pushName }, trimmedText);
        return;
      }
      if (session?.currentMenu === 'chat_edit_context_expiry') {
        if (!isAdminOperator(sender)) return;
        await handleEditContextExpiry({ sock, sender, chatId, pushName }, trimmedText);
        return;
      }
      if (session?.currentMenu === 'chat_settings_context_expiry') {
        if (!isAdminOperator(sender)) return;
        await handleChatSettingsContextExpiry({ sock, sender, chatId, pushName }, trimmedText);
        return;
      }
      if (session?.currentMenu === 'chat_context_registry') {
        if (!isAdminOperator(sender)) return;
        await handleContextRegistry({ sock, sender, chatId, pushName }, trimmedText);
        return;
      }
      if (session?.currentMenu === 'chat_cooldown_custom') {
        if (!isAdminOperator(sender)) return;
        await handleCooldownCustom({ sock, sender, chatId, pushName }, trimmedText);
        return;
      }
      if (session?.currentMenu === 'chat_active_dates') {
        if (!isAdminOperator(sender)) return;
        await handleActiveDatesMenu({ sock, sender, chatId, pushName }, trimmedText);
        return;
      }
      if (session?.currentMenu === 'chat_active_start') {
        if (!isAdminOperator(sender)) return;
        await handleActiveDateInput({ sock, sender, chatId, pushName }, trimmedText, 'start');
        return;
      }
      if (session?.currentMenu === 'chat_active_end') {
        if (!isAdminOperator(sender)) return;
        await handleActiveDateInput({ sock, sender, chatId, pushName }, trimmedText, 'end');
        return;
      }
      if (session?.currentMenu === 'faq_response_preview') {
        if (!isAdminOperator(sender)) return;
        await handleFaqResponsePreview({ sock, sender, chatId, pushName }, trimmedText);
        return;
      }
      if (session?.currentMenu === 'chat_add_style') {
        if (!isAdminOperator(sender)) return;
        await handleChatAddStyle({ sock, sender, chatId, pushName }, trimmedText);
        return;
      }
      if (session?.currentMenu === 'chat_add_emoji') {
        if (!isAdminOperator(sender)) return;
        await handleChatAddEmoji({ sock, sender, chatId, pushName }, trimmedText);
        return;
      }
      if (session?.currentMenu === 'chat_add_another_lang') {
        if (!isAdminOperator(sender)) return;
        await handleChatAddAnotherLang({ sock, sender, chatId, pushName }, trimmedText);
        return;
      }
      if (session?.currentMenu === 'chat_edit_menu') {
        if (!isAdminOperator(sender)) return;
        await handleChatEditMenu({ sock, sender, chatId, pushName }, trimmedText);
        return;
      }
      if (session?.currentMenu === 'chat_edit_triggers') {
        if (!isAdminOperator(sender)) return;
        await handleChatEditTriggers({ sock, sender, chatId, pushName }, trimmedText);
        return;
      }
      if (session?.currentMenu === 'chat_edit_replies') {
        if (!isAdminOperator(sender)) return;
        await handleChatEditReplies({ sock, sender, chatId, pushName }, trimmedText);
        return;
      }
      if (session?.currentMenu === 'chat_edit_weights') {
        if (!isAdminOperator(sender)) return;
        await handleChatEditWeights({ sock, sender, chatId, pushName }, trimmedText);
        return;
      }
      if (session?.currentMenu === 'chat_add_reply_styles') {
        if (!isAdminOperator(sender)) return;
        await handleAddReplyStyles({ sock, sender, chatId, pushName }, trimmedText);
        return;
      }
      if (session?.currentMenu === 'chat_edit_reply_styles') {
        if (!isAdminOperator(sender)) return;
        await handleEditReplyStyles({ sock, sender, chatId, pushName }, trimmedText);
        return;
      }
      if (session?.currentMenu === 'chat_settings_followup_chance') {
        if (!isAdminOperator(sender)) return;
        await handleFollowUpChanceMenu({ sock, sender, chatId, pushName }, trimmedText);
        return;
      }
      if (session?.currentMenu === 'chat_edit_reply_tags') {
        if (!isAdminOperator(sender)) return;
        await handleEditReplyTags({ sock, sender, chatId, pushName }, trimmedText);
        return;
      }
      if (session?.currentMenu === 'chat_add_reply_tags') {
        if (!isAdminOperator(sender)) return;
        await handleAddReplyTags({ sock, sender, chatId, pushName }, trimmedText);
        return;
      }
      if (session?.currentMenu === 'chat_settings_tone_words') {
        if (!isAdminOperator(sender)) return;
        await handleToneWordsMenu({ sock, sender, chatId, pushName }, trimmedText);
        return;
      }
      if (session?.currentMenu === 'chat_edit_language') {
        if (!isAdminOperator(sender)) return;
        await handleChatEditLanguage({ sock, sender, chatId, pushName }, trimmedText);
        return;
      }
      if (session?.currentMenu === 'chat_edit_priority') {
        if (!isAdminOperator(sender)) return;
        await handleChatEditPriority({ sock, sender, chatId, pushName }, trimmedText);
        return;
      }
      if (session?.currentMenu === 'chat_edit_style') {
        if (!isAdminOperator(sender)) return;
        await handleChatEditStyle({ sock, sender, chatId, pushName }, trimmedText);
        return;
      }
      if (session?.currentMenu === 'chat_search_input') {
        if (!isAdminOperator(sender)) return;
        await handleChatSearchInput({ sock, sender, chatId, pushName }, trimmedText);
        return;
      }
      if (session?.currentMenu === 'chat_import_input') {
        if (!isAdminOperator(sender)) return;
        await handleChatImportInput({ sock, sender, chatId, pushName }, trimmedText);
        return;
      }

      // FAQ Knowledge Base menu tree (admin)
      if (session?.currentMenu === 'faq_main') {
        if (!isAdminOperator(sender)) return;
        await handleFaqMain({ sock, sender, chatId, pushName }, trimmedText);
        return;
      }
      if (session?.currentMenu === 'faq_add') {
        if (!isAdminOperator(sender)) return;
        await handleFaqAddMenu({ sock, sender, chatId, pushName }, trimmedText);
        return;
      }
      if (session?.currentMenu === 'faq_quick_add') {
        if (!isAdminOperator(sender)) return;
        await handleFaqQuickAdd({ sock, sender, chatId, pushName }, trimmedText);
        return;
      }
      if (session?.currentMenu === 'faq_quick_add_keywords') {
        if (!isAdminOperator(sender)) return;
        await handleFaqQuickAddKeywords({ sock, sender, chatId, pushName }, trimmedText);
        return;
      }
      if (session?.currentMenu === 'faq_quick_add_keywords_input') {
        if (!isAdminOperator(sender)) return;
        await handleFaqQuickAddKeywordsInput({ sock, sender, chatId, pushName }, trimmedText);
        return;
      }
      if (session?.currentMenu === 'faq_quick_add_answer') {
        if (!isAdminOperator(sender)) return;
        await handleFaqQuickAddAnswer({ sock, sender, chatId, pushName }, trimmedText);
        return;
      }
      if (session?.currentMenu === 'faq_quick_add_done') {
        if (!isAdminOperator(sender)) return;
        await handleFaqQuickAddDone({ sock, sender, chatId, pushName }, trimmedText);
        return;
      }
      if (session?.currentMenu === 'faq_exit_confirm') {
        if (!isAdminOperator(sender)) return;
        await handleFaqExitConfirm({ sock, sender, chatId, pushName }, trimmedText);
        return;
      }
      if (session?.currentMenu === 'faq_bulk_add') {
        if (!isAdminOperator(sender)) return;
        await handleFaqBulkAdd({ sock, sender, chatId, pushName }, trimmedText);
        return;
      }
      if (session?.currentMenu === 'faq_from_unmatched') {
        if (!isAdminOperator(sender)) return;
        await handleFaqFromUnmatched({ sock, sender, chatId, pushName }, trimmedText);
        return;
      }
      if (session?.currentMenu === 'faq_resume_draft') {
        if (!isAdminOperator(sender)) return;
        await handleFaqDraftsList({ sock, sender, chatId, pushName }, trimmedText);
        return;
      }
      if (session?.currentMenu === 'faq_create_from_example') {
        if (!isAdminOperator(sender)) return;
        await handleFaqCreateFromExample({ sock, sender, chatId, pushName }, trimmedText);
        return;
      }
      if (session?.currentMenu === 'faq_multilang_add') {
        if (!isAdminOperator(sender)) return;
        await handleFaqMultilangAdd({ sock, sender, chatId, pushName }, trimmedText);
        return;
      }
      if (session?.currentMenu === 'faq_view') {
        if (!isAdminOperator(sender)) return;
        await handleFaqViewMenu({ sock, sender, chatId, pushName }, trimmedText);
        return;
      }
      if (session?.currentMenu === 'faq_view_list') {
        if (!isAdminOperator(sender)) return;
        await handleFaqViewList({ sock, sender, chatId, pushName }, trimmedText);
        return;
      }
      if (session?.currentMenu === 'faq_view_by_lang') {
        if (!isAdminOperator(sender)) return;
        await handleFaqViewByLang({ sock, sender, chatId, pushName }, trimmedText);
        return;
      }
      if (session?.currentMenu === 'faq_view_by_category') {
        if (!isAdminOperator(sender)) return;
        await handleFaqViewByCategory({ sock, sender, chatId, pushName }, trimmedText);
        return;
      }
      if (session?.currentMenu === 'faq_manage') {
        if (!isAdminOperator(sender)) return;
        await handleFaqManageMenu({ sock, sender, chatId, pushName }, trimmedText);
        return;
      }
      if (session?.currentMenu === 'faq_bulk_toggle') {
        if (!isAdminOperator(sender)) return;
        await handleFaqBulkToggleMenu({ sock, sender, chatId, pushName }, trimmedText);
        return;
      }
      if (session?.currentMenu === 'faq_detail') {
        if (!isAdminOperator(sender)) return;
        await handleFaqDetail({ sock, sender, chatId, pushName }, trimmedText);
        return;
      }
      if (session?.currentMenu === 'faq_search') {
        if (!isAdminOperator(sender)) return;
        await handleFaqSearchPrompt({ sock, sender, chatId, pushName }, trimmedText);
        return;
      }
      if (session?.currentMenu === 'faq_search_results') {
        if (!isAdminOperator(sender)) return;
        await handleFaqSearchResults({ sock, sender, chatId, pushName }, trimmedText);
        return;
      }
      if (session?.currentMenu === 'faq_import_export') {
        if (!isAdminOperator(sender)) return;
        const content = session.pendingData?.awaiting && documentBuffer ? documentBuffer.toString('utf8') : null;
        await handleFaqImportExportMenu({ sock, sender, chatId, pushName }, trimmedText, content);
        return;
      }
      if (session?.currentMenu === 'faq_test_question') {
        if (!isAdminOperator(sender)) return;
        await handleFaqTestQuestion({ sock, sender, chatId, pushName }, trimmedText);
        return;
      }
      if (session?.currentMenu === 'faq_batch_test') {
        if (!isAdminOperator(sender)) return;
        await handleFaqBatchTest({ sock, sender, chatId, pushName }, trimmedText);
        return;
      }
      if (session?.currentMenu === 'faq_stats') {
        if (!isAdminOperator(sender)) return;
        await handleFaqStatsPanel({ sock, sender, chatId, pushName }, trimmedText);
        return;
      }
      if (session?.currentMenu === 'faq_performance_dashboard') {
        if (!isAdminOperator(sender)) return;
        await showFaqStatsPanel({ sock, sender, chatId, pushName });
        return;
      }
      if (['faq_snapshots', 'faq_snapshot_restore'].includes(session?.currentMenu)) {
        if (!isAdminOperator(sender)) return;
        await handleFaqSnapshots({ sock, sender, chatId, pushName }, trimmedText);
        return;
      }
      if (session?.currentMenu === 'faq_cleanup_suggestions') {
        if (!isAdminOperator(sender)) return;
        await handleFaqCleanupSuggestions({ sock, sender, chatId, pushName }, trimmedText);
        return;
      }
      if (session?.currentMenu === 'faq_cleanup_group') {
        if (!isAdminOperator(sender)) return;
        await handleFaqCleanupGroup({ sock, sender, chatId, pushName }, trimmedText);
        return;
      }
      if (session?.currentMenu === 'faq_template_library') {
        if (!isAdminOperator(sender)) return;
        await handleFaqTemplateLibrary({ sock, sender, chatId, pushName }, trimmedText);
        return;
      }
      if (session?.currentMenu === 'faq_template_category') {
        if (!isAdminOperator(sender)) return;
        await handleFaqTemplateCategory({ sock, sender, chatId, pushName }, trimmedText);
        return;
      }
      if (session?.currentMenu === 'faq_template_pack_preview') {
        if (!isAdminOperator(sender)) return;
        await handleFaqTemplatePackPreview({ sock, sender, chatId, pushName }, trimmedText);
        return;
      }
      if (session?.currentMenu === 'faq_template_language_select') {
        if (!isAdminOperator(sender)) return;
        await handleFaqTemplateLanguageSelect({ sock, sender, chatId, pushName }, trimmedText);
        return;
      }
      if (session?.currentMenu === 'faq_template_preview_edit') {
        if (!isAdminOperator(sender)) return;
        await handleFaqTemplatePreviewEdit({ sock, sender, chatId, pushName }, trimmedText);
        return;
      }
      if (session?.currentMenu === 'faq_template_preview_edit_input') {
        if (!isAdminOperator(sender)) return;
        await handleFaqTemplatePreviewEditInput({ sock, sender, chatId, pushName }, trimmedText);
        return;
      }
      if (session?.currentMenu === 'faq_template_uninstall') {
        if (!isAdminOperator(sender)) return;
        await handleFaqTemplateUninstall({ sock, sender, chatId, pushName }, trimmedText);
        return;
      }
      if (session?.currentMenu === 'faq_template_duplicate_confirm') {
        if (!isAdminOperator(sender)) return;
        await handleFaqTemplateDuplicateConfirm({ sock, sender, chatId, pushName }, trimmedText);
        return;
      }
      if (session?.currentMenu === 'faq_template_import_export') {
        if (!isAdminOperator(sender)) return;
        const content = session.pendingData?.awaiting && documentBuffer ? documentBuffer.toString('utf8') : null;
        await handleFaqTemplateImportExport({ sock, sender, chatId, pushName }, trimmedText, content);
        return;
      }
      if (session?.currentMenu === 'faq_pack_updates_list') {
        if (!isAdminOperator(sender)) return;
        await handleFaqPackUpdates({ sock, sender, chatId, pushName }, trimmedText);
        return;
      }
      // FAQ Knowledge Base submenu + wizard (admin)
      // Mirror the rendered menu: 11 options + back (option 11 = Filter Category).
      if (session?.currentMenu === 'faq_submenu') {
        if (!isAdminOperator(sender)) return;
        if (/^(1[01]|[0-9])$/.test(trimmedText)) {
          await handleFaqReply({ sock, sender, chatId, pushName }, trimmedText);
        } else {
          await sendText(sock, sender, tr('faq.invalidNumber', { min: 0, max: 11 }));
        }
        return;
      }
      if (session?.currentMenu === 'faq_test_select') {
        if (!isAdminOperator(sender)) return;
        await handleFaqTestSelect({ sock, sender, chatId, pushName }, trimmedText);
        return;
      }
      if (session?.currentMenu === 'faq_test_result') {
        if (!isAdminOperator(sender)) return;
        await handleFaqTestResult({ sock, sender, chatId, pushName }, trimmedText);
        return;
      }
      if (session?.currentMenu === 'faq_bulk_confirm') {
        if (!isAdminOperator(sender)) return;
        await handleFaqBulkConfirm({ sock, sender, chatId, pushName }, trimmedText);
        return;
      }
      if (session?.currentMenu === 'faq_filter_category') {
        if (!isAdminOperator(sender)) return;
        await handleFaqFilterCategory({ sock, sender, chatId, pushName }, trimmedText);
        return;
      }
      if (session?.currentMenu === 'faq_duplicate_select') {
        if (!isAdminOperator(sender)) return;
        await handleFaqDuplicateSelect({ sock, sender, chatId, pushName }, trimmedText);
        return;
      }
      if (session?.currentMenu === 'faq_duplicate_language') {
        if (!isAdminOperator(sender)) return;
        await handleFaqDuplicateLanguage({ sock, sender, chatId, pushName }, trimmedText);
        return;
      }
      if (session?.currentMenu === 'faq_add_question') {
        if (!isAdminOperator(sender)) return;
        await handleFaqAddQuestion({ sock, sender, chatId, pushName }, trimmedText);
        return;
      }
      if (session?.currentMenu === 'faq_add_answer') {
        if (!isAdminOperator(sender)) return;
        await handleFaqAddAnswer({ sock, sender, chatId, pushName }, trimmedText);
        return;
      }
      if (session?.currentMenu === 'faq_add_keywords') {
        if (!isAdminOperator(sender)) return;
        await handleFaqAddKeywords({ sock, sender, chatId, pushName }, trimmedText);
        return;
      }
      if (session?.currentMenu === 'faq_add_keywords_input') {
        if (!isAdminOperator(sender)) return;
        await handleFaqAddKeywordsInput({ sock, sender, chatId, pushName }, trimmedText);
        return;
      }
      if (session?.currentMenu === 'faq_add_category') {
        if (!isAdminOperator(sender)) return;
        await handleFaqAddCategory({ sock, sender, chatId, pushName }, trimmedText);
        return;
      }
      if (session?.currentMenu === 'faq_add_language') {
        if (!isAdminOperator(sender)) return;
        await handleFaqAddLanguage({ sock, sender, chatId, pushName }, trimmedText);
        return;
      }
      if (session?.currentMenu === 'faq_add_another_lang') {
        if (!isAdminOperator(sender)) return;
        await handleFaqAddAnotherLang({ sock, sender, chatId, pushName }, trimmedText);
        return;
      }
      if (session?.currentMenu === 'faq_edit_menu') {
        if (!isAdminOperator(sender)) return;
        await handleFaqEditMenu({ sock, sender, chatId, pushName }, trimmedText);
        return;
      }
      if (session?.currentMenu === 'faq_edit_answer') {
        if (!isAdminOperator(sender)) return;
        await handleFaqEditAnswer({ sock, sender, chatId, pushName }, trimmedText);
        return;
      }
      if (session?.currentMenu === 'faq_edit_keywords') {
        if (!isAdminOperator(sender)) return;
        await handleFaqEditKeywords({ sock, sender, chatId, pushName }, trimmedText);
        return;
      }
      if (session?.currentMenu === 'faq_edit_category') {
        if (!isAdminOperator(sender)) return;
        await handleFaqEditCategory({ sock, sender, chatId, pushName }, trimmedText);
        return;
      }
      if (session?.currentMenu === 'faq_edit_language') {
        if (!isAdminOperator(sender)) return;
        await handleFaqEditLanguage({ sock, sender, chatId, pushName }, trimmedText);
        return;
      }
      if (session?.currentMenu === 'faq_edit_priority') {
        if (!isAdminOperator(sender)) return;
        await handleFaqEditPriority({ sock, sender, chatId, pushName }, trimmedText);
        return;
      }
      if (session?.currentMenu === 'faq_search_input') {
        if (!isAdminOperator(sender)) return;
        await handleFaqSearchInput({ sock, sender, chatId, pushName }, trimmedText);
        return;
      }
      if (session?.currentMenu === 'faq_import_input') {
        if (!isAdminOperator(sender)) return;
        await handleFaqImportInput({ sock, sender, chatId, pushName }, trimmedText);
        return;
      }

      // Exports submenu (view lists) reply (admin)
      if (session?.currentMenu === 'exports_menu') {
        if (!isAdminOperator(sender)) return;
        if (trimmedText === '0') {
          await sendAdminPanel({ sock, sender, chatId, pushName });
        } else if (/^\d+$/.test(trimmedText)) {
          await handleExportsListReply({ sock, sender, chatId, pushName }, trimmedText);
        } else {
          await sendText(sock, sender, tr('common.invalidChoiceValid'));
        }
        return;
      }

      // Exports detail submenu reply (admin)
      if (session?.currentMenu === 'exports_detail') {
        if (!isAdminOperator(sender)) return;
        if (/^[0-3]$/.test(trimmedText)) {
          await handleExportsDetailReply({ sock, sender, chatId, pushName }, trimmedText);
        } else {
          await sendText(sock, sender, tr('exports.invalidDetail'));
        }
        return;
      }

      // Export rename input (admin)
      if (session?.currentMenu === 'exports_rename_input') {
        if (!isAdminOperator(sender)) return;
        await handleExportsRenameInput({ sock, sender, chatId, pushName }, trimmedText);
        return;
      }

      // Import policy selection (admin)
      if (session?.currentMenu === 'exports_import_policy') {
        if (!isAdminOperator(sender)) return;
        await handleImportPolicy({ sock, sender, chatId, pushName }, trimmedText);
        return;
      }

      // Processing-done / cancelled states are inert (final message already shown).
      if (session?.currentMenu && ['processing_done', 'processing_cancelled'].includes(session.currentMenu)) {
        return;
      }

      // Main menu reply: option 0 = exit (replace menu with farewell, no spam)
      if (session?.currentMenu === 'main' && trimmedText === '0') {
        sessionManager.setState(sender, chatId, { currentMenu: 'sleep_confirm', pendingAction: null });
        await sendMenu({ sock, sender, chatId, text: sleepConfirmationText(language), transitionKey: 'sleep_confirm' });
        return;
      }

      if (session?.currentMenu === 'sleep_confirm') {
        if (trimmedText === '2' || trimmedText === '0') {
          sessionManager.setState(sender, chatId, { currentMenu: 'main' });
          await sendMigratedMainMenu({ sock, sender, chatId, user: userInfo, language, transitionKey: 'sleep_confirm' });
          return;
        }
        if (trimmedText === '1') {
          if (settingsService.getSettings().sleepAnimationEnabled) {
            await runSleepAnimation({ sock, sender, chatId, language });
          } else {
            await sendSleepFinalMessage({ sock, sender, chatId, language });
          }
          return;
        }
        await sendText(sock, sender, tr('common.invalidChoice'));
        return;
      }

      // Custom Commands wizard: every state owns its own prompts and validation.
      if (session?.currentMenu && session.currentMenu.startsWith('custom_command')) {
        if (!isAdminOperator(sender)) return;
        const { handleCustomCommandWizard } = await import('./utils/customCommandWizard.js');
        await handleCustomCommandWizard({ sock, sender, chatId, pushName, user: userInfo, language: userInfo?.language || config.defaultLanguage }, trimmedText);
        return;
      }

      // Tutorial menu and its structured submenus.
      if (session?.currentMenu && session.currentMenu.startsWith('tutorial_')) {
        await handleTutorialReply({
          sock,
          sender,
          chatId,
          pushName,
          language,
          commands,
          isAdmin: isAdminOperator(sender),
          user: userInfo
        }, trimmedText);
        return;
      }

      // Guard: a session left pointing at a menu id that no longer exists in
      // the registry would otherwise be routed against a missing definition.
      // Reset to the main menu so the user is never stuck.
      if (session?.currentMenu) {
        const REGISTRY_IDS = {
          profile: 'profile', profile_edit: 'edit_profile', preferences: 'preferences', stats: 'my_stats',
          main: 'main_menu', settings: 'settings', tutorial_main: 'tutorial', info: 'info',
          feedback_main: 'feedback', faq_main: 'faq', faq_add: 'faq_add', faq_view: 'faq_view',
          faq_manage: 'faq_manage', faq_import_export: 'faq_import_export', faq_stats: 'faq_stats',
          faq_search: 'faq_search', chat_faq_menu: 'chat_faq', chat_responses_main: 'chat_responses',
          chat_settings: 'chat_settings', chat_snippets: 'snippets', chat_test_panel: 'test_panel',
          chat_import_export: 'chat_import_export', chat_snippet_impex: 'snippet_impex',
          admin: 'adminPanel', admin_quick_actions: 'quick_actions', broadcast_submenu: 'broadcast',
          admin_users: 'user_management', system_settings: 'system_settings', admin_backup: 'backup_restore',
          logs: 'logs', admin_scheduled_tasks: 'scheduled_tasks', command_analytics: 'analytics',
          admin_search: 'admin_search', tutorial_getting_started: 'tutorial_getting_started',
          tutorial_profile_guide: 'tutorial_profile_guide', tutorial_settings_prefs: 'tutorial_settings_prefs',
          tutorial_self_destruct: 'tutorial_self_destruct', tutorial_feedback: 'tutorial_feedback',
          tutorial_whats_new: 'tutorial_whats_new', info_about: 'info_about', info_version: 'info_version',
          info_developer: 'info_developer', info_website: 'info_website', bot_notifications: 'bot_notifications',
          message_display: 'message_display', message_display_admin: 'message_display_admin'
        };
        const registryId = REGISTRY_IDS[session.currentMenu];
        if (registryId) {
          const { getMenu } = await import('./config/menus/registry.js');
          if (!getMenu(registryId)) {
            logger.warn({ sender, currentMenu: session.currentMenu, registryId }, '[MENU] unknown menu in session, resetting');
            sessionManager.setState(sender, chatId, { currentMenu: 'main', pendingAction: null, pendingData: null });
            const gUser = await getUserByJid(sender);
            const gLang = gUser?.language || config.defaultLanguage;
            await sendMigratedMainMenu({ sock, sender, chatId, user: gUser, language: gLang, transitionKey: 'main_menu' });
            return;
          }
        }
      }

      // Changelog Manager sub-states (draft list/detail, wizards, entry edit).
      // The manager menu itself is handled by the cluster above; everything it
      // opens is a sub-state owned by one dispatcher.
      if (CHANGELOG_SUB_STATES.has(session?.currentMenu || '')) {
        if (!isAdminOperator(sender)) return;
        const { handleChangelogManagerReply } = await import('./handlers/changelogManagerCommand.js');
        await handleChangelogManagerReply({ sock, sender, chatId, pushName }, trimmedText);
        return;
      }

      // Bot Content & Timing sub-states (field input, confirm, import,
      // snapshots, reset). Menus resolve through the config-driven cluster;
      // only the parked free-text states land here.
      if (typeof session?.pendingAction === 'string' && session.pendingAction.startsWith('bot_content_')) {
        if (!isAdminOperator(sender)) return;
        const { handleBotContentReply } = await import('./handlers/botContentReply.js');
        const handled = await handleBotContentReply(
          { sock, sender, chatId, pushName, trimmedText, documentBuffer, language },
          session
        );
        if (handled) return;
      }

      // Profile-cluster menus: session keeps legacy ids, the registry speaks
      // new ids. Only route here when the session is actually in one of those
      // four menus; otherwise fall through to the other handlers below.
      const migratedProfileId = { profile: 'profile', profile_edit: 'edit_profile', preferences: 'preferences', stats: 'my_stats' }[session?.currentMenu || ''];
      if (migratedProfileId) {
        const pUser = await getUserByJid(sender);
        const pLang = pUser?.language || config.defaultLanguage;
        const { resolveMenuOption, runMenuAction } = await import('./utils/menuRouter.js');
        const { sendMenuById } = await import('./utils/menuSender.js');
        const { profileCustomHandlers } = await import('./utils/menuCustomHandlers.js');
        const pResult = resolveMenuOption(migratedProfileId, trimmedText, pUser, pLang);
        if (pResult.kind === 'back') {
          if (pResult.to === 'main_menu') {
            await backToMain({ sock, sender, chatId, pushName }, pLang);
            return;
          }
          const legacyBack = { profile: 'profile', edit_profile: 'profile_edit', preferences: 'preferences', my_stats: 'stats' }[pResult.to] || 'profile';
          const backTransition = { profile: 'profile_submenu', edit_profile: 'profile_edit', preferences: 'preferences_submenu', my_stats: 'stats_submenu' }[pResult.to];
          await sendMenuById(pResult.to, { sock, sender, chatId, user: pUser, language: pLang }, backTransition, { sessionMenu: legacyBack });
          return;
        }
        if (pResult.kind === 'action') {
          await runMenuAction(pResult.action, {
            sock, sender, chatId, pushName, user: pUser, language: pLang,
            sendMenuFn: async (menuId, menuUser, menuLang) => {
              const { sendEditAdvancedSubmenu, sendAdvancedPreferencesView, languageOf } = await import('./handlers/profileCommand.js');
              if (menuId === 'edit_profile_advanced') {
                return sendEditAdvancedSubmenu({ sock, sender, chatId, pushName }, languageOf(sender));
              }
              if (menuId === 'preferences_advanced') {
                return sendAdvancedPreferencesView({ sock, sender, chatId, pushName }, languageOf(sender));
              }
              // Any other target is a registered menu (runMenuAction has already
              // verified this), so open it through the shared sender. Throwing
              // here used to strand live options such as message_display.
              return sendMenuById(menuId, { sock, sender, chatId, user: menuUser, language: menuLang }, `profile_${menuId}`);
            },
            handlers: profileCustomHandlers
          });
          return;
        }
        // Invalid: legacy per-state messages (menu stays, no re-render).
        if (session.currentMenu === 'stats') {
          await sendText(sock, sender, toSmallCaps(tr('common.invalidChoiceValid')));
          return;
        }
        // Use the router's computed max so the hint matches the visible options.
        const pMax = Number.isFinite(Number(pResult.max)) ? Number(pResult.max) : 0;
        await sendText(sock, sender, toSmallCaps(tr('common.invalidChoiceMinMax', { min: 0, max: pMax })));
        return;
      }

      // Profile menus: main profile view, edit submenu, name/username input,
      // and name/username confirmation + feature unavailable flow.
      if (session?.currentMenu && [
        'profile', 'profile_edit', 'profile_edit_advanced', 'profile_name_input',
        'profile_username_input', 'profile_confirmation', 'stats',
        'preferences', 'pref_advanced', 'message_settings', 'self_destruct_unit',
        'self_destruct_custom_time', 'self_destruct_duration', 'self_destruct_repetition', 'self_destruct_custom',
        'self_destruct_confirm', 'native_disappearing', 'pref_language_selection', 'pref_language_confirm',
        'pref_typing', 'pref_typing_mode', 'pref_typing_delay', 'pref_typing_delay_custom',
        'pref_typing_type', 'pref_typing_advanced',
        'feature_notify', 'chat_notify',
        'feature_unavailable', 'feature_notify_toggle', 'feature_notify_result', 'feature_info',
        'settings'
      ].includes(session.currentMenu)) {
        if (session.currentMenu === 'settings') {
          if (trimmedText === '0') {
            const user = await getUserByJid(sender);
            const language = user?.language || config.defaultLanguage;
            sessionManager.setState(sender, chatId, { currentMenu: 'main' });
            await sendMigratedMainMenu({ sock, sender, chatId, user, language, transitionKey: 'main_to_main' });
            return;
          }
          if (trimmedText === '9') {
            await showHelpFor({ sender, chatId }, 'settings');
            return;
          }
          await sendText(sock, sender, tr('common.invalidChoiceValid'));
          return;
        }
        await handleProfileReply({ sock, sender, chatId, pushName }, trimmedText);
        return;
      }

      // Main menu reply: each option reflects its feature status from the
      // registry (marker shown after the label). Non-available features open
      // the standard unavailable submenu (Notify Me / Info) instead.
      if (session?.currentMenu === 'main' && /^([1-9]|A|a)$/.test(trimmedText)) {
        const user = await getUserByJid(sender);
        const language = user?.language || config.defaultLanguage;
        const displayName = user?.username ? `@${user.username}` : (user?.name || 'User');

        // Migrated main menu path (Phase 3): same inputs, same behavior.
        const { resolveMenuOption, runMenuAction } = await import('./utils/menuRouter.js');
        const { sendMenuById } = await import('./utils/menuSender.js');
        const resendMain = () => sendMigratedMainMenu({ sock, sender, chatId, pushName, user, language, transitionKey: 'main_to_main' });
        const sendSleepConfirm = async () => {
          sessionManager.setState(sender, chatId, { currentMenu: 'sleep_confirm', pendingAction: null });
          await sendMenu({ sock, sender, chatId, text: sleepConfirmationText(language), transitionKey: 'sleep_confirm' });
        };
        if (/^[Aa]$/.test(trimmedText)) {
          const activeUserJid = session?.isTestActive && session.testSession?.testUserJid
            ? session.testSession.testUserJid
            : sender;
          if (!isAdminOperator(activeUserJid)) {
            reportService.reportToAdmins('security', {
              user: sender,
              action: 'admin_command_attempt',
              details: 'main_menu_option_admin'
            });
            await sendText(sock, sender, tr('common.notAuthorizedAdminPanel'));
          } else {
            const { default: settingsService } = await import('./services/settingsService.js');
            const { isOwner } = await import('./services/rolesService.js');
            if (settingsService.getSettings().adminPanelLocked === true && !isOwner(activeUserJid)) {
              await sendText(sock, sender, tr('admin.locked'));
            } else {
              await sendAdminPanel({ sock, sender, chatId, pushName });
            }
          }
          return;
        }
        const mainResult = resolveMenuOption('main_menu', trimmedText, user);
        if (mainResult.kind === 'action') {
          if (mainResult.action === 'sleep') {
            await sendSleepConfirm();
            return;
          }
          const mainFeatureId = MAIN_MENU_FEATURES[trimmedText];
          const mainStatus = mainFeatureId ? getFeature(mainFeatureId)?.status : 'available';
          if (mainFeatureId && mainStatus !== 'available') {
            await featureBlockedReply({ sock, sender, chatId, pushName }, language, mainFeatureId, 'main');
            return;
          }
          const mainOpeners = {
            profile: () => openProfile({ sock, sender, chatId, pushName }),
            settings: () => openSettings({ sock, sender, chatId, pushName }),
            statistics: () => openStatsMenu({ sock, sender, chatId, pushName }),
            tutorial: () => openTutorial({ sock, sender, chatId, pushName, language, commands, isAdmin: isAdminOperator(sender), user }),
            info: () => openInfo({ sock, sender, chatId, pushName }),
            feedback: () => openFeedback({ sock, sender, chatId, pushName }),
            // Help stays paginated and is owned by helpCommand; the registry
            // shell exists so `open:help` resolves instead of failing.
            help: async () => {
              const { openHelp } = await import('./handlers/helpCommand.js');
              return openHelp({ sock, sender, chatId, pushName, user, language }, { origin: 'main' });
            },
            // Reached only if the earlier admin gate is ever bypassed.
            adminPanel: () => sendAdminPanel({ sock, sender, chatId, pushName })
          };
          await runMenuAction(mainResult.action, {
            sock, sender, chatId, pushName, user, language,
            sendMenuFn: async (menuId, menuUser, menuLang) => {
              const opener = mainOpeners[menuId];
              // Not a legacy opener, but runMenuAction has confirmed it is a
              // registered menu, so open it rather than stranding the option.
              if (!opener) return sendMenuById(menuId, { sock, sender, chatId, user: menuUser, language: menuLang });
              return opener();
            },
            handlers: { sleep: sendSleepConfirm }
          });
          return;
        }
        // Invalid here (7, 8): legacy behavior re-renders the menu.
        await resendMain();
        return;

        if (/^[Aa]$/.test(trimmedText)) {
          // Admin Panel stays accessible to admins even when unavailable.
          const activeUserJid = session?.isTestActive && session.testSession?.testUserJid
            ? session.testSession.testUserJid
            : sender;
          if (!isAdminOperator(activeUserJid)) {
            reportService.reportToAdmins('security', {
              user: sender,
              action: 'admin_command_attempt',
              details: 'main_menu_option_admin'
            });
            await sendText(sock, sender, tr('common.notAuthorizedAdminPanel'));
          } else {
            const { default: settingsService } = await import('./services/settingsService.js');
            const { isOwner } = await import('./services/rolesService.js');
            if (settingsService.getSettings().adminPanelLocked === true && !isOwner(activeUserJid)) {
              await sendText(sock, sender, tr('admin.locked'));
            } else {
              await sendAdminPanel({ sock, sender, chatId, pushName });
            }
          }
          return;
        }

        const featureId = MAIN_MENU_FEATURES[trimmedText];
        const status = featureId ? getFeature(featureId)?.status : 'available';
        if (featureId && status !== 'available') {
          await featureBlockedReply({ sock, sender, chatId, pushName }, language, featureId, 'main');
          return;
        }

        // Option 1 = Profile view.
        if (trimmedText === '1') {
          await openProfile({ sock, sender, chatId, pushName });
          return;
        }

        // Option 2 = Settings.
        if (trimmedText === '2') {
          await openSettings({ sock, sender, chatId, pushName });
          return;
        }

        // Option 3 = Statistics section.
        if (trimmedText === '3') {
          await openStatsMenu({ sock, sender, chatId, pushName });
          return;
        }

        // Option 4 = Tutorial.
        if (trimmedText === '4') {
          await openTutorial({
            sock,
            sender,
            chatId,
            pushName,
            language,
            commands,
            isAdmin: isAdminOperator(sender),
            user
          });
          return;
        }

        // Option 5 = Info section.
        if (trimmedText === '5') {
          await openInfo({ sock, sender, chatId, pushName });
          return;
        }

        // Option 6 = Feedback section.
        if (trimmedText === '6') {
          await openFeedback({ sock, sender, chatId, pushName });
          return;
        }

        await sendMigratedMainMenu({ sock, sender, chatId, user: userInfo, language, transitionKey: 'main_to_main' });
        return;
      }

      // Info section reply (main menu option 5).
      if (['info', 'info_about', 'info_version', 'info_developer', 'info_website'].includes(session?.currentMenu)) {
        await handleInfoReply({ sock, sender, chatId, pushName }, trimmedText);
        return;
      }

      // Statistics section reply (main menu option 3).
      if (['stats_main', 'stats_my', 'stats_top_commands', 'stats_top_users', 'stats_feedback', 'stats_advanced', 'stats_adv_language', 'stats_adv_features', 'stats_adv_peak', 'stats_adv_rate', 'stats_adv_trend', 'stats_adv_keywords'].includes(session?.currentMenu)) {
        await handleStatsReply({ sock, sender, chatId, pushName }, trimmedText);
        return;
      }

      // Feedback section reply (main menu option 6).
      if ((session?.currentMenu || '').startsWith('feedback_admin')) {
        await handleFeedbackAdminReply({ sock, sender, chatId, pushName }, trimmedText);
        return;
      }
      if ((session?.currentMenu || '').startsWith('feedback')) {
        await handleFeedbackReply({ sock, sender, chatId, pushName }, trimmedText);
        return;
      }

      // Generic menu guard -- the last gate before free text.
      //
      // Menu handling above is a long chain of per-menu `if (session.currentMenu
      // === X)` blocks with richer behaviour (feature gating, admin checks,
      // paginated help). A menu registered in the registry but absent from that
      // chain -- the Bot Content screens, for one -- had no reply handler at
      // all, so a numbered option fell straight through to the chat rules and
      // "2" answered with a greeting. Anything still holding a registered
      // currentMenu is therefore resolved here, before handleFreeText.
      if (session?.currentMenu) {
        if (!getMenu(session.currentMenu)) {
          // Removed or renamed menu: clear it rather than stranding the user.
          logger.warn({ currentMenuId: session.currentMenu, sender }, '[ROUTER] stale menu id; clearing');
          sessionManager.setState(sender, chatId, { currentMenu: null });
        } else {
          const genericResult = resolveMenuOption(session.currentMenu, trimmedText, userInfo, language);
          if (genericResult.kind === 'action') {
            // The handler map is registered into menuRouter at startup, but
            // passing it here as well keeps this path self-sufficient.
            const { allMenuCustomHandlers } = await import('./utils/menuCustomHandlers.js');
            await runMenuAction(genericResult.action, {
              sock, sender, chatId, pushName, text: trimmedText,
              language, user: userInfo, session,
              handlers: allMenuCustomHandlers
            });
            return;
          }
          if (genericResult.kind === 'back') {
            await sendMenuById(genericResult.to, { sock, sender, chatId, user: userInfo, language }, genericResult.to);
            return;
          }
          // Invalid inside a real menu: answer here, never with a chat rule.
          await sendText(sock, sender, tr('common.invalidChoiceMinMax', { min: 0, max: genericResult.max }));
          return;
        }
      }

      // Free text (no prefix, nothing menu-related) goes to the conversational layer.
      await conversationService.handleFreeText({ sock, sender, chatId, pushName }, trimmedText);
    } catch (error) {
      addError(error);
      setLastError(error);
      logger.error({ err: error }, 'Error processing message');
    }
  });

  const { getAllMenus, getMenu } = await import('./config/menus/registry.js');
  await import('./config/menus/index.js');
  const registeredMenus = getAllMenus();
  logger.info(
    { count: registeredMenus.length, ids: registeredMenus.map((m) => m.id).join(', ') },
    `[MENU_REGISTRY] ${registeredMenus.length} menus registered`
  );
  // Custom menu actions are published into menuRouter's registry so that a
  // custom: action resolves no matter which router path reached it. Without this
  // the handlers were only visible to the router paths that pass `handlers`, and
  // everything else answered "menu unavailable".
  {
    const { registerAllMenuActionHandlers } = await import('./utils/menuRouter.js');
    const { allMenuCustomHandlers } = await import('./utils/menuCustomHandlers.js');
    const count = registerAllMenuActionHandlers(allMenuCustomHandlers);
    logger.info({ count }, '[MENU] custom action handlers registered');
  }

  // Structural audit: missing headings, options with no number or action,
  // duplicate option numbers, and dangling backTo/open: targets. Complements
  // the critical-menu and dangling-open checks below rather than replacing them.
  {
    const { auditMenus } = await import('./utils/menuAudit.js');
    auditMenus();
  }

  // Startup validation: every menu reachable from the main menu must resolve,
  // otherwise pressing that option would fail at runtime.
  const CRITICAL_MENUS = ['main_menu', 'profile', 'settings', 'statistics', 'tutorial', 'info', 'feedback', 'help', 'adminPanel'];
  for (const id of CRITICAL_MENUS) {
    if (!getMenu(id)) logger.error({ menuId: id }, '[MENU] critical menu not registered!');
  }
  // Cross-check every open:<menuId> action across all definitions.
  const dangling = [];
  for (const m of registeredMenus) {
    // Menus built by a dynamicOptions() factory (preferences, edit_profile, ...)
    // carry an empty options array, so their targets must be materialised here
    // or their open: targets go unchecked.
    let opts = m.options;
    if (typeof m.dynamicOptions === 'function') {
      try { opts = m.dynamicOptions(); } catch (err) {
        logger.error({ menuId: m.id, err: err.message }, '[MENU] dynamicOptions failed during startup check');
        continue;
      }
    }
    for (const opt of opts || []) {
      if (typeof opt.action === 'string' && opt.action.startsWith('open:')) {
        const target = opt.action.slice('open:'.length);
        if (!getMenu(target)) dangling.push(`${m.id}:${opt.number} -> open:${target}`);
      }
    }
  }
  if (dangling.length) logger.error({ dangling }, '[MENU] definitions reference unregistered menus');
  else logger.info('[MENU] all open: targets resolve');
  // Load persisted message display settings (creates data/messageSettings.json).
  const msgSettings = (await import('./services/messageSettingsService.js')).loadSettings();
  logger.info({ messageDisplay: msgSettings }, '[MSG] display modes loaded');
  logger.info('X-Vortex bot is ready');
}

startPeriodicCleanup();

// Clear report timers on shutdown and notify admins. The lifecycle service
// owns the SIGINT/SIGTERM handlers, the double-fire guard and the 3s timeout;
// it is installed once and reads the live socket through this holder.
{
  const lifecycle = await import('./services/lifecycleService.js');
  lifecycle.installSignalHandlers(() => lifecycleSock);
}

// Handle startup errors
startBot().catch(err => {
  addError(err);
  setLastError(err);
  logger.error({ err }, 'Fatal error starting bot');
  process.exit(1);
});
