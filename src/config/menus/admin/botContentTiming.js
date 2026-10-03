// Timing and delays. Each row maps to one scalar in botContent.timing.
const T = (number, key) => ({
  number,
  labelKey: `menu.bot_content.field.${key}`,
  emoji: '⏱️',
  action: `custom:bot_content_timing_${key}`,
  dynamicSuffix: 'botContentTimingValue',
  suffixKey: key
});

export default {
  id: 'bot_content_timing',
  headingKey: 'menu.bot_content.group.timing',
  headingEmoji: '⏱️',
  parent: 'bot_content',
  backTo: 'bot_content',
  footerKey: 'menu.replyPrompt',
  footerItalic: false,
  fallbackHeadingKey: 'menu.bot_content.group.timing',
  sessionMenu: 'bot_content_timing',
  adminOnly: true,
  options: [
    T('1', 'typingIndicatorEnabled'),
    T('2', 'typingMode'),
    T('3', 'typingDelayMs'),
    T('4', 'typingTargeting'),
    T('5', 'welcomeBackThresholds'),
    T('6', 'cooldownLockMs'),
    T('7', 'onboardingRetryMaxAttempts')
  ]
};