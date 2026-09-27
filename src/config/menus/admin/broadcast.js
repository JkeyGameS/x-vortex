// Broadcast submenu (Phase 6). Options 1-2 have no emojis (legacy);
// option 3 keeps its inline emoji via the definition field.
export default {
  id: 'broadcast',
  headingKey: 'menu.broadcast.heading',
  headingEmoji: '📢',
  standaloneCommand: '/broadcast',
  aliases: ['/bc'],
  parent: 'adminPanel',
  backTo: 'adminPanel',
  transitionKey: 'broadcast_submenu',
  footerKey: 'menu.broadcast.footer',
  footerItalic: false,
  fallbackHeadingKey: 'admin.optionBroadcast',
  fallbackFooterKey: 'admin.replyPrompt',
  transitionKey: 'broadcast_submenu',
  sessionMenu: 'broadcast_submenu',
  adminOnly: true,
  options: [
    { number: '1', labelKey: 'menu.broadcast.send_now', emoji: null, action: 'custom:broadcast_send_now', fallbackKey: 'admin.broadcast.optionSendNow' },
    { number: '2', labelKey: 'menu.broadcast.schedule', emoji: null, action: 'custom:broadcast_schedule', fallbackKey: 'admin.broadcast.optionSchedule' },
    { number: '3', labelKey: 'menu.broadcast.templates', emoji: '📁', action: 'custom:broadcast_templates', fallbackKey: 'admin.broadcast.optionTemplates' }
  ]
};
