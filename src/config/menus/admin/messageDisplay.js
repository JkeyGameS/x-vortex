// Message Display (admin, global). Sets the default mode and the two override
// switches. Mode labels are chosen through a dedicated handler because the
// admin picks one of four modes from a single row.
const OPTS = [
  ['1', 'default_mode', '🔀', 'custom:set_message_mode_default'],
  ['2', 'user_override', '🔓', 'custom:toggle_user_override'],
  ['3', 'per_menu_override', '🎯', 'custom:toggle_per_menu_override']
];

export default {
  id: 'message_display_admin',
  headingKey: 'menu.message_display_admin.heading',
  headingEmoji: '📩',
  standaloneCommand: '/msgdisplay',
  aliases: ['/msgmode'],
  descriptionKey: 'menu.message_display_admin.heading',
  parent: 'general_settings',
  backTo: 'system_settings',
  transitionKey: 'message_display_admin',
  sessionMenu: 'message_display_admin',
  footerKey: 'menu.message_display_admin.footer',
  footerItalic: true,
  adminOnly: true,
  summaryResolver: 'messageDisplayAdminSummary',
  options: OPTS.map(([number, key, emoji, action]) => ({
    number,
    labelKey: `menu.message_display_admin.${key}`,
    emoji,
    action,
    dynamicSuffix: `messageDisplayAdmin_${key}State`
  }))
};
