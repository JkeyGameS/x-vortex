// User Settings menu. Numbers are user-visible and deliberately sparse:
// 1 and 2 are the account lifecycle actions, 9 is Help.
//
// Help is pinned to 9 across menus as a convention (it sits top-right in the
// Telegram-style layout), so the account actions start at 1 rather than
// filling 3-8 with nothing. Do not "tidy" this into 1-3; the gaps are
// intentional and renumbering would break muscle memory and any screenshot a
// user has already read.
export default {
  id: 'settings',
  headingKey: 'menu.settings.heading',
  headingEmoji: '⚙️',
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
    { number: '1', labelKey: 'menu.settings.delete_account', emoji: '\uD83D\uDDD1\uFE0F', action: 'custom:settings_delete_account', fallbackKey: 'menu.settings.delete_account' },
    { number: '2', labelKey: 'menu.settings.reset_account', emoji: '\u267B\uFE0F', action: 'custom:settings_reset_account', fallbackKey: 'menu.settings.reset_account' },
    { number: '9', labelKey: 'menu.settings.help', emoji: '❓', action: 'custom:settings_help', fallbackKey: 'menuHelp.option' }
  ]
};