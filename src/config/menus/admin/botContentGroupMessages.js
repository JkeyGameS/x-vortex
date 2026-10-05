/**
 * Bot Content -> Group Messages (Group Management Phase 3).
 *
 * Editable templates for the welcome/goodbye messages sent when a member joins
 * or leaves an activated group. Which of the two actually sends is controlled
 * per group by the welcome / goodbye toggles in the group settings panel.
 */
export default {
  id: 'bot_content_group_messages',
  headingKey: 'menu.bot_content.group_messages_heading',
  headingEmoji: '\u{1F465}',
  standaloneCommand: null,
  aliases: [],
  parent: 'bot_content',
  backTo: 'bot_content',
  footerKey: 'menu.replyPrompt',
  adminOnly: true,
  options: [
    {
      number: '1',
      labelKey: 'menu.bot_content.group_welcome',
      emoji: '\u{1F44B}',
      action: 'custom:bot_content_edit_group_welcome'
    },
    {
      number: '2',
      labelKey: 'menu.bot_content.group_goodbye',
      emoji: '\u{1F44B}',
      action: 'custom:bot_content_edit_group_goodbye'
    }
  ]
};