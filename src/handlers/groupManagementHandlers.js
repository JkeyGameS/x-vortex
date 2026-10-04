import { sendText } from '../services/messageService.js';
import { toSmallCaps } from '../utils/smallCaps.js';
import {
  listBotGroups,
  getGroupMetadata,
  isBotGroupAdmin
} from '../utils/groupHelper.js';
import { canManageGroups, canManageGroup, isBotAdmin } from '../utils/groupPermission.js';
import {
  getAllGroups,
  getEnabledGroups,
  getGroup,
  activateGroup,
  deactivateGroup,
  defaultGroupSettings
} from '../services/groupService.js';

/**
 * DM-side Group Management handlers (Phase 1).
 *
 * Every handler gates on canManageGroups first. Sub-states own their own
 * prompts and numeric input; the router dispatches anything whose currentMenu
 * starts with 'group_management' to handleGroupManagementReply.
 *
 * Picker state is kept on the session (pendingGroupIds / pendingGroupJid) rather
 * than in memory so a restart mid-flow cannot leave a stale list behind.
 */

const MENU = 'group_management';
const GROUP_OPTS = { skipTyping: false };

function denied(sock, sender) {
  return sendText(
    sock,
    sender,
    '\u274C ' + toSmallCaps("You don't have permission to manage groups."),
    GROUP_OPTS
  );
}

function failed(sock, sender) {
  return sendText(sock, sender, '\u274C ' + toSmallCaps('Failed to load group info.'), GROUP_OPTS);
}

async function setMenu(sock, sender, chatId, menuId, patch = {}) {
  const sessionManager = (await import('../utils/sessionManager.js')).default;
  sessionManager.setState(sender, chatId, { currentMenu: menuId, ...patch });
}

/** Groups the user may act on: bot admin sees all, others only their own. */
async function manageableGroups(sock, userJid) {
  const all = await listBotGroups(sock);
  if (isBotAdmin(userJid)) return all;
  const out = [];
  for (const g of all) {
    const { isGroupAdmin } = await import('../utils/groupHelper.js');
    if (await isGroupAdmin(sock, g.id, userJid)) out.push(g);
  }
  return out;
}

function renderList(title, groups, startAt = 1) {
  const lines = ['> *\u{1F465} ' + toSmallCaps(title) + '*', ''];
  if (!groups.length) {
    lines.push(toSmallCaps('You do not manage any groups.'), '', '0. ' + toSmallCaps('Back'));
    return lines.join('\n');
  }
  groups.forEach((g, i) => {
    lines.push(`${startAt + i}. ${g.subject || g.name || 'Unknown'}`);
  });
  lines.push('', '0. ' + toSmallCaps('Back'));
  return lines.join('\n');
}

/** 1. My Groups — read-only list with activation state. */
export async function groupsMyGroups(context) {
  const { sock, sender, chatId } = context;
  if (!await canManageGroups(sock, sender)) return denied(sock, sender);
  try {
    const visible = await manageableGroups(sock, sender);
    const registered = getAllGroups();
    const lines = ['> *\u{1F4CB} ' + toSmallCaps('My Groups') + '*', ''];
    if (!visible.length) {
      lines.push(toSmallCaps('You do not manage any groups.'), '', '0. ' + toSmallCaps('Back'));
    } else {
      lines.push(
        toSmallCaps('Groups you manage') + ': ' + visible.length,
        toSmallCaps('Activated') + ': ' + getEnabledGroups().length,
        ''
      );
      visible.forEach((g, i) => {
        const known = getGroup(g.id);
        const on = known && known.enabled === true;
        lines.push(`${i + 1}. ${g.subject || g.name || 'Unknown'} ${on ? '\u2705 ' + toSmallCaps('on') : '\u274C ' + toSmallCaps('off')}`);
      });
      lines.push('', '0. ' + toSmallCaps('Back'));
    }
    await sendText(sock, sender, lines.join('\n'), GROUP_OPTS);
    await setMenu(sock, sender, chatId, 'group_management_list', {
      pendingGroupIds: visible.map((g) => g.id)
    });
  } catch (err) {
    await failed(sock, sender);
  }
}

