// Command Analytics top menu (Phase 6). Legacy computes a top-commands body
// but never renders it — mirrored exactly (options only).
export default {
  id: 'analytics',
  headingKey: 'menu.analytics.heading',
  headingEmoji: '📊',
  standaloneCommand: '/analytics',
  aliases: [],
  parent: 'adminPanel',
  backTo: 'adminPanel',
  transitionKey: 'command_analytics',
  footerKey: null,
  fallbackHeadingKey: 'admin.analytics.title',
  transitionKey: 'command_analytics',
  sessionMenu: 'command_analytics',
  adminOnly: true,
  options: [
    { number: '1', labelKey: 'menu.analytics.top_commands', emoji: '📊', action: 'custom:analytics_top', fallbackKey: 'admin.analytics.optionTop' },
    { number: '2', labelKey: 'menu.analytics.response_time', emoji: '⏱️', action: 'custom:analytics_response', fallbackKey: 'admin.analytics.optionResponseTime' }
  ]
};
