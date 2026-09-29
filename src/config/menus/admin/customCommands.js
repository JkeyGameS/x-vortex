// Custom Commands (admin). Lets admins define user-triggered commands at
// runtime. The wizards behind each row are stateful, so they live in
// menuCustomHandlers and drive their own input prompts.
const OPTS = [
  ['1', 'list', '📋', 'custom:custom_cmds_list'],
  ['2', 'add', '➕', 'custom:custom_cmds_add'],
  ['3', 'edit', '✏️', 'custom:custom_cmds_edit'],
  ['4', 'delete', '🗑️', 'custom:custom_cmds_delete'],
  ['5', 'toggle', '🔛', 'custom:custom_cmds_toggle'],
  ['6', 'import_export', '📦', 'custom:custom_cmds_impex']
];

export default {
  id: 'custom_commands',
  headingKey: 'menu.custom_commands.heading',
  headingEmoji: '🛠️',
  standaloneCommand: '/customcmds',
  aliases: ['/cc'],
  descriptionKey: 'menu.custom_commands.heading',
  parent: 'system_settings',
  backTo: 'system_settings',
  transitionKey: 'custom_commands',
  sessionMenu: 'custom_commands',
  footerKey: 'menu.custom_commands.footer',
  footerItalic: true,
  adminOnly: true,
  summaryResolver: 'customCommandsSummary',
  options: OPTS.map(([number, key, emoji, action]) => ({
    number,
    labelKey: `menu.custom_commands.${key}`,
    emoji,
    action
  }))
};
