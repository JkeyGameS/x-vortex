/**
 * Bot Content -> Moderation Messages (Group Management Phase 4).
 *
 * The DMs sent to a user when they are warned, muted, kicked or banned, plus the
 * two automatic-escalation notices.
 */
export default {
  id: 'bot_content_moderation',
  headingKey: 'menu.bot_content.moderation_messages_heading',
  headingEmoji: '\u26A0\uFE0F',
  standaloneCommand: null,
  aliases: [],
  parent: 'bot_content',
  backTo: 'bot_content',
  footerKey: 'menu.replyPrompt',
  adminOnly: true,
  options: [
    { number: '1', labelKey: 'menu.bot_content.mod_warning', emoji: '\u26A0\uFE0F', action: 'custom:bot_content_edit_mod_warning' },
    { number: '2', labelKey: 'menu.bot_content.mod_mute', emoji: '\u{1F507}', action: 'custom:bot_content_edit_mod_mute' },
    { number: '3', labelKey: 'menu.bot_content.mod_unmute', emoji: '\u{1F50A}', action: 'custom:bot_content_edit_mod_unmute' },
    { number: '4', labelKey: 'menu.bot_content.mod_kick', emoji: '\u{1F44B}', action: 'custom:bot_content_edit_mod_kick' },
    { number: '5', labelKey: 'menu.bot_content.mod_ban', emoji: '\u26D4', action: 'custom:bot_content_edit_mod_ban' },
    { number: '6', labelKey: 'menu.bot_content.mod_auto_mute', emoji: '\u{1F507}', action: 'custom:bot_content_edit_mod_auto_mute' },
    { number: '7', labelKey: 'menu.bot_content.mod_auto_kick', emoji: '\u{1F44B}', action: 'custom:bot_content_edit_mod_auto_kick' },
    // Anti-spam / anti-link templates (Phase 5). 1-7 were taken by Phase 4.
    { number: '8', labelKey: 'menu.bot_content.moderation_anti_link_warning', emoji: '\u{1F517}', action: 'custom:bot_content_edit_anti_link_warning' },
    { number: '9', labelKey: 'menu.bot_content.moderation_anti_spam_warning', emoji: '\u26A0\uFE0F', action: 'custom:bot_content_edit_anti_spam_warning' },
    { number: '10', labelKey: 'menu.bot_content.moderation_anti_link_muted', emoji: '\u{1F507}', action: 'custom:bot_content_edit_anti_link_muted' },
    { number: '11', labelKey: 'menu.bot_content.moderation_anti_spam_muted', emoji: '\u{1F507}', action: 'custom:bot_content_edit_anti_spam_muted' }
  ]
};