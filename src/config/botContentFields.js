// Admin-editable fields, in one place.
//
// Every entry is a dotted path into botContent plus the placeholders that field
// understands. The editor renders the hints from this map, so adding a field
// means adding one line here and nothing else.
//
// Emoji are part of the stored copy and are never surfaced as their own
// editable field.
export const EDITABLE_FIELDS = {
  'onboarding.firstMessage.greeting': {
    labelKey: 'menu.bot_content.field.greeting',
    placeholders: ['timeOfDay', 'pushName']
  },
  'onboarding.firstMessage.detectedLine': {
    labelKey: 'menu.bot_content.field.detectedLine',
    placeholders: ['languageName', 'languageFlag']
  },
  'onboarding.firstMessage.languagesPreview': { labelKey: 'menu.bot_content.field.languagesPreview', placeholders: [] },
  'onboarding.firstMessage.question': { labelKey: 'menu.bot_content.field.question', placeholders: [] },
  'onboarding.firstMessage.option1': {
    labelKey: 'menu.bot_content.field.option1',
    placeholders: ['languageName', 'languageFlag']
  },
  'onboarding.firstMessage.option2': { labelKey: 'menu.bot_content.field.option2', placeholders: [] },
  'onboarding.firstMessage.notSupportedHint': { labelKey: 'menu.bot_content.field.notSupportedHint', placeholders: [] },
  'onboarding.firstMessage.replyHint': { labelKey: 'menu.bot_content.field.replyHint', placeholders: [] },

  'onboarding.resumeMessage.headingShort': { labelKey: 'menu.bot_content.field.headingShort', placeholders: [] },
  'onboarding.resumeMessage.bodyShort': { labelKey: 'menu.bot_content.field.bodyShort', placeholders: ['pushName'] },
  'onboarding.resumeMessage.headingLong': { labelKey: 'menu.bot_content.field.headingLong', placeholders: [] },
  'onboarding.resumeMessage.bodyLong': { labelKey: 'menu.bot_content.field.bodyLong', placeholders: ['pushName'] },
  'onboarding.resumeMessage.optionYes': { labelKey: 'menu.bot_content.field.optionYes', placeholders: [] },
  'onboarding.resumeMessage.optionNo': { labelKey: 'menu.bot_content.field.optionNo', placeholders: [] },
  'onboarding.resumeMessage.replyHint': { labelKey: 'menu.bot_content.field.replyHint', placeholders: [] },
  'onboarding.resumeMessage.resumeYesHeading': { labelKey: 'menu.bot_content.field.resumeYesHeading', placeholders: [] },
  'onboarding.resumeMessage.resumeNoHeading': { labelKey: 'menu.bot_content.field.resumeNoHeading', placeholders: [] },
  'onboarding.resumeMessage.resumeNoBody': { labelKey: 'menu.bot_content.field.resumeNoBody', placeholders: ['pushName'] },
  'onboarding.resumeMessage.resumeNoHint': { labelKey: 'menu.bot_content.field.resumeNoHint', placeholders: [] },
  'onboarding.resumeMessage.unclearAttempt1': { labelKey: 'menu.bot_content.field.unclearAttempt1', placeholders: [] },
  'onboarding.resumeMessage.unclearAttempt2': { labelKey: 'menu.bot_content.field.unclearAttempt2', placeholders: [] },
  'onboarding.resumeMessage.unclearAttempt3': { labelKey: 'menu.bot_content.field.unclearAttempt3', placeholders: [] },

  'onboarding.welcomeMessage.heading': {
    labelKey: 'menu.bot_content.field.welcomeHeading',
    placeholders: ['botName']
  },
  'onboarding.welcomeMessage.body': {
    labelKey: 'menu.bot_content.field.welcomeBody',
    placeholders: ['pushName', 'botName']
  },
  'onboarding.unsupportedLanguage.message': {
    labelKey: 'menu.bot_content.field.unsupportedMessage',
    placeholders: ['detectedRaw']
  },

  'onboarding.retry.attempt1': { labelKey: 'menu.bot_content.field.retry1', placeholders: [] },
  'onboarding.retry.attempt2': { labelKey: 'menu.bot_content.field.retry2', placeholders: [] },
  'onboarding.retry.attempt3': { labelKey: 'menu.bot_content.field.retry3', placeholders: [] },

  'onboarding.cooldownLock.heading': { labelKey: 'menu.bot_content.field.cooldownHeading', placeholders: [] },
  'onboarding.cooldownLock.body': {
    labelKey: 'menu.bot_content.field.cooldownBody',
    placeholders: ['minutes']
  },

  // Group Management Phase 3: welcome / goodbye sent on join / leave.
  'groupMessages.welcome': {
    labelKey: 'menu.bot_content.group_welcome',
    placeholders: ['pushName', 'groupName', 'memberCount', 'botName']
  },
  'groupMessages.goodbye': {
    labelKey: 'menu.bot_content.group_goodbye',
    placeholders: ['pushName', 'groupName', 'botName']
  },

  // Moderation DMs (Phase 4).
  'moderationMessages.warningDM': {
    labelKey: 'menu.bot_content.mod_warning',
    placeholders: ['pushName', 'groupName', 'reason', 'count', 'threshold']
  },
  'moderationMessages.muteDM': {
    labelKey: 'menu.bot_content.mod_mute',
    placeholders: ['pushName', 'groupName', 'duration', 'reason']
  },
  'moderationMessages.unmuteDM': {
    labelKey: 'menu.bot_content.mod_unmute',
    placeholders: ['pushName', 'groupName']
  },
  'moderationMessages.kickDM': {
    labelKey: 'menu.bot_content.mod_kick',
    placeholders: ['pushName', 'groupName', 'reason']
  },
  'moderationMessages.banDM': {
    labelKey: 'menu.bot_content.mod_ban',
    placeholders: ['pushName', 'groupName', 'reason']
  },
  'moderationMessages.autoMuteDM': {
    labelKey: 'menu.bot_content.mod_auto_mute',
    placeholders: ['pushName', 'groupName', 'duration', 'threshold']
  },
  'moderationMessages.autoKickDM': {
    labelKey: 'menu.bot_content.mod_auto_kick',
    placeholders: ['pushName', 'groupName', 'threshold']
  },
  // Anti-spam / anti-link (Phase 5).
  'moderationMessages.antiLinkWarning': {
    labelKey: 'menu.bot_content.moderation_anti_link_warning',
    placeholders: ['pushName', 'groupName', 'count', 'threshold']
  },
  'moderationMessages.antiSpamWarning': {
    labelKey: 'menu.bot_content.moderation_anti_spam_warning',
    placeholders: ['pushName', 'groupName', 'count', 'threshold']
  },
  'moderationMessages.antiLinkMuted': {
    labelKey: 'menu.bot_content.moderation_anti_link_muted',
    placeholders: ['pushName', 'groupName', 'duration']
  },
  'moderationMessages.antiSpamMuted': {
    labelKey: 'menu.bot_content.moderation_anti_spam_muted',
    placeholders: ['pushName', 'groupName', 'duration']
  }
};

