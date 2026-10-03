// Language display: one row per language (name + flag) plus the small-caps
// master switch. Rows toggle small caps; the flag/name are edited per language.
const LANGS = [['1', 'en'], ['2', 'fr'], ['3', 'de'], ['4', 'es'], ['5', 'ar']];

export default {
  id: 'bot_content_language',
  headingKey: 'menu.bot_content.group.language',
  headingEmoji: '🌐',
  parent: 'bot_content',
  backTo: 'bot_content',
  footerKey: 'menu.replyPrompt',
  footerItalic: false,
  fallbackHeadingKey: 'menu.bot_content.group.language',
  sessionMenu: 'bot_content_language',
  adminOnly: true,
  options: [
    ...LANGS.map(([number, code]) => ({
      number,
      labelKey: `menu.bot_content.language.${code}`,
      emoji: '🌐',
      action: `custom:bot_content_language_${code}`,
      dynamicSuffix: 'botContentLanguageRow',
      suffixKey: code
    })),
    {
      number: '6',
      labelKey: 'menu.bot_content.field.smallCapsEnabled',
      emoji: '🔠',
      action: 'custom:bot_content_toggle_smallcaps',
      dynamicSuffix: 'botContentBoolState',
      suffixKey: 'languageDisplay.smallCapsEnabled'
    }
  ]
};