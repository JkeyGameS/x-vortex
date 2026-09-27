import { showBulkDeleteMenu, showTrashMenu } from './chatCommand.js';

export const commands = [
  {
    name: 'uninstallchat',
    description: 'Open bulk chat-rule delete submenu',
    usage: '/uninstallchat',
    aliases: [],
    adminOnly: true,
    groupAllowed: false,
    async execute(context) {
      await showBulkDeleteMenu(context);
    }
  },
  {
    name: 'trash',
    description: 'Open trashed chat rules submenu',
    usage: '/trash',
    aliases: [],
    adminOnly: true,
    groupAllowed: false,
    async execute(context) {
      await showTrashMenu(context);
    }
  },
  {
    name: 'restorechat',
    description: 'Open chat-rule trash restore flow',
    usage: '/restorechat',
    aliases: [],
    adminOnly: true,
    groupAllowed: false,
    async execute(context) {
      await showTrashMenu(context);
    }
  }
];
