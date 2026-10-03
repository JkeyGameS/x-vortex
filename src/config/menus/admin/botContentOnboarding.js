// Onboarding copy: every editable string, grouped by the message it belongs to.
const GROUP = (number, key, fields) => ({
  number,
  labelKey: `menu.bot_content.group.${key}`,
  emoji: fields.emoji,
  action: `custom:bot_content_group_${key}`,
  fields
});

export default {
  id: 'bot_content_onboarding',
  headingKey: 'menu.bot_content.group.onboarding',
  headingEmoji: '👋',
  parent: 'bot_content',
  backTo: 'bot_content',
  footerKey: 'menu.replyPrompt',
  footerItalic: false,
  fallbackHeadingKey: 'menu.bot_content.group.onboarding',
  sessionMenu: 'bot_content_onboarding',
  adminOnly: true,
  options: [
    GROUP('1', 'firstMessage', {
      emoji: '👋',
      paths: [
        'onboarding.firstMessage.greeting',
        'onboarding.firstMessage.detectedLine',
        'onboarding.firstMessage.languagesPreview',
        'onboarding.firstMessage.question',
        'onboarding.firstMessage.option1',
        'onboarding.firstMessage.option2',
        'onboarding.firstMessage.notSupportedHint',
        'onboarding.firstMessage.replyHint'
      ]
    }),
    GROUP('2', 'resumeMessage', {
      emoji: '🔄',
      paths: [
        'onboarding.resumeMessage.headingShort',
        'onboarding.resumeMessage.bodyShort',
        'onboarding.resumeMessage.headingLong',
        'onboarding.resumeMessage.bodyLong',
        'onboarding.resumeMessage.optionYes',
        'onboarding.resumeMessage.optionNo',
        'onboarding.resumeMessage.replyHint',
        'onboarding.resumeMessage.resumeYesHeading',
        'onboarding.resumeMessage.resumeNoHeading',
        'onboarding.resumeMessage.resumeNoBody',
        'onboarding.resumeMessage.resumeNoHint',
        'onboarding.resumeMessage.unclearAttempt1',
        'onboarding.resumeMessage.unclearAttempt2',
        'onboarding.resumeMessage.unclearAttempt3'
      ]
    }),
    GROUP('3', 'welcomeMessage', {
      emoji: '🎉',
      paths: ['onboarding.welcomeMessage.heading', 'onboarding.welcomeMessage.body']
    }),
    GROUP('4', 'unsupportedLanguage', {
      emoji: '🌐',
      paths: ['onboarding.unsupportedLanguage.message']
    }),
    GROUP('5', 'retry', {
      emoji: '🔄',
      paths: ['onboarding.retry.attempt1', 'onboarding.retry.attempt2', 'onboarding.retry.attempt3']
    }),
    GROUP('6', 'cooldownLock', {
      emoji: '⏳',
      paths: ['onboarding.cooldownLock.heading', 'onboarding.cooldownLock.body']
    })
  ]
};