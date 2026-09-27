// Info main menu (Phase 7). Feature-count dashboard via infoDashboard.
export default {
  id: 'info',
  headingKey: 'menu.info.heading',
  headingEmoji: 'ℹ️',
  standaloneCommand: '/info',
  aliases: ['/about'],
  parent: 'main_menu',
  backTo: 'main_menu',
  footerKey: 'menu.info.footer',
  footerItalic: false,
  fallbackHeadingKey: 'info.title',
  fallbackFooterKey: 'info.replyPrompt',
  dashboardResolver: 'infoDashboard',
  transitionKey: 'info_menu',
  sessionMenu: 'info',
  options: [
    { number: '1', labelKey: 'menu.info.about', emoji: '🤖', action: 'custom:info_about', fallbackKey: 'info.optionAbout' },
    { number: '2', labelKey: 'menu.info.version', emoji: '📝', action: 'custom:info_version', fallbackKey: 'info.optionVersion' },
    { number: '3', labelKey: 'menu.info.developer', emoji: '👨‍💻', action: 'custom:info_developer', fallbackKey: 'info.optionDeveloper' },
    { number: '4', labelKey: 'menu.info.website', emoji: '🌐', action: 'custom:info_website', fallbackKey: 'info.optionWebsite' }
  ]
};
