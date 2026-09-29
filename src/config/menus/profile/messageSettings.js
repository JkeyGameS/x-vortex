// Message Display (user). Lets each user pick how menu updates are shown.
// Rows carry a live "current mode" suffix; when the admin locks overrides the
// rows show a lock suffix instead and selection is refused.
const OPTS = [
  ['1', 'edit', '✏️'],
  ['2', 'send_new', '📤'],
  ['3', 'delete_send', '🗑️'],
  ['4', 'hybrid', '🔀']
];

export default {
  id: 'message_display',
  headingKey: 'menu.message_display.heading',
  headingEmoji: '📩',
  standaloneCommand: null,
  aliases: [],
  parent: 'preferences',
  backTo: 'preferences',
  transitionKey: 'message_display',
  sessionMenu: 'message_display',
  footerKey: 'menu.message_display.footer',
  footerItalic: true,
  summaryResolver: 'messageDisplaySummary',
  options: OPTS.map(([number, key, emoji]) => ({
    number,
    labelKey: `menu.message_display.${key}`,
    emoji,
    action: `custom:set_user_mode_${key}`,
    dynamicSuffix: `messageMode_${key}State`
  }))
};
