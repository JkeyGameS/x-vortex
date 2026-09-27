import { t } from '../services/localeService.js';
import { toSmallCaps } from './smallCaps.js';

function L(lang, key, fallback) {
  try {
    const v = t(lang, key);
    return (typeof v === 'string' && v !== key) ? v : fallback;
  } catch {
    return fallback;
  }
}

/**
 * Build the inline help text for a given menu.
 * The help is a small-caps message with a heading `>*...*`, one line per
 * option with a short description, and a `0. Back` option to return.
 *
 * @param {string} menuId - e.g. 'main', 'admin', 'test', 'language'
 * @param {string} language - language code
 * @returns {string} help text (ready for sendMenu)
 */
export function buildMenuHelp(menuId, language = 'en') {
  const entry = (num, label, desc) =>
    `${num}. ${toSmallCaps(label) + (desc ? ' – ' + toSmallCaps(desc) : '')}`;

  let title;
  let lines;

  switch (menuId) {
    case 'main':
      title = L(language, 'menuHelp.main.title', 'Main menu');
      lines = [
        entry('1', L(language, 'menuHelp.menu.profile', 'Profile'), L(language, 'menuHelp.main.profile', 'View or edit your profile')),
        entry('2', L(language, 'menuHelp.menu.settings', 'Settings'), L(language, 'menuHelp.main.settings', 'Change bot settings')),
        entry('3', L(language, 'menuHelp.menu.statistics', 'Statistics'), L(language, 'menuHelp.main.statistics', 'See your stats')),
        entry('4', L(language, 'onboarding.menuTutorial', 'Tutorial'), L(language, 'menuHelp.main.tutorial', 'Show available commands')),
        entry('5', L(language, 'menuHelp.menu.about', 'About'), L(language, 'menuHelp.main.about', 'About the bot')),
        entry('A', L(language, 'menuHelp.menu.admin', 'Admin'), L(language, 'menuHelp.main.admin', 'Open the admin panel')),
        entry('9', L(language, 'menuHelp.option', 'Help'), L(language, 'menuHelp.main.help', 'Show this help'))
      ];
      break;

    case 'admin':
      title = L(language, 'menuHelp.admin.title', 'Admin panel');
      lines = [
        entry('0', L(language, 'admin.optionExit', 'Exit'), L(language, 'menuHelp.admin.exit', 'Back to main menu')),
        entry('1', L(language, 'admin.optionQuickActions', 'Quick Actions'), 'Broadcast, toggles, purge and emergency shortcuts'),
        entry('2', L(language, 'admin.optionStats', 'View Stats'), L(language, 'menuHelp.admin.stats', 'View bot statistics')),
        entry('3', L(language, 'admin.optionBroadcast', 'Broadcast'), L(language, 'menuHelp.admin.broadcast', 'Send a message to all users')),
        entry('4', L(language, 'admin.optionUserManagement', 'User Management'), 'Manage, block, unblock, or purge users'),
        entry('5', L(language, 'admin.optionSettings', 'System Settings'), L(language, 'menuHelp.admin.settings', 'System settings')),
        entry('6', L(language, 'admin.optionChatFaq', 'Chat & FAQ Management'), 'Manage chat responses and FAQ entries'),
        entry('7', L(language, 'admin.optionBackupRestore', 'Backup & Restore'), L(language, 'menuHelp.admin.backup', 'Export or import user data')),
        entry('8', L(language, 'admin.optionFeedbackManagement', 'Feedback Management'), 'Review and manage user feedback'),
        entry('9', L(language, 'admin.optionTest', 'Test'), L(language, 'menuHelp.admin.test', 'Open the test submenu')),
        entry('10', L(language, 'admin.optionAnalytics', 'Analytics'), L(language, 'menuHelp.admin.analytics', 'View command usage analytics')),
        entry('11', L(language, 'admin.optionSearch', 'Search'), 'Search users, feedback, commands and logs'),
        entry('12', L(language, 'admin.optionScheduled', 'Scheduled Tasks'), 'View and cancel scheduled tasks'),
        entry('13', L(language, 'menuHelp.option', 'Help'), L(language, 'menuHelp.admin.help', 'Show this help'))
      ];
      break;

    case 'admin_users':
      title = L(language, 'admin.userManagement.title', 'User Management');
      lines = ['1. Search User', '2. Delete User', '3. Block User', '4. Unblock User', '5. List Blocked Users', '6. Purge Test Users'];
      break;

    case 'chat_faq_menu':
      title = L(language, 'admin.chatFaq.title', 'Chat & FAQ');
      lines = ['1. Chat Responses', '2. FAQ Knowledge Base'];
      break;

    case 'admin_backup':
      title = L(language, 'admin.backupRestore.title', 'Backup & Restore');
      lines = ['1. Backup (Export)', '2. Restore (Import)', '3. View Exports'];
      break;

    case 'admin_logs':
      title = L(language, 'admin.logs.title', 'Logs');
      lines = ['1. Admin Log', '2. Error Log'];
      break;

    case 'test':
      title = L(language, 'menuHelp.test.title', 'Admin tests');
      lines = [
        entry('0', L(language, 'admin.test.optionBack', 'Back'), L(language, 'menuHelp.test.back', 'Back to admin panel')),
        entry('1', L(language, 'admin.test.optionNewUser', 'New User Sim'), L(language, 'menuHelp.test.newUser', 'Simulate new user onboarding (sends report)')),
        entry('2', L(language, 'admin.test.optionSpam', 'Spam Test'), L(language, 'menuHelp.test.spam', 'Send a test spam report')),
        entry('3', L(language, 'admin.test.optionBug', 'Bug Test'), L(language, 'menuHelp.test.bug', 'Send a test bug report')),
        entry('4', L(language, 'admin.test.optionSecurity', 'Security Test'), L(language, 'menuHelp.test.security', 'Send a test security report')),
        entry('5', L(language, 'admin.test.optionSummary', 'Summary Test'), L(language, 'menuHelp.test.summary', 'Flush report summary')),
        entry('9', L(language, 'menuHelp.option', 'Help'), L(language, 'menuHelp.test.help', 'Show this help'))
      ];
      break;

    case 'backup_restore':
      title = L(language, 'admin.backupRestore.title', 'Backup & Restore');
      lines = [
        entry('0', L(language, 'admin.test.optionBack', 'Back'), L(language, 'menuHelp.test.back', 'Back to admin panel')),
        entry('1', L(language, 'admin.backupRestore.optionBackup', 'Backup'), L(language, 'menuHelp.backup.backup', 'Export all user data as JSON')),
        entry('2', L(language, 'admin.backupRestore.optionRestore', 'Restore'), L(language, 'menuHelp.backup.restore', 'Import user data from a backup file'))
      ];
      break;

    case 'system_settings':
      title = L(language, 'admin.systemSettings.title', 'System Settings');
      lines = [
        entry('0', L(language, 'admin.systemSettings.optionBack', 'Back'), 'Return to admin panel'),
        entry('1', L(language, 'admin.systemSettings.optionMaintenance', 'Maintenance Mode'), 'Toggle maintenance mode'),
        entry('2', L(language, 'admin.systemSettings.optionSleepAnimation', 'Sleep Animation'), 'Enable or disable the sleep/wake animation'),
        entry('3', L(language, 'admin.systemSettings.optionUpdates', 'Check Updates'), 'Check for a new version'),
        entry('4', L(language, 'admin.systemSettings.optionReports', 'Toggle Reports'), 'Enable or disable reports'),
        entry('5', L(language, 'admin.systemSettings.optionSessionSave', 'Toggle Session Save'), 'Enable or disable session saving'),
        entry('6', L(language, 'admin.systemSettings.optionBotName', 'Change Bot Name'), 'Rename the bot'),
        entry('7', L(language, 'admin.systemSettings.optionFeatureFlags', 'Feature Flags'), 'Toggle bot features'),
        entry('8', L(language, 'admin.systemSettings.optionErrorLog', 'Error Log'), 'View recent errors'),
        entry('9', L(language, 'admin.systemSettings.optionConversation', 'Conversation Chat'), 'Enable or disable the conversational chat'),
        entry('10', L(language, 'menuHelp.option', 'Help'), L(language, 'menuHelp.system.settings', 'Show this help'))
      ];
      break;

    case 'conversation_settings':
      title = L(language, 'admin.conversation.title', 'Conversation Chat');
      lines = [
        entry('0', L(language, 'admin.conversation.optionBack', 'Back'), 'Return to system settings'),
        entry('1', L(language, 'admin.conversation.optionEnable', 'Enable'), 'Turn the conversational chat on'),
        entry('2', L(language, 'admin.conversation.optionDisable', 'Disable'), 'Turn the conversational chat off'),
        entry('3', L(language, 'admin.conversation.optionTempDisable', 'Temporarily disable'), 'Disable for a limited time'),
        entry('4', L(language, 'admin.conversation.optionNotify', 'Notification requests'), 'View and manage waitlist users'),
        entry('9', L(language, 'menuHelp.option', 'Help'), 'Show this help')
      ];
      break;

    case 'settings':
      title = L(language, 'settings.title', 'Settings');
      lines = [
        entry('9', L(language, 'settings.help', 'Help'), 'Show this help')
      ];
      break;

    case 'language':
      return [
        '> *🌐 ' + toSmallCaps(L(language, 'menuHelp.language.helpTitle', 'Language help')) + '*',
        '',
        toSmallCaps(L(language, 'menuHelp.language.helpText', 'Choosing your language helps me communicate with you in the way you prefer. You can change it later in settings.')),
        '',
        '0. ◀️ ' + toSmallCaps(L(language, 'menuHelp.back', 'Back'))
      ].join('\n');

    default:
      title = L(language, 'menuHelp.title', 'Help');
      lines = [toSmallCaps(L(language, 'menuHelp.generic', 'No specific help for this view.'))];
  }

  return [
    '> *' + toSmallCaps(L(language, 'menuHelp.title', 'Help')) + ' – ' + toSmallCaps(title) + '*',
    '',
    ...lines,
    '',
    '0. ' + toSmallCaps(L(language, 'menuHelp.back', 'Back'))
  ].join('\n');
}
