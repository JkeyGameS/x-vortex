import { sendText } from '../services/messageService.js';
import { toSmallCaps } from '../utils/smallCaps.js';
import {
  listBotGroups,
  getGroupMetadata,
  getMemberCount,
  isBotGroupAdmin
} from '../utils/groupHelper.js';
import { getLanguageDisplay } from '../utils/languageHelper.js';
import { canManageGroups, canManageGroup, isBotAdmin } from '../utils/groupPermission.js';
import {
  getAllGroups,
  getEnabledGroups,
  getGroup,
  activateGroup,
  deactivateGroup,
  updateGroup,
  setGroupSetting,
  getGroupDefaults,
  setGroupDefault,
  EDITABLE_GROUP_DEFAULTS
} from '../services/groupService.js';

/**
 * Session-state prefixes this module owns. The router dispatches on these;
 * keep them in step with the predicate in src/index.js.
 */
export const GROUP_STATE_PREFIXES = ['group_management', 'group_settings', 'group_defaults'];

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

/**
 * 4. Defaults — editable (Phase 2). Bot admins only.
 *
 * Toggling a default affects groups activated from now on. Groups that already
 * exist keep their stored settings; see activateGroup's backfill.
 */
export async function groupsDefaults(context) {
  const { sock, sender, chatId } = context;
  if (!isBotAdmin(sender)) {
    return sendText(
      sock, sender,
      '\u{1F6AB} ' + toSmallCaps('Default settings are restricted to bot admins.'),
      GROUP_OPTS
    );
  }
  await sendText(sock, sender, renderDefaultsPanel(), GROUP_OPTS);
  await setMenu(sock, sender, chatId, 'group_defaults_panel');
}

const DEFAULT_TOGGLE_KEYS = EDITABLE_GROUP_DEFAULTS;

/** Options 1-6, in panel order. Index 0 is option 1. */
const DEFAULT_TOGGLE_ORDER = DEFAULT_TOGGLE_KEYS;

export function renderDefaultsPanel() {
  const d = getGroupDefaults();
  const label = (k) => (d[k] ? '\u2705 ' + toSmallCaps('on') : '\u274C ' + toSmallCaps('off'));
  const lines = [
    '> *\u2699\uFE0F ' + toSmallCaps('Default Settings') + '*',
    '',
    toSmallCaps('These apply to newly activated groups.'),
    ''
  ];
  const meta = [
    ['mentionOnly', '\u{1F514}', 'Mention Only'],
    ['chatRules', '\u{1F4AC}', 'Chat Rules'],
    ['welcome', '\u{1F44B}', 'Welcome Message'],
    ['goodbye', '\u{1F44B}', 'Goodbye Message'],
    ['antiSpam', '\u{1F6AB}', 'Anti-Spam'],
    ['antiLink', '\u{1F517}', 'Anti-Link']
  ];
  meta.forEach(([key, emoji, name], i) => {
    lines.push(`${i + 1}. ${emoji} ${toSmallCaps(name)}: ${label(key)}`);
  });
  lines.push('', '0. ' + toSmallCaps('Back'));
  return lines.join('\n');
}

/**
 * Numeric input for every group_management* / group_settings* / group_defaults*
 * sub-state.
 * @returns {Promise<boolean>} true when handled
 */
