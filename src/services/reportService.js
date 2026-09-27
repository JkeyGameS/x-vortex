import config from '../config/config.js';
import logger from '../utils/logger.js';
import { toSmallCaps } from '../utils/smallCaps.js';
import settingsService from './settingsService.js';

const TYPES = ['bug', 'spam', 'security', 'system', 'feedback'];

const buffers = Object.fromEntries(TYPES.map(t => [t, []]));
const lastCriticalSentAt = {};

let flushTimer = null;
let sock = null;

function footerText() {
  return '_' + toSmallCaps('Reported automatically by ' + settingsService.getBotName()) + '_';
}

function nowIso() {
  return new Date().toISOString();
}

async function sendToJids(text) {
  const jids = config.adminJids || [];
  if (!sock || jids.length === 0) {
    logger.info('[REPORT] No socket or admin JIDs, report not sent');
    return;
  }
  for (const jid of jids) {
    try {
      await sock.sendMessage(jid, { text });
    } catch (err) {
      logger.error({ err, jid }, 'Failed to send report to admin');
    }
  }
}

function formatBugReport(data) {
  return [
    '> ⚠️ *' + toSmallCaps('Bug report') + '*',
    '',
    '🕒 ' + toSmallCaps('Time') + ': ' + nowIso(),
    '👤 ' + toSmallCaps('User') + ': ' + (data.user || '-'),
    '🤖 ' + toSmallCaps('Command') + ': ' + (data.command || '-'),
    '❌ ' + toSmallCaps('Error') + ': ' + (data.error || '-'),
    '',
    footerText()
  ].join('\n');
}

function formatSpamReport(data) {
  return [
    '> 🚫 *' + toSmallCaps('Spam alert') + '*',
    '',
    '🕒 ' + toSmallCaps('Time') + ': ' + nowIso(),
    '👤 ' + toSmallCaps('User') + ': ' + (data.user || '-'),
    '🔁 ' + toSmallCaps('Command') + ': ' + (data.command || '-'),
    '⚡ ' + toSmallCaps('Count') + ': ' + data.count + ' ' + toSmallCaps('in') + ' ' + ((data.windowMs || 0) / 1000) + 's',
    '',
    footerText()
  ].join('\n');
}

function formatSecurityReport(data) {
  return [
    '> 🔐 *' + toSmallCaps('Security alert') + '*',
    '',
    '🕒 ' + toSmallCaps('Time') + ': ' + nowIso(),
    '👤 ' + toSmallCaps('User') + ': ' + (data.user || '-'),
    '🛡️ ' + toSmallCaps('Action') + ': ' + (data.action || '-'),
    '📄 ' + toSmallCaps('Details') + ': ' + (data.details || '-'),
    '',
    footerText()
  ].join('\n');
}

function formatSystemReport(data) {
  const lines = [
    '> 🤖 *' + toSmallCaps('System report') + '*',
    '',
    '🕒 ' + toSmallCaps('Time') + ': ' + nowIso()
  ];
  if (data.user) lines.push('👤 ' + toSmallCaps('User') + ': ' + data.user);
  if (data.message) lines.push('📝 ' + toSmallCaps('Message') + ': ' + data.message);
  if (data.lastText) lines.push('💬 ' + toSmallCaps('Last message') + ': ' + data.lastText);
  if (data.details) lines.push('📄 ' + toSmallCaps('Details') + ': ' + data.details);
  lines.push('', footerText());
  return lines.join('\n');
}

function formatFeedbackReport(data) {
  const isBug = (data.kind || 'bug') === 'bug';
  return [
    isBug
      ? '> *⚠️ ' + toSmallCaps('New bug report') + '*'
      : '> *💡 ' + toSmallCaps('New feature suggestion') + '*',
    '',
    '*👤 ' + toSmallCaps('User') + ':* ' + (data.user || '-'),
    '*📄 ' + toSmallCaps('Description') + ':* ' + (data.description || '-'),
    '*🕒 ' + toSmallCaps('Time') + ':* ' + (data.timestamp || nowIso()),
    '',
    footerText()
  ].join('\n');
}

function formatReport(type, data) {
  switch (type) {
    case 'bug': return formatBugReport(data);
    case 'spam': return formatSpamReport(data);
    case 'security': return formatSecurityReport(data);
    case 'system': return formatSystemReport(data);
    case 'feedback': return formatFeedbackReport(data);
    default: return '';
  }
}

