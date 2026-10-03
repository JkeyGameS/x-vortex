// Welcome-back copy: one row per variant pool, with the live variant count.
const VARIANTS = [
  ['1', 'A1', '5 min - 1 h'], ['2', 'A2', '1 h - 24 h'],
  ['3', 'A3', '24 h - 7 d'], ['4', 'A4', '7 d+'],
  ['5', 'B1', 'under 24 h'], ['6', 'B2', '24 h - 7 d'], ['7', 'B3', '7 d+']
];

export default {
  id: 'bot_content_welcome_back',
  headingKey: 'menu.bot_content.group.welcomeBack',
  headingEmoji: '🔄',
  parent: 'bot_content',
  backTo: 'bot_content',
  footerKey: 'menu.replyPrompt',
  footerItalic: false,
  fallbackHeadingKey: 'menu.bot_content.group.welcomeBack',
  sessionMenu: 'bot_content_welcome_back',
  adminOnly: true,
  options: VARIANTS.map(([number, variant, range]) => ({
    number,
    labelKey: `menu.bot_content.variant.${variant}`,
    emoji: variant.startsWith('A') ? '👋' : '🔄',
    action: `custom:bot_content_variant_${variant}`,
    dynamicSuffix: 'botContentVariantCount',
    suffixKey: variant,
    range
  }))
};