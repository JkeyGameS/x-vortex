// FAQ Manage submenu (Phase 7).
const OPTS = [
  ['1', 'edit', '✏️', 'custom:faq_manage_edit', 'faq.manageEdit'],
  ['2', 'delete', '🗑️', 'custom:faq_manage_delete', 'faq.manageDelete'],
  ['3', 'toggle', '🔛', 'custom:faq_manage_toggle', 'faq.manageToggle'],
  ['4', 'duplicate', '📋', 'custom:faq_manage_duplicate', 'faq.manageDuplicate'],
  ['5', 'enable_all', '✅', 'custom:faq_manage_enable_all', 'faq.manageEnableAll'],
  ['6', 'disable_all', '❌', 'custom:faq_manage_disable_all', 'faq.manageDisableAll'],
  ['7', 'bulk_toggle', '🔀', 'custom:faq_manage_bulk', 'faq.manageBulkToggle']
];

export default {
  id: 'faq_manage',
  headingKey: 'menu.faq_manage.heading',
  headingEmoji: '✏️',
  standaloneCommand: null,
  aliases: [],
  parent: 'faq',
  backTo: 'faq',
  footerKey: 'menu.faq_manage.footer',
  footerItalic: false,
  fallbackHeadingKey: 'faq.manageMenuTitle',
  fallbackFooterKey: 'admin.replyPrompt',
  transitionKey: 'faq_manage',
  sessionMenu: 'faq_manage',
  adminOnly: true,
  options: OPTS.map(([number, key, emoji, action, oldKey]) => ({
    number, labelKey: `menu.faq_manage.${key}`, emoji, action, fallbackKey: oldKey
  }))
};