function shortDetail(type, entry) {
  if (!entry) return '';
  const data = entry.data;
  switch (type) {
    case 'bug': return data.error || '-';
    case 'spam': return `${data.user || '-'} — ${data.command || '-'} x${data.count || 0}`;
    case 'security': return `${data.user || '-'} — ${data.action || '-'}`;
    case 'system': return data.details || '-';
    case 'feedback': return `${data.user || '-'} — ${data.kind || 'bug'}: ${(data.description || '-').slice(0, 80)}`;
    default: return '-';
  }
}

function formatSummary() {
  const counts = {};
  let total = 0;
  for (const type of TYPES) {
    counts[type] = buffers[type].length;
    total += buffers[type].length;
  }

  const nonEmpty = TYPES.filter(type => buffers[type].length > 0);
  const lines = [
    '> *' + toSmallCaps('X Vortex report summary') + '*',
    '',
    '🕒 ' + toSmallCaps('Time') + ': ' + nowIso(),
    '📊 ' + toSmallCaps('Total reports') + ': ' + total,
    '',
    '⚠️ ' + toSmallCaps('Bugs') + ': ' + counts.bug,
    '🚫 ' + toSmallCaps('Spam') + ': ' + counts.spam,
    '🔐 ' + toSmallCaps('Security') + ': ' + counts.security,
    '🤖 ' + toSmallCaps('System') + ': ' + counts.system,
    '📮 ' + toSmallCaps('Feedback') + ': ' + counts.feedback
  ];

  if (nonEmpty.length === 1) {
    const onlyType = nonEmpty[0];
    const last = buffers[onlyType][buffers[onlyType].length - 1];
    lines.push('', '📄 ' + toSmallCaps('Details') + ': ' + shortDetail(onlyType, last));
  }

  lines.push('', '_' + toSmallCaps('Please check the logs for details.') + '_');
  return lines.join('\n');
}

function startFlushTimer() {
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = setTimeout(() => { flushBuffers(); }, config.reportAggregationWindowMs || 300000);
  if (flushTimer.unref) flushTimer.unref();
}

function bufferReport(type, data) {
  buffers[type].push({ data });
  if (!flushTimer) startFlushTimer();

  if (buffers[type].length >= (config.reportAggregationThreshold || 10)) {
    flushBuffers();
  }
}

async function flushBuffers() {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }

  const nonEmpty = TYPES.filter(type => buffers[type].length > 0);
  if (nonEmpty.length === 0) return;

  const text = formatSummary();
  await sendToJids(text);

  for (const type of TYPES) buffers[type] = [];
}

async function sendCritical(type, data) {
  const now = Date.now();
  const minInterval = config.reportMinIntervalMs || 60000;
  if (now - (lastCriticalSentAt[type] || 0) < minInterval) {
    logger.info({ type }, 'Critical report rate-limited, skipping');
    return;
  }
  lastCriticalSentAt[type] = now;

  const text = formatReport(type, data);
  await sendToJids(text);
}

export function setSock(s) {
  sock = s;
}

export async function sendImmediateReport(type, data = {}) {
  if (!TYPES.includes(type)) return;
  await sendToJids(formatReport(type, data));
}

export function reportToAdmins(type, data = {}, priority = 'normal') {
  if (!config.reportEnabled) return;
  if (!settingsService.getSettings().reportsEnabled) return;
  if (settingsService.getSettings().adminNotificationsEnabled === false) {
    logger.info({ type }, '[REPORT] admin notifications disabled, skipping');
    return;
  }
  if (!TYPES.includes(type)) return;

  const enabled = {
    bug: config.enableBugReports !== false,
    spam: config.enableSpamReports !== false,
    security: config.enableSecurityReports !== false,
    system: true,
    feedback: config.enableFeedbackReports !== false
  };
  if (!enabled[type]) return;

  if ((config.adminJids || []).length === 0) return;

  if (priority === 'immediate') {
    sendImmediateReport(type, data);
    return;
  }
  if (priority === 'critical') {
    sendCritical(type, data);
    return;
  }
  bufferReport(type, data);
}

export async function flushReportBuffers() {
  await flushBuffers();
}

export async function flushReports() {
  await flushBuffers();
}

export function shutdown() {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
}