/** 2. Activate — pick a group, then confirm. */
export async function groupsActivate(context) {
  const { sock, sender, chatId } = context;
  if (!await canManageGroups(sock, sender)) return denied(sock, sender);
  try {
    const visible = await manageableGroups(sock, sender);
    const ids = visible.map((g) => g.id);
    await sendText(sock, sender, renderList('Select a group to activate', visible), GROUP_OPTS);
    await setMenu(sock, sender, chatId, 'group_management_activate', { pendingGroupIds: ids });
  } catch (err) {
    await failed(sock, sender);
  }
}

/** 3. Deactivate — pick an enabled group, then confirm. */
export async function groupsDeactivate(context) {
  const { sock, sender, chatId } = context;
  if (!await canManageGroups(sock, sender)) return denied(sock, sender);
  try {
    const enabled = getEnabledGroups();
    const visible = [];
    for (const g of enabled) {
      if (await canManageGroup(sock, sender, g.id)) visible.push(g);
    }
    const ids = visible.map((g) => g.id);
    await sendText(sock, sender, renderList('Select a group to deactivate', visible), GROUP_OPTS);
    await setMenu(sock, sender, chatId, 'group_management_deactivate', { pendingGroupIds: ids });
  } catch (err) {
    await failed(sock, sender);
  }
}

/** 4. Defaults — Phase 1 read-only view; editing lands in Phase 2. */
export async function groupsDefaults(context) {
  const { sock, sender } = context;
  if (!isBotAdmin(sender)) return denied(sock, sender);
  const d = defaultGroupSettings();
  const label = (k) => (d[k] ? '\u2705 ' + toSmallCaps('on') : '\u274C ' + toSmallCaps('off'));
  const lines = [
    '> *\u2699\uFE0F ' + toSmallCaps('Default Settings') + '*',
    '',
    toSmallCaps('Applied to newly activated groups.'),
    '',
    '1. \u{1F514} ' + toSmallCaps('Mention Only') + ': ' + label('mentionOnly'),
    '2. \u{1F4AC} ' + toSmallCaps('Chat Rules') + ': ' + label('chatRules'),
    '3. \u{1F44B} ' + toSmallCaps('Welcome') + ': ' + label('welcome'),
    '4. \u{1F44B} ' + toSmallCaps('Goodbye') + ': ' + label('goodbye'),
    '5. \u{1F6AB} ' + toSmallCaps('Anti-Spam') + ': ' + label('antiSpam'),
    '6. \u{1F517} ' + toSmallCaps('Anti-Link') + ': ' + label('antiLink'),
    '',
    toSmallCaps('Editable in a later phase.'),
    '',
    '0. ' + toSmallCaps('Back')
  ];
  await sendText(sock, sender, lines.join('\n'), GROUP_OPTS);
}

/**
 * Numeric input for every group_management* sub-state.
 * @returns {Promise<boolean>} true when handled
 */
