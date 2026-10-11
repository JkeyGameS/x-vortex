// User Settings menu. Help is option 9; 4 and 5 are the account lifecycle
// actions. Options are not renumbered -- the numbers are user-visible and the
// gaps are deliberate, not an oversight.
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
    { number: '4', labelKey: 'menu.settings.delete_account', emoji: '\uD83D\uDDD1\uFE0F', action: 'custom:settings_delete_account', fallbackKey: 'menu.settings.delete_account' },
    { number: '5', labelKey: 'menu.settings.reset_account', emoji: '\u267B', action: 'custom:settings_reset_account', fallbackKey: 'menu.settings.reset_account' },
    { number: '9', labelKey: 'menu.settings.help', emoji: '\u2753', action: 'custom:settings_help', fallbackKey: 'menuHelp.option' }
  ]
};
