// Bot Content & Timing editor: menu tree.
//
// Option numbers here are behaviour, not content: the router and the handlers
// dispatch on them, so they are not admin-editable.
export default {
  id: 'bot_content',
  headingKey: 'menu.bot_content.heading',
  headingEmoji: '🎨',
  standaloneCommand: '/content',
  aliases: ['/botcontent'],
  parent: 'system_settings',
  backTo: 'system_settings',
  footerKey: 'menu.replyPrompt',
  footerItalic: false,
  fallbackHeadingKey: 'menu.bot_content.heading',
  sessionMenu: 'bot_content',
  adminOnly: true,
  summaryResolver: 'botContentSummary',
  options: [
    { number: '1', labelKey: 'menu.bot_content.onboarding', emoji: '👋', action: 'open:bot_content_onboarding' },
    { number: '2', labelKey: 'menu.bot_content.welcome_back', emoji: '🔄', action: 'open:bot_content_welcome_back' },
    { number: '3', labelKey: 'menu.bot_content.timing', emoji: '⏱️', action: 'open:bot_content_timing' },
    { number: '4', labelKey: 'menu.bot_content.language', emoji: '🌐', action: 'open:bot_content_language' },
    { number: '5', labelKey: 'menu.bot_content.preview', emoji: '👁️', action: 'custom:bot_content_preview' },
    { number: '6', labelKey: 'menu.bot_content.export', emoji: '💾', action: 'custom:bot_content_export' },
    { number: '7', labelKey: 'menu.bot_content.import', emoji: '📥', action: 'custom:bot_content_import' },
    { number: '8', labelKey: 'menu.bot_content.snapshots', emoji: '📸', action: 'custom:bot_content_snapshots' },
    { number: '9', labelKey: 'menu.bot_content.reset', emoji: '♻️', action: 'custom:bot_content_reset' }
  ]
};