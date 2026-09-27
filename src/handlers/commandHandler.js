import { readdirSync } from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { menuCommands } from '../config/menuConfig.js';
import logger from '../utils/logger.js';
import { buildMenuCommands } from './menuCommandLoader.js';
import '../config/menus/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export async function loadCommands() {
  const commands = new Map();
  const handlerDir = path.join(__dirname, '../handlers');
  const files = readdirSync(handlerDir).filter(f => f.endsWith('.js') && f !== 'commandHandler.js');

  for (const file of files) {
    const module = await import(pathToFileURL(path.join(handlerDir, file)));
    const commandList = Array.isArray(module.commands) ? module.commands
      : (module.command ? [module.command] : []);
    for (const command of commandList) {
      if (!command?.name) continue;
      // Central adminOnly registry (menuConfig): flips here apply everywhere.
      if (Object.prototype.hasOwnProperty.call(menuCommands, command.name)) {
        command.adminOnly = menuCommands[command.name].adminOnly;
      }
      commands.set(command.name, command);
      command.aliases?.forEach(alias => commands.set(alias, command));
    }
  }

  // Phase 2: auto-register standalone commands from menu definitions.
  // Manual commands always win on name/alias conflicts.
  let registered = 0;
  const skipped = [];
  try {
    const { commands: menuCmds, skipped: malformed } = buildMenuCommands();
    for (const m of malformed) skipped.push(`/${m.menu} (${m.reason})`);
    for (const cmd of menuCmds) {
      if (commands.has(cmd.name)) {
        logger.warn({ name: cmd.name }, "[MENU_CMD] Skipping auto-registration for '/" + cmd.name + "' — already exists manually");
        skipped.push('/' + cmd.name);
        continue;
      }
      if (Object.prototype.hasOwnProperty.call(menuCommands, cmd.name)) {
        cmd.adminOnly = menuCommands[cmd.name].adminOnly;
      }
      if (Array.isArray(cmd.aliases)) {
        const kept = [];
        for (const alias of cmd.aliases) {
          if (commands.has(alias)) {
            logger.warn({ alias, name: cmd.name }, '[MENU_CMD] Skipping conflicting alias');
            skipped.push(alias + ' (alias)');
            continue;
          }
          kept.push(alias);
        }
        cmd.aliases = kept;
      }
      commands.set(cmd.name, cmd);
      (cmd.aliases || []).forEach((alias) => commands.set(alias, cmd));
      registered++;
    }
  } catch (err) {
    logger.warn({ err }, '[MENU_CMD] menu command auto-registration failed');
  }
  if (registered > 0 || skipped.length > 0) {
    logger.info({ registered, skipped }, '[MENU_CMD] menu commands summary');
  }
  return commands;
}