export async function handleGroupManagementReply(context, trimmedText) {
  const { sock, sender, chatId, session, user } = context;
  const state = session?.currentMenu;
  if (!state || !GROUP_STATE_PREFIXES.some((p) => state.startsWith(p))) return false;

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
    if (state === 'group_management_list') {
      // Phase 2: selecting from My Groups opens that group's settings panel.
      return openGroupSettings({ sock, sender, chatId, user, session }, groupJid);
    }
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

  // ---------------------------------------------------------------------
  // group_settings_panel
  // ---------------------------------------------------------------------
  if (state === 'group_settings_panel') {
    const groupJid = session?.currentGroupJid;
    if (!groupJid) {
      await back();
      return true;
    }
    if (!await canManageGroup(sock, sender, groupJid)) {
      await noPermission(sock, sender);
      await back();
      return true;
    }
    const n = Number(input);
    if (!Number.isInteger(n)) {
      await sendText(sock, sender, '\u274C ' + toSmallCaps('Invalid choice.'), GROUP_OPTS);
      return true;
    }
    // Options 1-6 toggle a flag.
    if (n >= 1 && n <= 6) {
      const key = PANEL_TOGGLE_KEYS[n - 1];
      const group = getGroup(groupJid);
      const oldValue = group?.settings?.[key];
      const newValue = !oldValue;
      setGroupSetting(groupJid, key, newValue);
      await logAction(sender, 'group_setting_changed', { groupJid, key, oldValue, newValue });
      return renderPanelFor({ sock, sender, chatId, user, session }, groupJid);
    }
    // 7 -> language selector
    if (n === 7) {
      const group = getGroup(groupJid);
      const lines = [
        '> *\u{1F310} ' + toSmallCaps('Group Language') + '*',
        '',
        toSmallCaps('Current') + ': ' + languageLabel(group?.language || 'en'),
        ''
      ];
      GROUP_LANGUAGES.forEach((code, i) => {
        lines.push(`${i + 1}. ${languageLabel(code)}`);
      });
      lines.push('', '0. ' + toSmallCaps('Back'));
      await sendText(sock, sender, lines.join('\n'), GROUP_OPTS);
      await setMenu(sock, sender, chatId, 'group_settings_language', { currentGroupJid: groupJid });
      return true;
    }
    // 8 -> deactivate confirmation
    if (n === 8) {
      const group = getGroup(groupJid);
      const name = group?.name || groupJid;
      const lines = [
        toSmallCaps('Do you want to deactivate the bot in') + ' *' + name + '*?',
        '',
        '1. \u2705 ' + toSmallCaps('Yes'),
        '2. \u274C ' + toSmallCaps('No'),
        '',
        '0. ' + toSmallCaps('Back')
      ];
      await sendText(sock, sender, lines.join('\n'), GROUP_OPTS);
      await setMenu(sock, sender, chatId, 'group_settings_deactivate_confirm', { currentGroupJid: groupJid });
      return true;
    }
    await sendText(sock, sender, '\u274C ' + toSmallCaps('Invalid choice.'), GROUP_OPTS);
    return true;
  }

  // ---------------------------------------------------------------------
  // group_settings_language
  // ---------------------------------------------------------------------
  if (state === 'group_settings_language') {
    const groupJid = session?.currentGroupJid;
    if (!groupJid) {
      await back();
      return true;
    }
    if (!await canManageGroup(sock, sender, groupJid)) {
      await noPermission(sock, sender);
      await back();
      return true;
    }
    const n = Number(input);
    if (!Number.isInteger(n) || n < 1 || n > GROUP_LANGUAGES.length) {
      await sendText(sock, sender, '\u274C ' + toSmallCaps('Invalid choice.'), GROUP_OPTS);
      return true;
    }
    const newLang = GROUP_LANGUAGES[n - 1];
    const group = getGroup(groupJid);
    const oldLang = group?.language;
    updateGroup(groupJid, { language: newLang });
    await logAction(sender, 'group_language_changed', { groupJid, oldLang, newLang });
    return renderPanelFor({ sock, sender, chatId, user, session }, groupJid);
  }

  // ---------------------------------------------------------------------
  // group_settings_deactivate_confirm
  // ---------------------------------------------------------------------
  if (state === 'group_settings_deactivate_confirm') {
    const groupJid = session?.currentGroupJid;
    if (!groupJid) {
      await back();
      return true;
    }
    if (!await canManageGroup(sock, sender, groupJid)) {
      await noPermission(sock, sender);
      await back();
      return true;
    }
    if (input === '1') {
      const name = getGroup(groupJid)?.name || groupJid;
      deactivateGroup(groupJid);
      // Same action name as the Phase 1 confirm flow; logged from one place.
      await logAction(sender, 'group_deactivated', { groupJid, groupName: name });
      await sendText(
        sock, sender,
        '\u274C ' + toSmallCaps('Deactivated in') + ' *' + name + '*.',
        GROUP_OPTS
      );
      await backToMenu(sock, sender, chatId);
      return true;
    }
    if (input === '2') {
      await sendText(sock, sender, toSmallCaps('Cancelled.'), GROUP_OPTS);
      return renderPanelFor({ sock, sender, chatId, user, session }, groupJid);
    }
    await sendText(sock, sender, '\u274C ' + toSmallCaps('Invalid choice.'), GROUP_OPTS);
    return true;
  }

  // ---------------------------------------------------------------------
  // group_defaults_panel
  // ---------------------------------------------------------------------
  if (state === 'group_defaults_panel') {
    if (!isBotAdmin(sender)) {
      await sendText(
        sock, sender,
        '\u{1F6AB} ' + toSmallCaps('Default settings are restricted to bot admins.'),
        GROUP_OPTS
      );
      return true;
    }
    const n = Number(input);
    if (!Number.isInteger(n)) {
      await sendText(sock, sender, '\u274C ' + toSmallCaps('Invalid choice.'), GROUP_OPTS);
      return true;
    }
    if (n >= 1 && n <= 6) {
      const key = DEFAULT_TOGGLE_ORDER[n - 1];
      const oldValue = getGroupDefaults()[key];
      const newValue = !oldValue;
      setGroupDefault(key, newValue);
      await logAction(sender, 'group_defaults_changed', { key, oldValue, newValue });
      await sendText(sock, sender, renderDefaultsPanel(), GROUP_OPTS);
      return true;
    }
    await sendText(sock, sender, '\u274C ' + toSmallCaps('Invalid choice.'), GROUP_OPTS);
    return true;
  }

  return false;
}

