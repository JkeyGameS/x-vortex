// Snippet Import/Export submenu (Phase 7).
export default {
  id: 'snippet_impex',
  headingKey: 'menu.snippet_impex.heading',
  headingEmoji: null,
  standaloneCommand: null,
  aliases: [],
  parent: 'snippets',
  backTo: 'snippets',
  footerKey: null,
  fallbackHeadingKey: 'chatResponses.snippetsImportExport',
  transitionKey: 'chat_snippet_impex',
  sessionMenu: 'chat_snippet_impex',
  adminOnly: true,
  options: [
    { number: '1', labelKey: 'menu.snippet_impex.export', emoji: '📤', action: 'custom:snip_impex_export', fallbackKey: 'chatResponses.snippetsExport' },
    { number: '2', labelKey: 'menu.snippet_impex.import', emoji: '📥', action: 'custom:snip_impex_import', fallbackKey: 'chatResponses.snippetsImport' }
  ]
};
