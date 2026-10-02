// Bot Notifications (admin-only). Master switch plus one toggle per event
// type; every row carries a live on/off suffix from the settings store.
const OPTS = [
  // [number, labelKey, action, emoji, suffixResolverName?]
  ['1', 'toggleAll', 'custom:botnotifs_all', '🔛'],
  ['2', 'onStartup', 'custom:botnotifs_startup', '🟢'],
  ['3', 'onShutdown', 'custom:botnotifs_shutdown', '🛑'],
  ['4', 'onCrash', 'custom:botnotifs_crash', '⚠️'],
  ['5', 'onNewUser', 'custom:botnotifs_new_user', '🆕'],
  ['6', 'onOnboardingComplete', 'custom:botnotifs_onboarding_complete', '✅'],
  ['7', 'on_code_change', 'custom:toggle_code_change_notifs', '🛠️', 'codeChangeState']
];

export default {
  id: 'bot_notifications',
  headingKey: 'menu.bot_notifications.heading',
  headingEmoji: '🔔',
  standaloneCommand: '/botnotifs',
  aliases: ['/botnotif', '/botnotify'],
  descriptionKey: 'menu.bot_notifications.heading',
  parent: 'system_settings',
  backTo: 'system_settings',
  transitionKey: 'bot_notifications',
  sessionMenu: 'bot_notifications',
  footerKey: 'menu.bot_notifications.footer',
  footerItalic: true,
  adminOnly: true,
  options: OPTS.map(([number, key, action, emoji, suffix]) => ({
    number,
    labelKey: `menu.bot_notifications.${key}`,
    emoji,
    action,
    // The suffix resolver name, defaulting to the derived botNotifs_<key>State.
    dynamicSuffix: suffix || (key === 'toggleAll' ? 'botNotifsAllState' : `botNotifs_${key}State`)
  }))
};