// ---------------------------------------------------------------------------
// Per-group settings panel (Phase 2)
// ---------------------------------------------------------------------------

/** Options 1-6, in panel order. Index 0 is option 1. */
const PANEL_TOGGLE_KEYS = ['mentionOnly', 'chatRules', 'welcome', 'goodbye', 'antiSpam', 'antiLink'];

const GROUP_LANGUAGES = ['en', 'fr', 'de', 'es', 'ar'];

/** Native language name + flag, small-capped per the typography rule. */
function languageLabel(code) {
  try {
    const d = getLanguageDisplay(code);
    return toSmallCaps(d.name) + ' ' + (d.flag || '');
  } catch {
    return toSmallCaps(code);
  }
}

const PANEL_ROWS = [
  ['mentionOnly', '\u{1F514}', 'Mention Only'],
  ['chatRules', '\u{1F4AC}', 'Chat Rules'],
  ['welcome', '\u{1F44B}', 'Welcome Message'],
  ['goodbye', '\u{1F44B}', 'Goodbye Message'],
  ['antiSpam', '\u{1F6AB}', 'Anti-Spam'],
  ['antiLink', '\u{1F517}', 'Anti-Link']
];

export function renderGroupSettingsPanel(group, memberCount) {
  const s = group.settings || {};
  const flag = (v) => (v ? '\u2705 ' + toSmallCaps('on') : '\u274C ' + toSmallCaps('off'));
  const activated = group.activatedAt
    ? String(group.activatedAt).slice(0, 10)
    : toSmallCaps('unknown');
  const lines = [
    '> *\u2699\uFE0F ' + toSmallCaps('Group Settings') + '*',
    '',
    '\u{1F194} ' + group.id,
    '\u{1F465} ' + memberCount + ' ' + toSmallCaps('members'),
    '\u2705 ' + toSmallCaps('Active since') + ' ' + activated,
    '\u{1F310} ' + toSmallCaps('Language') + ': ' + languageLabel(group.language || 'en'),
    ''
  ];
  PANEL_ROWS.forEach(([key, emoji, name], i) => {
    lines.push(`${i + 1}. ${emoji} ${toSmallCaps(name)}: ${flag(s[key])}`);
  });
  lines.push(
    '7. \u{1F310} ' + toSmallCaps('Language'),
    '',
    '8. \u26D4 ' + toSmallCaps('Deactivate Group'),
    '',
    '0. ' + toSmallCaps('Back')
  );
  return lines.join('\n');
}

