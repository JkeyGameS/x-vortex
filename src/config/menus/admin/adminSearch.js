// Admin Search prompt (Phase 6). Free-text keyword stage: the body owns the
// full legacy layout; input processing stays on handleAdminSearchReply
// (only '0' is router-handled, like test_panel).
export default {
  id: 'admin_search',
  headingKey: 'menu.admin_search.heading',
  headingEmoji: '🔍',
  standaloneCommand: null,
  aliases: [],
  parent: 'adminPanel',
  backTo: 'adminPanel',
  transitionKey: 'admin_search',
  footerKey: null,
  fallbackHeadingKey: 'admin.search.title',
  transitionKey: 'admin_search',
  sessionMenu: 'admin_search',
  adminOnly: true,
  bodyResolver: 'adminSearchBody',
  options: []
};
