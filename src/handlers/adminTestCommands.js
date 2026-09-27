import config from '../config/config.js';
import { sendText } from '../services/messageService.js';
import * as reportService from '../services/reportService.js';
import { toSmallCaps } from '../utils/smallCaps.js';
import { t } from '../services/localeService.js';
import { getUserByJid } from '../services/userService.js';

async function languageOf(sender) {
  const user = await getUserByJid(sender);
  return user?.language || config.defaultLanguage;
}

async function checkAdmin(context) {
  const isAdmin = (config.adminJids || []).includes(context.sender);
  if (!isAdmin) {
    reportService.reportToAdmins('security', {
      user: context.sender,
      action: 'admin_command_attempt',
      details: context.commandName
    });
    const language = await languageOf(context.sender);
    sendText(context.sock, context.sender, toSmallCaps(t(language, 'common.notAuthorized')));
    return false;
  }
  return true;
}

async function runReportTest(context, type, data) {
  if (!checkAdmin(context)) return { success: false };
  reportService.reportToAdmins(type, data, 'critical');
  const language = await languageOf(context.sender);
  await sendText(context.sock, context.sender, toSmallCaps(t(language, 'admin.test.testSent')));
  return { success: true };
}

const testNewCommand = {
  name: 'test-new',
  description: 'Send a test new-user-sim system report to admins',
  usage: '/test-new',
  aliases: ['test-sim', 'sim'],
  adminOnly: true,
  groupAllowed: false,
  async execute(context) {
    if (!checkAdmin(context)) return { success: false };
    reportService.reportToAdmins('system', {
      details: `New-user simulation launched by admin ${context.sender}`
    }, 'critical');
    const language = await languageOf(context.sender);
    await sendText(context.sock, context.sender, toSmallCaps(t(language, 'admin.test.testSent')));
    return { success: true };
  },
};

const testSpamCommand = {
  name: 'test-spam',
  description: 'Send a test spam report to admins',
  usage: '/test-spam',
  aliases: [],
  adminOnly: true,
  groupAllowed: false,
  async execute(context) {
    return runReportTest(context, 'spam', {
      user: context.sender,
      command: 'test',
      count: config.spamThreshold || 5,
      windowMs: config.spamWindowMs || 10000
    });
  },
};

const testBugCommand = {
  name: 'test-bug',
  description: 'Send a test bug report to admins',
  usage: '/test-bug',
  aliases: [],
  adminOnly: true,
  groupAllowed: false,
  async execute(context) {
    return runReportTest(context, 'bug', {
      user: context.sender,
      command: 'test',
      error: 'Test bug',
      stack: ''
    });
  },
};

const testSecurityCommand = {
  name: 'test-security',
  description: 'Send a test security report to admins',
  usage: '/test-security',
  aliases: [],
  adminOnly: true,
  groupAllowed: false,
  async execute(context) {
    return runReportTest(context, 'security', {
      user: context.sender,
      action: 'test_security',
      details: 'Test alert'
    });
  },
};

const testSummaryCommand = {
  name: 'test-summary',
  description: 'Flush report buffers as a summary to admins',
  usage: '/test-summary',
  aliases: [],
  adminOnly: true,
  groupAllowed: false,
  async execute(context) {
    if (!checkAdmin(context)) return { success: false };
    reportService.reportToAdmins('system', {
      details: 'Report summary test requested'
    }, 'normal');
    reportService.flushReports();
    const language = await languageOf(context.sender);
    await sendText(context.sock, context.sender, toSmallCaps(t(language, 'admin.test.testSent')));
    return { success: true };
  },
};

export const commands = [
  testNewCommand,
  testSpamCommand,
  testBugCommand,
  testSecurityCommand,
  testSummaryCommand
];
