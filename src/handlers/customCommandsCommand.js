import sessionManager from '../utils/sessionManager.js';
import logger from '../utils/logger.js';

/**
 * Standalone admin commands for the Custom Commands editor. The menu itself is
 * auto-registered from its definition; these shortcuts jump straight into a
 * wizard so admins do not have to navigate System Settings first.
 */
const wizard = () => import('../utils/customCommandWizard.js');

const base = (context) => ({
  sock: context.sock,
  sender: context.sender,
  chatId: context.chatId || context.sender,
  pushName: context.pushName
});

export const commands = [
  { name: 'addcmd', description: 'Add a custom command', usage: '/addcmd', aliases: ['newcmd'], adminOnly: true, groupAllowed: false,
    async execute(context) { return wizard().then((w) => w.startAddWizard(base(context))); } },
  { name: 'editcmd', description: 'Edit a custom command', usage: '/editcmd', aliases: [], adminOnly: true, groupAllowed: false,
    async execute(context) { return wizard().then((w) => w.startEditWizard(base(context))); } },
  { name: 'delcmd', description: 'Delete a custom command', usage: '/delcmd', aliases: [], adminOnly: true, groupAllowed: false,
    async execute(context) { return wizard().then((w) => w.startDeleteWizard(base(context))); } },
  { name: 'listcmds', description: 'List custom commands', usage: '/listcmds', aliases: ['ccs'], adminOnly: true, groupAllowed: false,
    async execute(context) { return wizard().then((w) => w.startListWizard(base(context))); } },
  { name: 'togglecmd', description: 'Enable or disable a custom command', usage: '/togglecmd', aliases: [], adminOnly: true, groupAllowed: false,
    async execute(context) { return wizard().then((w) => w.startToggleWizard(base(context))); } },
  { name: 'importcmds', description: 'Import or export custom commands', usage: '/importcmds', aliases: [], adminOnly: true, groupAllowed: false,
    async execute(context) { return wizard().then((w) => w.startImportExport(base(context))); } },
  { name: 'exportcmds', description: 'Export all custom commands', usage: '/exportcmds', aliases: [], adminOnly: true, groupAllowed: false,
    async execute(context) { return wizard().then((w) => w.exportAll(base(context))); } }
];

export { sessionManager, logger };
