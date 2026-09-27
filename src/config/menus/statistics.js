// User Statistics menu (Phase 7). Dashboard counts come from the
// statsDashboard resolver (verbatim); admin rows are adminOnly-gated.
export default {
  id: 'statistics',
  headingKey: 'menu.statistics.heading',
  headingEmoji: '📊',
  standaloneCommand: '/stats',
  aliases: ['/statistics'],
  parent: 'main_menu',
  backTo: 'main_menu',
  footerKey: 'menu.statistics.footer',
  footerItalic: false,
  fallbackHeadingKey: 'statsMenu.title',
  fallbackFooterKey: 'statsMenu.replyPrompt',
  dashboardResolver: 'statsDashboard',
  transitionKey: 'stats_menu',
  sessionMenu: 'stats_main',
  options: [
    { number: '1', labelKey: 'menu.statistics.my_stats', emoji: '📈', action: 'custom:stats_my', fallbackKey: 'statsMenu.optMy' },
    { number: '2', labelKey: 'menu.statistics.top_commands', emoji: '🔝', action: 'custom:stats_top_commands', adminOnly: true, fallbackKey: 'statsMenu.optTopCommands' },
    { number: '3', labelKey: 'menu.statistics.top_users', emoji: '🏆', action: 'custom:stats_top_users', adminOnly: true, fallbackKey: 'statsMenu.optTopUsers' },
    { number: '4', labelKey: 'menu.statistics.feedback', emoji: '📮', action: 'custom:stats_feedback', adminOnly: true, fallbackKey: 'statsMenu.optFeedback' },
    { number: '5', labelKey: 'menu.statistics.advanced', emoji: '📊', action: 'custom:stats_advanced', adminOnly: true, fallbackKey: 'statsMenu.optAdvanced' }
  ]
};
