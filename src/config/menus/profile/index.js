// Profile menu definition (Phase 4).
// Static 4-option layout mirrors menus.profile.options 1:1 (the legacy view
// never filters by availability — the click-time gate lives in
// dispatchProfileAction, reached via the custom:* handlers below).
// Card lines (user info) come from the profileCard resolver (verbatim copy
// of the legacy body), so no duplication here.
export default {
  id: 'profile',
  headingKey: 'menu.profile.heading',
  headingEmoji: null,
  standaloneCommand: '/profile',
  aliases: ['/me', '/myprofile'],
  parent: 'main_menu',
  backTo: 'main_menu',
  footerKey: 'menu.profile.footer',
  footerItalic: false,
  fallbackHeadingKey: 'profile.title',
  fallbackFooterKey: 'profile.replyPrompt',
  cardResolver: 'profileCard',
  options: [
    { number: '1', labelKey: 'menu.profile.edit', emoji: '✏️', action: 'custom:dispatch_profile_edit', featureId: 'profileEditing', fallbackKey: 'profile.optionEdit' },
    { number: '2', labelKey: 'menu.profile.stats', emoji: '📊', action: 'custom:dispatch_profile_stats', featureId: 'statistics', fallbackKey: 'profile.optionStats' },
    { number: '3', labelKey: 'menu.profile.prefs', emoji: '⚙️', action: 'custom:dispatch_profile_preferences', featureId: 'preferences', fallbackKey: 'profile.optionPreferences' },
    { number: '4', labelKey: 'menu.profile.copy_id', emoji: '🆔', action: 'custom:dispatch_profile_copyid', featureId: 'copyMyId', fallbackKey: 'profile.optionCopyId' }
  ]
};
