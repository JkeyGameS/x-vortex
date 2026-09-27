// Reply Snippets menu (Phase 5). Labels have no emojis (legacy); flows stay
// on existing handlers via custom: actions.
export default {
  id: 'snippets',
  headingKey: 'menu.snippets.heading',
  headingEmoji: '🧩',
  standaloneCommand: '/snippets',
  aliases: ['/snips'],
  parent: 'chat_faq',
  backTo: 'chat_responses',
  footerKey: null,
  fallbackHeadingKey: 'chatResponses.snippetsTitle',
  transitionKey: 'chat_snippets',
  sessionMenu: 'chat_snippets',
  adminOnly: true,
  options: [
    { number: '1', labelKey: 'menu.snippets.list', emoji: null, action: 'custom:snippet_list', fallbackKey: 'chatResponses.snippetsList' },
    { number: '2', labelKey: 'menu.snippets.add', emoji: null, action: 'custom:snippet_add', fallbackKey: 'chatResponses.snippetsAdd' },
    { number: '3', labelKey: 'menu.snippets.edit', emoji: null, action: 'custom:snippet_edit', fallbackKey: 'chatResponses.snippetsEdit' },
    { number: '4', labelKey: 'menu.snippets.delete', emoji: null, action: 'custom:snippet_delete', fallbackKey: 'chatResponses.snippetsDelete' },
    { number: '5', labelKey: 'menu.snippets.translate', emoji: null, action: 'custom:snippet_translate', fallbackKey: 'chatResponses.snippetsTranslate' },
    { number: '6', labelKey: 'menu.snippets.import_export', emoji: null, action: 'custom:snippet_impexport', fallbackKey: 'chatResponses.snippetsImportExport' }
  ]
};
