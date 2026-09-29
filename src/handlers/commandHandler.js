import { readdirSync } from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { menuCommands } from '../config/menuConfig.js';
import logger from '../utils/logger.js';
import { buildMenuCommands } from './menuCommandLoader.js';
import '../config/menus/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// In-memory command map, kept so custom commands can be added/removed at
// runtime without a restart.
let activeCommands = null;

/**
 * Every name and alias that BUILT-IN commands occupy (manual + menu commands),
 * excluding admin-defined custom commands.
 *
 * Custom-vs-custom collisions are detected by the custom command store itself,
 * so keeping them out of this set is what lets an import overwrite or rename
 * an existing custom command without it looking like a built-in conflict.
 */
export async function reservedCommandNames(commands = activeCommands) {
  // Never silently return an empty set: that would disable conflict detection.
  const map = commands || activeCommands || (await loadCommands());
  const reserved = new Set();
  for (const cmd of map.values()) {
    if (cmd?.isCustomCommand) continue;
    if (cmd?.name) reserved.add(String(cmd.name).toLowerCase());
    (cmd?.aliases || []).forEach((a) => reserved.add(String(a).toLowerCase()));
  }
  return reserved;
}

export function getCommandMap() {
  return activeCommands;
}

/** Register (or replace) a custom command at runtime. Built-ins are never replaced. */
export function registerDynamicCommand(name, commandObject) {
  if (!activeCommands || !commandObject?.name) return false;
  const key = String(name).toLowerCase();
  const existing = activeCommands.get(key);
  if (existing && !existing.isCustomCommand) {
    logger.warn({ name: key }, '[CUSTOM_CMD] refusing to override built-in command');
    return false;
  }
  commandObject.isCustomCommand = true;
  // Drop stale alias entries from a previous version of this command.
  if (existing?.aliases) {
    for (const a of existing.aliases) {
      if (activeCommands.get(String(a).toLowerCase())?.isCustomCommand) activeCommands.delete(String(a).toLowerCase());
    }
  }
  activeCommands.set(key, commandObject);
  for (const a of commandObject.aliases || []) {
    const al = String(a).toLowerCase();
    if (!activeCommands.has(al)) activeCommands.set(al, commandObject);
  }
  return true;
}

export function unregisterDynamicCommand(name) {
  if (!activeCommands) return false;
  const key = String(name).toLowerCase();
  const cmd = activeCommands.get(key);
  if (!cmd || !cmd.isCustomCommand) return false;
  activeCommands.delete(key);
  for (const a of cmd.aliases || []) {
    const al = String(a).toLowerCase();
    if (activeCommands.get(al) === cmd) activeCommands.delete(al);
  }
  return true;
}

/** Drop every custom command, then re-add the current set (used after import). */
export async function reRegisterAllCustomCommands() {
  if (!activeCommands) return 0;
  for (const cmd of [...activeCommands.values()]) {
    if (cmd?.isCustomCommand) unregisterDynamicCommand(cmd.name);
  }
  const custom = await import('../services/customCommandService.js');
  const { buildCustomCommand } = await import('../utils/customCommandRunner.js');
  let n = 0;
  for (const cc of custom.getAllCustomCommands()) {
    if (!cc.enabled) continue;
    if (activeCommands.has(cc.name)) {
      logger.warn({ name: cc.name }, '[CUSTOM_CMD] conflict with built-in, skipping');
      continue;
    }
    const cmd = buildCustomCommand(cc);
    if (!cmd) continue;
    activeCommands.set(cc.name, cmd);
    for (const alias of cc.aliases || []) {
      const al = String(alias).toLowerCase();
      if (!activeCommands.has(al)) activeCommands.set(al, cmd);
    }
    n++;
  }
  logger.info({ count: n }, '[CUSTOM_CMD] re-registered');
  return n;
}

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
  // Admin-defined custom commands. Built-ins always win: a custom command that
  // shadows one is skipped (only reachable if the JSON was hand-edited).
  let customLoaded = 0;
  let customSkipped = [];
  try {
    const custom = await import('../services/customCommandService.js');
    custom.loadCustomCommands();
    const { buildCustomCommand } = await import('../utils/customCommandRunner.js');
    for (const cc of custom.getAllCustomCommands()) {
      if (!cc.enabled) continue;
      if (commands.has(cc.name)) {
        logger.warn({ name: cc.name }, '[CUSTOM_CMD] conflict with built-in, skipping');
        customSkipped.push('/' + cc.name);
        continue;
      }
      const cmd = buildCustomCommand(cc);
      if (!cmd) continue;
      commands.set(cc.name, cmd);
      for (const alias of cc.aliases || []) {
        const al = String(alias).toLowerCase();
        if (!commands.has(al)) commands.set(al, cmd);
      }
      customLoaded++;
    }
  } catch (err) {
    logger.warn({ err }, '[CUSTOM_CMD] custom command loading failed');
  }
  if (customLoaded > 0 || customSkipped.length > 0) {
    logger.info({ customLoaded, customSkipped }, '[CUSTOM_CMD] summary');
  }

  activeCommands = commands;
  if (registered > 0 || skipped.length > 0) {
    logger.info({ registered, skipped }, '[MENU_CMD] menu commands summary');
  }
  return commands;
}