export async function handleGroupManagementReply(context, trimmedText) {
  const { sock, sender, chatId, session, user } = context;
  const state = session?.currentMenu;
  if (!state || !state.startsWith('group_management')) return false;

  try {
    const { cancelStartHint } = await import('../services/startHintService.js');
    cancelStartHint(sender);
  } catch { /* optional */ }

  const input = String(trimmedText || '').trim();
  const back = () => backToMenu(sock, sender, chatId);

  if (input === '0' || input === 'back') {
    return back();
  }

  // Numeric pick against the stored list for this state.
  const pickStates = ['group_management_list', 'group_management_activate', 'group_management_deactivate'];
  if (pickStates.includes(state)) {
    const n = Number(input);
    const ids = Array.isArray(session?.pendingGroupIds) ? session.pendingGroupIds : [];
    if (!Number.isInteger(n) || n < 1 || n > ids.length) {
      await sendText(sock, sender, '\u274C ' + toSmallCaps('Invalid choice.'), GROUP_OPTS);
      return true;
    }
    const groupJid = ids[n - 1];
    if (state === 'group_management_deactivate') {
      if (!await canManageGroup(sock, sender, groupJid)) {
        await denied(sock, sender);
        return true;
      }
      const meta = await getGroupMetadata(sock, groupJid);
      const name = meta?.subject || getGroup(groupJid)?.name || 'Unknown';
      const lines = [
        toSmallCaps('Do you want to deactivate the bot in') + ' *' + name + '*?',
        '',
        '1. \u2705 ' + toSmallCaps('Yes'),
        '2. \u274C ' + toSmallCaps('No'),
        '',
        '0. ' + toSmallCaps('Back')
      ];
      await sendText(sock, sender, lines.join('\n'), GROUP_OPTS);
      await setMenu(sock, sender, chatId, 'group_management_deactivate_confirm', {
        pendingGroupJid: groupJid
      });
      return true;
    }
    if (!await canManageGroup(sock, sender, groupJid)) {
      await denied(sock, sender);
      return true;
    }
    const meta = await getGroupMetadata(sock, groupJid);
    const name = meta?.subject || 'Unknown';
    const botAdmin = await isBotGroupAdmin(sock, groupJid, sock?.user?.id);
    const lines = [
      toSmallCaps('Do you want to activate the bot in') + ' *' + name + '*?',
      '',
      toSmallCaps('Members') + ': ' + (meta?.participants?.length || 0),
      toSmallCaps('Bot is admin') + ': ' + (botAdmin ? toSmallCaps('yes') : toSmallCaps('no')),
      '',
      '1. \u2705 ' + toSmallCaps('Yes'),
      '2. \u274C ' + toSmallCaps('No'),
      '',
      '0. ' + toSmallCaps('Back')
    ];
    await sendText(sock, sender, lines.join('\n'), GROUP_OPTS);
    await setMenu(sock, sender, chatId, 'group_management_activate_confirm', {
      pendingGroupJid: groupJid
    });
    return true;
  }

  if (state === 'group_management_activate_confirm' || state === 'group_management_deactivate_confirm') {
    const groupJid = session?.pendingGroupJid;
    const meta = groupJid ? await getGroupMetadata(sock, groupJid) : null;
    const groupName = meta?.subject || getGroup(groupJid)?.name || 'Unknown';

    if (input === '1') {
      if (!await canManageGroup(sock, sender, groupJid)) {
        await denied(sock, sender);
        return true;
      }
      if (state === 'group_management_activate_confirm') {
        activateGroup(groupJid, { name: groupName, activatedBy: sender, language: user?.language || 'en' });
        await logAction(sender, 'group_activated', { groupJid, groupName });
        await sendText(
          sock, sender,
          '\u2705 ' + toSmallCaps('Activated in') + ' *' + groupName + '*.',
          GROUP_OPTS
        );
      } else {
        deactivateGroup(groupJid);
        await logAction(sender, 'group_deactivated', { groupJid, groupName });
        await sendText(
          sock, sender,
          '\u274C ' + toSmallCaps('Deactivated in') + ' *' + groupName + '*.',
          GROUP_OPTS
        );
      }
      const { sendMenuById } = await import('../utils/menuSender.js');
      return sendMenuById(MENU, { sock, sender, chatId, user, language: user?.language }, 'settings_back');
    }
    if (input === '2') {
      await sendText(sock, sender, toSmallCaps('Cancelled.'), GROUP_OPTS);
      const { sendMenuById } = await import('../utils/menuSender.js');
      return sendMenuById(MENU, { sock, sender, chatId, user, language: user?.language }, 'settings_back');
    }
    await sendText(sock, sender, '\u274C ' + toSmallCaps('Invalid choice.'), GROUP_OPTS);
    return true;
  }

  return false;
}

async function backToMenu(sock, sender, chatId) {
  const { sendMenuById } = await import('../utils/menuSender.js');
  const sessionManager = (await import('../utils/sessionManager.js')).default;
  const sess = sessionManager.getSession(sender, chatId) || {};
  const { getUserByJid } = await import('../services/userService.js');
  const user = await getUserByJid(sender);
  sessionManager.setState(sender, chatId, { pendingGroupIds: null, pendingGroupJid: null });
  return sendMenuById(
    MENU,
    { sock, sender, chatId, user, language: user?.language || sess.language },
    'settings_back'
  );
}

async function logAction(actorJid, action, payload) {
  try {
    const { logAdminAction } = await import('../services/adminLogService.js');
    logAdminAction(actorJid, action, JSON.stringify(payload));
  } catch { /* logging must never break the flow */ }
}

export const groupManagementCustomHandlers = {
  groups_my_groups: (c) => groupsMyGroups(c),
  groups_activate: (c) => groupsActivate(c),
  groups_deactivate: (c) => groupsDeactivate(c),
  groups_defaults: (c) => groupsDefaults(c)
};