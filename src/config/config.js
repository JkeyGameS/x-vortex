import dotenv from 'dotenv';
dotenv.config();

const config = {
  botName: 'X‑Vortex',
  botVersion: '1.0.0',
  LATEST_VERSION: '1.1.0',
  changelog: [
    'info.change1',
    'info.change2',
    'info.change3'
  ],
  developer: {
    name: 'X_LAB TEAM 👁️‍🗨️',
    email: '...', //support@x-vortex.bot
    github: '...' //https://github.com/x-vortex
  },
  website: '...', //https://x-vortex.bot
  prefix: '/',
  sessionPath: './session',
  defaultLanguage: 'en',
  supportedLanguages: ['en', 'fr', 'de', 'es', 'ar'],
sessionTimeoutMinutes: 5,
  testUserCleanupIntervalMs: 3600000, // default: every hour
  adminJids: ['127531067904055@lid'], // e.g., ['123456789@lid']
  ownerJid: null, // bot owner JID; defaults to the first adminJid when null
  reportEnabled: true,
  reportMinIntervalMs: 60000, // minimum delay between two immediate reports of same type
  enableBugReports: true,
  enableSpamReports: true,
  enableSecurityReports: true,
  spamThreshold: 5, // max commands per spamWindowMs before flagging
  spamWindowMs: 10000, // 10 seconds
  reportAggregationThreshold: 10, // number of reports of same type before forcing summary
  reportAggregationWindowMs: 300000, // 5 minutes – flush buffer after this time
  maxEditBeforeSend: 2, // max times sendMenu edits the same message before deleting + sending fresh
  commandCooldownMs: 1000, // minimum time between commands/actions per user
  adminBypassCooldown: true, // allow admin JIDs to skip the cooldown
  // Conversational chat (free-text interaction layer)
  conversationEnabled: false,          // master toggle; runtime state persists in data/settings.json
  conversationTypingIndicator: true,   // show the "typing…" presence before conversational replies
  conversationTypingDelayMs: 1500,     // how long the typing indicator shows before the reply
  conversationMaxUnknownAttempts: 3,   // repeated unknown free text before the firm nudge
  conversationAlertOnRepeatedUnknown: true, // report repeated unknown input to admins
  conversationGreetingEnabled: true,   // respond to greetings like "hi"/"hello"
  conversationHelpPromptEnabled: true, // offer help upon "help"/misspelled help
  conversationTemporaryOffMessage: 'The chat is currently unavailable for {duration}. Please check back later.',
  conversationPermanentOffMessage: 'The chat feature is currently unavailable. Please check back later.',
  conversationNotifyRequestEnabled: true, // allow users to ask for a notification when the chat returns
  // Graceful fallback flow (unknown free-text messages)
  fallbackEnabled: true, // master toggle for the graceful fallback flow
  fallbackSuppressAfterAttempts: 3, // stay silent after this many fallbacks...
  fallbackSuppressWindowMs: 300000, // ...within this window (5 minutes)
  // Universal typing indicator with randomized delay
  typingIndicatorEnabled: true, // master toggle for typing presence
  typingDelayMinMs: 300, // minimum typing delay before a reply
  typingDelayMaxMs: 1200, // maximum base typing delay before a reply
  typingDelayScalesWithLength: true, // longer replies take longer to "type"
  typingDelayPerCharMs: 15, // ms added per character if scaling enabled
  typingDelayMaxCapMs: 3000, // hard cap on the total typing delay
  // Typing animation controls (user preferences + admin defaults)
  typingAnimationEnabled: true, // master toggle for the typing animation system
  typingAllowUserOverride: true, // users may customize their own typing prefs
  typingReadReceiptsEnabled: true, // global gate for read receipts
  typingAdaptivePerCharMs: 15, // adaptive mode ms per character
  typingAdaptiveMinMs: 200, // adaptive mode floor
  typingAdaptiveMaxMs: 2500, // adaptive mode ceiling
  // Trash retention for bulk-deleted chat rules
  chatTrashRetentionDays: 30, // auto-purge trashed rules after this many days
  // Natural diversified replies (weighted random + anti-repetition)
  chatReplyAntiRepetitionEnabled: true, // exclude recently used replies per user
  chatReplyAntiRepetitionWindow: 3, // number of recent replies to exclude
  chatReplyHistoryMaxRules: 50, // max rules tracked per user
  chatReplyWeightedRandomEnabled: true, // weighted random pick vs uniform/first
  chatReplyDefaultWeight: 1.0, // default weight for replies without one
  // Tone detection & time-of-day awareness
  chatToneDetectionEnabled: true, // filter replies by detected message tone
  chatTimeAwarenessEnabled: true, // filter replies by time of day
  chatTimeRanges: {
    morning: { start: '05:00', end: '11:59' },
    afternoon: { start: '12:00', end: '16:59' },
    evening: { start: '17:00', end: '21:59' },
    night: { start: '22:00', end: '04:59' }
  },
  chatToneWords: {
    positive: [], // loaded from data/toneWords.json when present
    negative: []
  },
  // Reply style per user & follow-up prompts
  chatReplyStylePersonalizationEnabled: true, // use user's preferred style pool
  chatFollowUpEnabled: true, // allow follow-up sentences after replies
  chatFollowUpDefaultChance: 0.3, // default follow-up probability 0-1
  chatFollowUpRespectMinimalStyle: true, // minimal style never gets follow-ups
  chatFollowUpMaxLength: 120, // safety cap for follow-up text length
  // Context awareness & multi-turn flows
  chatContextAwarenessEnabled: true, // master toggle for pendingContext matching
  chatContextDefaultExpiryMs: 120000, // default context lifetime (2 min)
  chatContextPriorityBoost: 100, // score boost for context-matching rules
  chatContextMaxUserMessagesTracked: 3, // last-N user messages kept in session
  // A/B testing, reply analytics & engagement weighting
  chatAbTestingEnabled: true, // master toggle for engagement-weighted picks
  chatEngagementWindowMs: 60000, // user reply within this counts as engagement
  chatEngagementBaseline: 0.5, // neutral engagement rate
  chatEngagementBoostFactor: 1.0, // scales the engagement bonus
  chatEngagementMinSamples: 5, // min sends before bonus applies
  chatEngagementBonusMin: -0.5, // floor for engagement bonus
  chatEngagementBonusMax: 1.0, // ceiling for engagement bonus
  chatAnalyticsRetentionDays: 90, // prune analytics entries older than this
  // Conversation-level rate limiting, dry-run testing & snippet composability
  chatRateLimitEnabled: true, // master toggle for per-user conversation limiting
  chatRateLimitMaxReplies: 10, // max chat/FAQ replies per window per user
  chatRateLimitWindowMs: 60000, // sliding window (60 seconds)
  chatRateLimitCooldownBehavior: 'silent', // 'silent' | 'polite'
  chatDryRunMaxLogEntries: 500, // cap for data/chatDryRunLog.json
  chatSnippetMaxDepth: 3, // max recursive {snippet:name} expansion depth
  // Menu system migration toggle (Phase 7: + user/FAQ cluster)
  menuMigration: {
    mode: 'partial', // 'off' | 'partial' | 'full'
    migratedMenus: ['main_menu', 'profile', 'edit_profile', 'preferences', 'my_stats', 'chat_faq', 'chat_responses', 'chat_settings', 'snippets', 'test_panel', 'chat_import_export', 'adminPanel', 'quick_actions', 'broadcast', 'user_management', 'system_settings', 'backup_restore', 'logs', 'scheduled_tasks', 'analytics', 'admin_search', 'settings', 'statistics', 'tutorial', 'tutorial_getting_started', 'tutorial_profile_guide', 'tutorial_settings_prefs', 'tutorial_self_destruct', 'tutorial_feedback', 'tutorial_whats_new', 'info', 'info_about', 'info_version', 'info_developer', 'info_website', 'feedback', 'faq', 'faq_add', 'faq_view', 'faq_manage', 'faq_import_export', 'faq_stats', 'faq_search', 'snippet_impex'] // menu IDs rendered by the new renderer (Phases 1+)
  },
  // Add other settings as needed
};

export default config;

/**
 * Phase 0 helper: decide whether a menu uses the new renderer.
 * 'off' = legacy builders everywhere; 'full' = new renderer everywhere;
 * 'partial' = new renderer only for listed menu IDs.
 */
export function isMenuMigrated(menuId) {
  if (!config.menuMigration) return false;
  if (config.menuMigration.mode === 'full') return true;
  if (config.menuMigration.mode === 'off') return false;
  return Array.isArray(config.menuMigration.migratedMenus)
    && config.menuMigration.migratedMenus.includes(menuId);
}