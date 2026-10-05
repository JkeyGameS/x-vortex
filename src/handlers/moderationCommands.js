import {
  flowWarn,
  flowUnwarn,
  flowMute,
  flowUnmute,
  flowKick,
  flowBan,
  flowUnban,
  flowWarnings
} from './moderationHandlers.js';

/**
 * Moderation slash commands (Phase 4), all DM-only.
 *
 * The loader reads `module.commands` as an array, so all eight live here
 * rather than in eight near-identical files. Each delegates to the shared flow
 * in moderationHandlers.js, which is also what the Group Management submenu
 * calls -- one implementation per action.
 *
 * groupAllowed is false on every one: moderation is only ever run from a DM.
 */

const META = {
  warn: 'Warn a user in a group you administer',
  unwarn: 'Remove the most recent warning from a user',
  mute: 'Mute a user in a group you administer',
  unmute: 'Unmute a user',
  kick: 'Remove a user from a group you administer',
  ban: 'Ban a user so the bot ignores them in a group',
  unban: 'Lift a ban',
  warnings: "List a user's active warnings"
};

function args(context) {
  return Array.isArray(context.args) ? context.args : [];
}

function mk(name, run) {
  return {
    name,
    aliases: [],
    description: META[name],
    usage: `/${name} <groupJid> <userJid>`,
    adminOnly: false,
    groupAllowed: false,
    async execute(context) {
      const [groupJid, userJid, ...rest] = args(context);
      return run(context, { groupJid, userJid, reason: rest.join(' ') || undefined });
    }
  };
}

const warn = mk('warn', flowWarn);
const unwarn = mk('unwarn', flowUnwarn);
const ban = mk('ban', flowBan);
const unban = mk('unban', flowUnban);
const kick = mk('kick', flowKick);
const warnings = mk('warnings', flowWarnings);

// Mute takes an optional duration before the free-text reason, so it cannot
// reuse mk(): the third token is a number when it parses as one.
const unmute = mk('unmute', flowUnmute);

const mute = {
  name: 'mute',
  aliases: [],
  description: META.mute,
  usage: '/mute <groupJid> <userJid> [minutes] [reason]',
  adminOnly: false,
  groupAllowed: false,
  async execute(context) {
    const [groupJid, userJid, ...rest] = args(context);
    let durationMs;
    let reasonParts = rest;
    if (rest.length && /^\d+$/.test(rest[0])) {
      durationMs = Number(rest[0]) * 60_000;
      reasonParts = rest.slice(1);
    }
    return flowMute(context, {
      groupJid,
      userJid,
      durationMs,
      reason: reasonParts.join(' ') || undefined
    });
  }
};

export const command = warn;
export const commands = [warn, unwarn, mute, unmute, kick, ban, unban, warnings];
