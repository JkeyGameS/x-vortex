import { createRequire } from 'module';
import config from '../config/config.js';
import logger from '../utils/logger.js';
import { sendText, sendError } from '../services/messageService.js';
import { getUsersObject, getUserByJid } from '../services/userService.js';
import { t } from '../services/localeService.js';
import { toSmallCaps } from '../utils/smallCaps.js';
import { addError } from '../services/errorLogService.js';

const require = createRequire(import.meta.url);
const PDFDocument = require('pdfkit');
const pkg = require('../../package.json');

function isAdmin(sender) {
  return (config.adminJids || []).includes(sender);
}

function buildHeading(title) {
  return `> *${toSmallCaps(title)}*`;
}

/**
 * Generate a PDF backup document from the current users store.
 * @returns {Promise<{ buffer: Buffer, count: number }>} PDF buffer + user count
 */
export async function generateBackupPdf() {
  const users = getUsersObject();
  const entries = Object.values(users);
  const count = entries.length;
  const now = new Date();

  const doc = new PDFDocument({ margin: 40 });
  const chunks = [];
  doc.on('data', c => chunks.push(c));
  const done = new Promise((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  doc.fontSize(20).fillColor('#222222').text('X-Vortex Backup', { align: 'center' });
  doc.moveDown(0.5);

  doc.fontSize(10).fillColor('#555555')
    .text(`Generated: ${now.toISOString()}`, { align: 'center' })
    .text(`App: ${config.botName || 'X-Vortex'}  v${pkg.version || '1.0.0'}`, { align: 'center' })
    .text(`Total users: ${count}`, { align: 'center' });
  doc.moveDown(0.8);

  if (count === 0) {
    doc.fontSize(12).fillColor('#888888').text('No users found.');
    doc.end();
    return { buffer: await done, count };
  }

  // User table
  const startY = doc.y;
  const colX = [40, 40 + 90, 40 + 130, 40 + 220, 40 + 320, 40 + 470];
  const colW = [90, 40, 90, 100, 150, 20]; // not used directly
  const headers = ['Name', 'JID', 'Language', 'Joined', 'Status'];

  doc.fontSize(10).fillColor('#ffffff');
  doc.rect(40, startY, 520, 18).fill('#2b6cb0');
  doc.fillColor('#ffffff');
  doc.text(headers[0], colX[0], startY + 4);
  doc.text(headers[1], colX[1], startY + 4);
  doc.text(headers[2], colX[2], startY + 4);
  doc.text(headers[3], colX[3], startY + 4);
  doc.text(headers[4], colX[4], startY + 4);
  doc.moveDown();

  let y = startY + 18;
  let row = 0;
  for (const u of entries) {
    if (y > doc.page.height - 40) {
      doc.addPage();
      y = 40;
    }
    if (row % 2 === 0) {
      doc.rect(40, y, 520, 18).fill('#f1f5f9');
    }
    doc.fillColor('#222222');
    doc.text((u.name || u.username || u.jid).substring(0, 30), colX[0], y + 4);
    doc.text((u.jid || '').substring(0, 20), colX[1], y + 4);
    doc.text(u.language || config.defaultLanguage, colX[2], y + 4);
    doc.text((u.joined || '').substring(0, 10), colX[3], y + 4);
    const status = u.blocked ? 'Blocked' : (u.isTest ? 'Test' : 'Active');
    doc.text(status, colX[4], y + 4);
    y += 18;
    row++;
  }

  doc.end();
  return { buffer: await done, count };
}

/**
 * Shared action: generate and send the PDF backup. Used by the /backup
 * command and the admin panel Backup option.
 * @returns {Promise<{ success: boolean, count: number }>}
 */
export async function executeBackup(context) {
  const sender = context.sender;
  const chatId = context.chatId || sender;

  const { buffer, count } = await generateBackupPdf();
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const user = await getUserByJid(sender);
  const language = user?.language || config.defaultLanguage;
  const caption = toSmallCaps(t(language, 'backup.count', { count }));
  await context.sock.sendMessage(chatId, {
    document: buffer,
    mimetype: 'application/pdf',
    fileName: `x-vortex-backup-${timestamp}.pdf`,
    caption
  });
  logger.info({ sender, count }, '[BACKUP] sent backup as PDF document');
  return { success: true, count };
}

export const command = {
  name: 'backup',
  description: 'Export user data as a backup (admin)',
  usage: '/backup',
  aliases: ['export', 'save'],
  adminOnly: true,
  groupAllowed: false,
  async execute(context) {
    try {
      if (!isAdmin(context.sender)) {
        const language = (await getUserByJid(context.sender))?.language || config.defaultLanguage;
        return sendText(context.sock, context.sender, toSmallCaps(t(language, 'common.notAuthorized')));
      }
      return await executeBackup(context);
    } catch (error) {
      addError(error);
      logger.error({ err: error, sender: context.sender, action: 'backup_command' }, '[BACKUP] Failed');
      await sendError(context.sock, context.sender, 'Failed to create backup.');
      throw error;
    }
  }
};
