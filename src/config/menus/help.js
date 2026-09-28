// Help shell (Phase 8 follow-up).
// The help viewer is paginated and role-aware, and is owned by helpCommand.
// This definition exists so that the main-menu `9` action (`open:help`) resolves
// against the registry instead of failing with "menu not found". The body comes
// from the `helpPage` body resolver, which delegates to
// helpCommand.buildHelpMessage(); pagination and 0/next/prev handling stay in
// helpCommand.openHelp().
export default {
  id: 'help',
  headingKey: 'menuHelp.title',
  headingEmoji: '❓',
  standaloneCommand: null,
  aliases: [],
  parent: 'main_menu',
  backTo: 'main_menu',
  footerKey: 'menu.replyPrompt',
  footerItalic: true,
  bodyResolver: 'helpPage',
  sessionMenu: 'help',
  options: []
};
