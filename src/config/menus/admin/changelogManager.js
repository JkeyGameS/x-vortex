// Changelog Manager (admin-only). Reached from System Settings and /changelog.
// Option rows are custom: actions; the reply handling for this menu and all of
// its sub-states lives in handlers/changelogManagerCommand.js.
export default {
  id: 'changelog_manager',
  headingKey: 'menu.changelog_manager.heading',
  headingEmoji: '🛠️',
  standaloneCommand: '/changelog',
  aliases: ['/chlog'],
  descriptionKey: 'menu.changelog_manager.heading',
  parent: 'system_settings',
  backTo: 'system_settings',
  transitionKey: 'changelog_manager',
  sessionMenu: 'changelog_manager',
  footerKey: 'menu.replyPrompt',
  adminOnly: true,
  summaryResolver: 'changelogManagerSummary',
  options: [
    { number: '1', labelKey: 'menu.changelog_manager.review_drafts', emoji: '📥', action: 'custom:changelog_review_drafts' },
    { number: '2', labelKey: 'menu.changelog_manager.list_versions', emoji: '📜', action: 'custom:changelog_list_versions' },
    { number: '3', labelKey: 'menu.changelog_manager.add_entry', emoji: '➕', action: 'custom:changelog_add_entry' },
    { number: '4', labelKey: 'menu.changelog_manager.edit_entry', emoji: '✏️', action: 'custom:changelog_edit_entry' },
    { number: '5', labelKey: 'menu.changelog_manager.delete_entry', emoji: '🗑️', action: 'custom:changelog_delete_entry' },
    { number: '6', labelKey: 'menu.changelog_manager.set_version', emoji: '🔢', action: 'custom:changelog_set_version' },
    { number: '7', labelKey: 'menu.changelog_manager.export', emoji: '📤', action: 'custom:changelog_export' },
    { number: '8', labelKey: 'menu.changelog_manager.import', emoji: '📥', action: 'custom:changelog_import' }
  ]
};