/** Welcome-back variant pools, addressed by variant id. */
export const EDITABLE_VARIANTS = ['A1', 'A2', 'A3', 'A4', 'B1', 'B2', 'B3'];

/** Scalar timing fields, with the kind of editor they use. */
export const EDITABLE_TIMING = {
  'timing.typingDelayMs': { labelKey: 'menu.bot_content.field.typingDelayMs', type: 'number' },
  'timing.typingAdaptivePerCharMs': { labelKey: 'menu.bot_content.field.typingAdaptivePerCharMs', type: 'number' },
  'timing.typingAdaptiveMinMs': { labelKey: 'menu.bot_content.field.typingAdaptiveMinMs', type: 'number' },
  'timing.typingAdaptiveMaxMs': { labelKey: 'menu.bot_content.field.typingAdaptiveMaxMs', type: 'number' },
  'timing.welcomeBackThresholds.minGapMs': { labelKey: 'menu.bot_content.field.minGapMs', type: 'number' },
  'timing.welcomeBackThresholds.shortGapMs': { labelKey: 'menu.bot_content.field.shortGapMs', type: 'number' },
  'timing.welcomeBackThresholds.dayGapMs': { labelKey: 'menu.bot_content.field.dayGapMs', type: 'number' },
  'timing.welcomeBackThresholds.weekGapMs': { labelKey: 'menu.bot_content.field.weekGapMs', type: 'number' },
  'timing.cooldownLockMs': { labelKey: 'menu.bot_content.field.cooldownLockMs', type: 'number' },
  'timing.onboardingRetryMaxAttempts': { labelKey: 'menu.bot_content.field.retryMaxAttempts', type: 'number' },
  'timing.startHintEnabled': { labelKey: 'menu.bot_content.field.startHintEnabled', type: 'bool' },
  'timing.startHintDelayMs': { labelKey: 'menu.bot_content.field.startHintDelayMs', type: 'number' },
  'timing.startHintCooldownMs': { labelKey: 'menu.bot_content.field.startHintCooldownMs', type: 'number' },
  'timing.startHintQuietHoursEnabled': { labelKey: 'menu.bot_content.field.startHintQuietHoursEnabled', type: 'bool' },
  'timing.startHintText': {
    labelKey: 'menu.bot_content.field.startHintText',
    type: 'text',
    placeholders: ['botName', 'timeOfDay']
  },
  'timing.startHintTextAfterWelcomeBack': {
    labelKey: 'menu.bot_content.field.startHintTextAfterWelcomeBack',
    type: 'text',
    placeholders: ['botName', 'timeOfDay']
  },
  'timing.startHintQuietHoursStart': { labelKey: 'menu.bot_content.field.startHintQuietHoursStart', type: 'text' },
  'timing.startHintQuietHoursEnd': { labelKey: 'menu.bot_content.field.startHintQuietHoursEnd', type: 'text' },
  'timing.typingIndicatorEnabled': { labelKey: 'menu.bot_content.field.typingIndicatorEnabled', type: 'bool' },
  'timing.typingMode': { labelKey: 'menu.bot_content.field.typingMode', type: 'enum', values: ['adaptive', 'fixed'] },
  'languageDisplay.smallCapsEnabled': { labelKey: 'menu.bot_content.field.smallCapsEnabled', type: 'bool' }
};

