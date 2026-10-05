/**
 * Group Management (Phase 1) — activation and routing skeleton.
 *
 * Per-group settings, welcome/goodbye, moderation, anti-spam and stats are
 * later phases; options here are deliberately coarse.
 */
export default {
  id: 'group_management',
  headingKey: 'menu.group_management.heading',
  headingEmoji: '\u{1F465}',
  standaloneCommand: '/groups',
  aliases: ['/gm'],
  parent: 'main_menu',
  backTo: 'main_menu',
  footerKey: 'menu.replyPrompt',
  adminOnly: false,
  summaryResolver: 'groupManagementSummary',
  options: [
    {
      number: '1',
      labelKey: 'menu.group_management.my_groups',
      emoji: '\u{1F4CB}',
      action: 'custom:groups_my_groups'
    },
    {
      number: '2',
      labelKey: 'menu.group_management.activate',
      emoji: '\u2795',
      action: 'custom:groups_activate'
    },
    {
      number: '3',
      labelKey: 'menu.group_management.deactivate',
      emoji: '\u26D4',
      action: 'custom:groups_deactivate'
    },
    {
      number: '4',
      labelKey: 'menu.group_management.defaults',
      emoji: '\u2699\uFE0F',
      action: 'custom:groups_defaults'
    },
    {
      number: '5',
      labelKey: 'menu.group_management.moderation',
      emoji: '\u26A0\uFE0F',
      action: 'custom:groups_moderation'
    },
    {
      number: '6',
      labelKey: 'menu.group_management.aggregate_stats',
      emoji: '\u{1F4CA}',
      action: 'custom:groups_aggregate_stats'
    },
    {
      number: '7',
      labelKey: 'menu.group_management.about_stats',
      emoji: '\u2139\uFE0F',
      action: 'custom:groups_about_stats'
    }
  ]
};