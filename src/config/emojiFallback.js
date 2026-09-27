// TEMPORARY (Phase 0 safety net — deleted in Phase 8).
// Maps menu option keys to the emoji currently used for them in code.
// Purpose: during migration Phases 3-7, if a translation file is missing a
// new key, fall back to the old key + this map to preserve output.
// Main-menu values verified against translations/en.json; chat-panel values
// verified against chatCommand.js builders; the rest follow the established
// in-code emoji usage.
export const EMOJI_FALLBACK = {
  // Main menu (onboarding.*)
  menuProfile: '👤',
  menuSettings: '⚙️',
  menuStatistics: '📊',
  menuTutorial: '📚',
  menuInfo: 'ℹ️',
  menuFeedback: '📮',
  menuHelp: '❓',
  menuAdmin: '🧰',
  menuExit: '💤',

  // Profile
  profileEdit: '✏️',
  profileStats: '📊',
  profilePrefs: '⚙️',
  profileCopyId: '🆔',

  // Edit Profile
  editName: '📛',
  editUsername: '👤',
  editBio: '📝',
  editTimezone: '🕒',
  editPicture: '🖼️',
  editCountry: '🌍',
  editBirthday: '🎂',

  // Preferences
  prefLanguage: '🌐',
  prefNotifications: '🔔',
  prefAnnouncements: '📢',
  prefTyping: '⌨️',
  prefAdvanced: '🔒',

  // Chat & FAQ (Chat & FAQ Management hub)
  chatResponses: '💬',
  chatFaq: '📚',
  chatSnippets: '🧩',
  chatStats: '📊',
  chatUnmatched: '📝',
  chatImportExport: '📦',
  chatTestPanel: '🧪',
  chatSettings: '⚙️',

  // Chat responses panel groups (chatResponses.group*)
  groupAddRule: '➕',
  groupViewRules: '📋',
  groupManageRules: '✏️',
  groupSearch: '🔍',
  groupImportExport: '📦',
  groupStats: '📊',

  // View Rules (chatResponses.view*)
  viewAll: '📋',
  viewByLanguage: '🔤',
  viewEnabled: '🔛',
  viewDisabled: '❌',
  viewDrafts: '📝',
  viewRecent: '🕒',
  viewFavorites: '⭐',
  viewBulkDelete: '🗑️',
  viewUninstallPack: '📦',

  // Admin
  adminStats: '📊',
  adminBroadcast: '📢',
  adminUsers: '👥',
  adminSystem: '⚙️',
  adminChatFaq: '💬',
  adminBackup: '📦',
  adminFeedback: '📮',
  adminTest: '🧪',
  adminAnalytics: '📈',
  adminSearch: '🔍',
  adminScheduled: '📅',
  adminHelp: '❓',
  adminQuickActions: '⚡',

  // Chat Settings (chatSettings.opt*)
  optTypingAnimation: '⌨️',
  optRateLimit: '🚦',
  optSnippetDepth: '🧩',

  // Common
  back: '◀️',
  yes: '✅',
  no: '❌',
  on: '🟢',
  off: '🔴'

  // If unsure of a key, add it here as a comment placeholder during Phases 3-7.
};
