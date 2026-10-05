// Bot Content & Timing handlers, registered as a spread so the 20-odd actions
// stay in handlers/botContentCommand.js rather than growing this table.
export const botContentHandlers = {
  // Groups and fields
  bot_content_group_firstMessage: async (c) => (await import('../handlers/botContentCommand.js')).showGroupMenu(c, 'firstMessage'),
  bot_content_group_resumeMessage: async (c) => (await import('../handlers/botContentCommand.js')).showGroupMenu(c, 'resumeMessage'),
  bot_content_group_welcomeMessage: async (c) => (await import('../handlers/botContentCommand.js')).showGroupMenu(c, 'welcomeMessage'),
  bot_content_group_unsupportedLanguage: async (c) => (await import('../handlers/botContentCommand.js')).showGroupMenu(c, 'unsupportedLanguage'),
  bot_content_group_retry: async (c) => (await import('../handlers/botContentCommand.js')).showGroupMenu(c, 'retry'),
  bot_content_group_cooldownLock: async (c) => (await import('../handlers/botContentCommand.js')).showGroupMenu(c, 'cooldownLock'),

  // Welcome-back variant pools
  bot_content_variant_A1: (c) => variant(c, 'A1'),
  bot_content_variant_A2: (c) => variant(c, 'A2'),
  bot_content_variant_A3: (c) => variant(c, 'A3'),
  bot_content_variant_A4: (c) => variant(c, 'A4'),
  bot_content_variant_B1: (c) => variant(c, 'B1'),
  bot_content_variant_B2: (c) => variant(c, 'B2'),
  bot_content_variant_B3: (c) => variant(c, 'B3'),

  // Timing
  bot_content_timing_typingIndicatorEnabled: (c) => timing(c, 'typingIndicatorEnabled'),
  bot_content_timing_typingMode: (c) => timing(c, 'typingMode'),
  bot_content_timing_typingDelayMs: (c) => timing(c, 'typingDelayMs'),
  bot_content_timing_typingTargeting: (c) => timing(c, 'typingTargeting'),
  bot_content_timing_welcomeBackThresholds: (c) => timing(c, 'welcomeBackThresholds'),
  bot_content_timing_cooldownLockMs: (c) => timing(c, 'cooldownLockMs'),
  bot_content_timing_onboardingRetryMaxAttempts: (c) => timing(c, 'onboardingRetryMaxAttempts'),
  // Idle-then-hint (added after the initial editor pass).
  bot_content_timing_startHintEnabled: (c) => timing(c, 'startHintEnabled'),
  bot_content_timing_startHintDelayMs: (c) => timing(c, 'startHintDelayMs'),
  bot_content_timing_startHintCooldownMs: (c) => timing(c, 'startHintCooldownMs'),
  bot_content_timing_startHintQuietHoursEnabled: (c) => timing(c, 'startHintQuietHoursEnabled'),
  bot_content_timing_startHintText: (c) => timing(c, 'startHintText'),
  bot_content_timing_startHintTextAfterWelcomeBack: (c) => timing(c, 'startHintTextAfterWelcomeBack'),

  // Language display
  bot_content_language_en: (c) => language(c, 'en'),
  bot_content_language_fr: (c) => language(c, 'fr'),
  bot_content_language_de: (c) => language(c, 'de'),
  bot_content_language_es: (c) => language(c, 'es'),
  bot_content_language_ar: (c) => language(c, 'ar'),
  // botContentCommand exports ...ToggleSmallCaps (capital C); the lowercase
  // spelling threw a TypeError and surfaced as "menu unavailable".
  bot_content_toggle_smallcaps: (c) => impl(c).then((m) => m.botContentToggleSmallCaps(c)),

  // Group Messages (Phase 3)
  bot_content_edit_group_welcome: (c) => field(c, 'groupMessages.welcome'),
  bot_content_edit_group_goodbye: (c) => field(c, 'groupMessages.goodbye'),

  // Moderation Messages (Phase 4)
  bot_content_edit_mod_warning: (c) => field(c, 'moderationMessages.warningDM'),
  bot_content_edit_mod_mute: (c) => field(c, 'moderationMessages.muteDM'),
  bot_content_edit_mod_unmute: (c) => field(c, 'moderationMessages.unmuteDM'),
  bot_content_edit_mod_kick: (c) => field(c, 'moderationMessages.kickDM'),
  bot_content_edit_mod_ban: (c) => field(c, 'moderationMessages.banDM'),
  bot_content_edit_mod_auto_mute: (c) => field(c, 'moderationMessages.autoMuteDM'),
  bot_content_edit_mod_auto_kick: (c) => field(c, 'moderationMessages.autoKickDM'),

  // Tools
  bot_content_preview: (c) => impl(c).then((m) => m.botContentPreview(c)),
  bot_content_export: (c) => impl(c).then((m) => m.botContentExport(c)),
  bot_content_import: (c) => impl(c).then((m) => m.botContentImportStart(c)),
  bot_content_snapshots: (c) => impl(c).then((m) => m.botContentSnapshots(c)),
  bot_content_reset: (c) => impl(c).then((m) => m.botContentResetMenu(c))
};

const impl = async () => import('../handlers/botContentCommand.js');
const variant = async (c, id) => (await impl()).showVariantEditor(c, id);
const timing = async (c, key) => (await impl()).botContentTimingValue(c, key);
const language = async (c, code) => (await impl()).botContentLanguageEditor(c, code);
  // Group welcome/goodbye reuse the one field editor, keyed by dotted path.
  const field = async (c, path) => (await impl()).showFieldEditor(c, path);