/** Reset targets offered in the reset submenu. */
export const RESET_SECTIONS = [
  { key: 'all', labelKey: 'menu.bot_content.reset.all' },
  { key: 'onboarding', labelKey: 'menu.bot_content.reset.onboarding' },
  { key: 'welcomeBack', labelKey: 'menu.bot_content.reset.welcomeBack' },
  { key: 'timing', labelKey: 'menu.bot_content.reset.timing' },
  { key: 'languageDisplay', labelKey: 'menu.bot_content.reset.languageDisplay' },
  { key: 'groupMessages', labelKey: 'menu.bot_content.reset.groupMessages' },
  { key: 'moderationMessages', labelKey: 'menu.bot_content.reset.moderationMessages' }
];

/** Sample values used for every preview. */
export const SAMPLE_CTX = {
  pushName: 'John',
  languageName: 'English',
  languageFlag: '🇬🇧',
  timeOfDay: 'good morning',
  botName: 'X-Vortex',
  minutes: 5,
  detectedRaw: 'Portuguese',
  // Group placeholders, so the welcome/goodbye preview renders fully.
  groupName: 'Dev Team',
  memberCount: 12,
  // Moderation placeholders, so the moderation DM preview renders fully.
  reason: 'repeated link posting',
  duration: '30 minutes',
  count: 2,
  threshold: 5
};

/** All field paths an editor can be launched for, in menu order. */
export function fieldList() {
  return Object.entries(EDITABLE_FIELDS).map(([path, meta]) => ({ path, ...meta }));
}