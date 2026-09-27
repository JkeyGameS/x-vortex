import { validateMenuDefinition } from './schema.js';

const registry = new Map();

export function registerMenu(definition) {
  validateMenuDefinition(definition);
  registry.set(definition.id, definition);
  return definition;
}

export function getMenu(id) {
  return registry.get(id) || null;
}

export function getAllMenus() {
  return Array.from(registry.values());
}

export function findMenuByCommand(command) {
  const cmd = command.startsWith('/') ? command : `/${command}`;
  for (const menu of registry.values()) {
    if (menu.standaloneCommand === cmd) return menu;
    if (Array.isArray(menu.aliases) && menu.aliases.includes(cmd)) return menu;
  }
  return null;
}

export function unregisterMenu(id) {
  return registry.delete(id);
}
