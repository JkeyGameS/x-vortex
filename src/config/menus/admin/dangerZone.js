// Danger Zone (admin-only). Self-service account destruction, isolated from
// the ordinary Settings menu so it is never one mis-click away.
//
// Option 1 and 2 reuse the exact flows behind Settings > Reset / Delete, with
// the admin already authenticated by reaching an adminOnly menu. Option 3
// clears the snapshot folder, which is the only way to make old snapshots
// unrecoverable -- so it is behind its own confirmation.
export default {
  id: 'danger_zone',
  headingKey: 'menu.danger_zone.heading',
  headingEmoji: '\u26A0\uFE0F',
  standaloneCommand: '/danger',
  aliases: ['/dangerzone'],
  parent: 'system_settings',
  backTo: 'system_settings',
  footerKey: 'menu.replyPrompt',
  footerItalic: false,
  fallbackHeadingKey: 'admin.systemSettings.replyPrompt',
  transitionKey: 'system_settings',
  sessionMenu: 'danger_zone',
  adminOnly: true,
  options: [
    { number: '1', labelKey: 'menu.danger_zone.reset_self', emoji: '\u267B\uFE0F', action: 'custom:danger_reset_self' },
    { number: '2', labelKey: 'menu.danger_zone.delete_self', emoji: '\uD83D\uDDD1\uFE0F', action: 'custom:danger_delete_self' },
    { number: '3', labelKey: 'menu.danger_zone.purge_snapshots', emoji: '\uD83F\uDDF9', action: 'custom:danger_purge_snapshots' }
  ]
};