/**
 * Open (or re-render) the settings panel for one group.
 * Re-rendering after a toggle reuses this, which is the edit-or-delete-then-send
 * behaviour: the panel is a fresh send and the previous one is left to the
 * normal transition handling.
 */
export async function openGroupSettings(context, groupJid) {
  const { sock, sender, chatId } = context;
  if (!await canManageGroup(sock, sender, groupJid)) {
    return noPermission(sock, sender);
  }
  const group = getGroup(groupJid);
  if (!group) {
    return sendText(sock, sender, '\u274C ' + toSmallCaps('Group not found.'), GROUP_OPTS);
  }
  return renderPanelFor(context, groupJid);
}

async function renderPanelFor(context, groupJid) {
  const { sock, sender, chatId } = context;
  const group = getGroup(groupJid);
  if (!group) {
    return sendText(sock, sender, '\u274C ' + toSmallCaps('Group not found.'), GROUP_OPTS);
  }
  let memberCount = 0;
  try {
    memberCount = await getMemberCount(sock, groupJid);
  } catch { /* metadata is optional in the header */ }
  await sendText(sock, sender, renderGroupSettingsPanel(group, memberCount), GROUP_OPTS);
  await setMenu(sock, sender, chatId, 'group_settings_panel', { currentGroupJid: groupJid });
  return true;
}

function noPermission(sock, sender) {
  return sendText(
    sock, sender,
    '\u{1F6AB} ' + toSmallCaps("You don't have permission to manage this group."),
    GROUP_OPTS
  );
}

async function backToMenu(sock, sender, chatId) {
  const { sendMenuById } = await import('../utils/menuSender.js');
  const sessionManager = (await import('../utils/sessionManager.js')).default;
  const sess = sessionManager.getSession(sender, chatId) || {};
  const { getUserByJid } = await import('../services/userService.js');
  const user = await getUserByJid(sender);
  sessionManager.setState(sender, chatId, {
    pendingGroupIds: null,
    pendingGroupJid: null,
    currentGroupJid: null
  });
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
  groups_defaults: (c) => groupsDefaults(c),
  groups_group_settings: (c) => {
    const groupJid = c?.pendingGroupJid || c?.session?.pendingGroupJid;
    if (!groupJid) {
      return sendText(c.sock, c.sender, '\u274C ' + toSmallCaps('Group not found.'), GROUP_OPTS);
    }
    return openGroupSettings(c, groupJid);
  }
};

/**
 * /groupsettings <groupJid> [gset]
 *
 * Auto-registered: loadCommands() scans src/handlers/*.js and picks up
 * `module.command`. DM only -- groupAllowed is false so this can never run in a
 * group, preserving the DM/group separation from Phase 1.
 */
export const command = {
  name: 'groupsettings',
  aliases: ['gset'],
  description: 'Open settings for a group',
  usage: '/groupsettings <groupJid>',
  adminOnly: false,
  groupAllowed: false,
  async execute(context) {
    const groupJid = context.args?.[0];
    if (!groupJid) {
      await sendText(
        context.sock, context.sender,
        toSmallCaps('Usage: /groupsettings <groupJid>'),
        GROUP_OPTS
      );
      return { success: false };
    }
    await openGroupSettings(context, groupJid);
    return { success: true };
  }
};

export const commands = [command];