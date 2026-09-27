// User Settings menu (Phase 7). Single help option; '0' returns to main.
export default {
  id: 'settings',
  headingKey: 'menu.settings.heading',
  headingEmoji: null,
  standaloneCommand: '/settings',
  aliases: ['/set'],
  parent: 'main_menu',
  backTo: 'main_menu',
  footerKey: 'menu.settings.footer',
  footerItalic: false,
  fallbackHeadingKey: 'settings.title',
  fallbackFooterKey: 'settings.replyPrompt',
  transitionKey: 'main_to_settings',
  sessionMenu: 'settings',
  options: [
    { number: '9', labelKey: 'menu.settings.help', emoji: '❓', action: 'custom:settings_help', fallbackKey: 'menuHelp.option' }
  ]
};
