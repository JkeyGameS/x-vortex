import { sendText } from '../services/messageService.js';
import { toSmallCaps } from '../utils/smallCaps.js';
import {
  listBotGroups,
  getGroupMetadata,
  getMemberCount,
  isBotGroupAdmin
} from '../utils/groupHelper.js';
import { getLanguageDisplay } from '../utils/languageHelper.js';
import config from '../config/config.js';
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
export const GROUP_STATE_PREFIXES = ['group_management', 'group_settings', 'group_defaults', 'group_moderation'];

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

  // Moderation submenu owns its own numeric flow (Phase 4).
  if (state.startsWith('group_moderation')) {
    return handleModerationSubState({ sock, sender, chatId, user, session }, state, input);
  }

  // Stats viewers are informational; 0 goes back (Phase 6).
  if (state.startsWith('group_stats') || state === 'group_moderation_log') {
    return handleStatsSubState({ sock, sender, chatId, user, session }, state, input);
  }

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
        // Establish the stats-backed member baseline now, so the first welcome
        // message reports the real count instead of falling back to the
        // lagging metadata roster.
        try {
          const { syncMemberCount } = await import('../utils/groupHelper.js');
          await syncMemberCount(sock, groupJid);
        } catch { /* member sync is best-effort */ }
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
    // 8 -> per-group stats
    if (n === 8) {
      return openGroupStats({ sock, sender, chatId, user, session }, groupJid);
    }
    // 9 -> moderation log for this group
    if (n === 9) {
      return openModerationLog({ sock, sender, chatId, user, session }, groupJid);
    }
    // 10 -> deactivate confirmation (renumbered in Phase 6; was 8)
    if (n === 10) {
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
    '8. \u{1F4CA} ' + toSmallCaps('Stats'),
    '9. \u26A0\uFE0F ' + toSmallCaps('Moderation Log'),
    '10. \u26D4 ' + toSmallCaps('Deactivate Group'),
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

// ---------------------------------------------------------------------------
// Moderation submenu (Phase 4)
//
// group_moderation_group     -> pick a group the actor moderates
// group_moderation_user      -> pick a member (20 per page)
// group_moderation_action    -> warn/mute/kick/ban/...
// group_moderation_duration  -> pick a mute duration
//
// Every action delegates to moderationHandlers.js, the same code the slash
// commands use, so the two entry points cannot diverge.
// ---------------------------------------------------------------------------

async function openModerationRoot(context) {
  const { sock, sender, chatId } = context;
  const mod = await import('./moderationHandlers.js');
  const groups = await mod.listModeratedGroups(sock, sender);
  if (!groups.length) {
    await sendText(
      sock, sender,
      toSmallCaps('You do not moderate any activated groups.'),
      GROUP_OPTS
    );
    return;
  }
  const lines = ['> *\u26A0\uFE0F ' + toSmallCaps('Moderation') + '*', ''];
  groups.forEach((g, i) => {
    lines.push(`${i + 1}. ${g.name || g.id}`);
  });
  lines.push('', '0. ' + toSmallCaps('Back'));
  await sendText(sock, sender, lines.join('\n'), GROUP_OPTS);
  await setMenu(sock, sender, chatId, 'group_moderation_group', {
    moderationGroupIds: groups.map((g) => g.id),
    currentGroupJid: null
  });
}

/** Dispatch the four group_moderation_* sub-states. */
async function handleModerationSubState(context, state, input) {
  const { sock, sender, chatId, user, session } = context;
  const mod = await import('./moderationHandlers.js');

  const back = async (patch = {}) => {
    const sessionManager = (await import('../utils/sessionManager.js')).default;
    sessionManager.setState(sender, chatId, {
      moderationGroupIds: null,
      currentGroupJid: null,
      pendingGroupJid: null,
      pendingPage: null,
      ...patch
    });
    return sendMenuById(MENU, { sock, sender, chatId, user, language: user?.language }, 'settings_back');
  };

  if (input === '0' || input === 'back') {
    if (state === 'group_moderation_action' || state === 'group_moderation_duration') {
      // Back up one step rather than all the way out.
      return openUserActions({ sock, sender, chatId, user, session });
    }
    return back();
  }

  // --- pick a group -------------------------------------------------------
  if (state === 'group_moderation_group') {
    const ids = Array.isArray(session?.moderationGroupIds) ? session.moderationGroupIds : [];
    const n = Number(input);
    if (!Number.isInteger(n) || n < 1 || n > ids.length) {
      await sendText(sock, sender, '\u274C ' + toSmallCaps('Invalid choice.'), GROUP_OPTS);
      return true;
    }
    const groupJid = ids[n - 1];
    const meta = await getGroupMetadata(sock, groupJid);
    const participants = Array.isArray(meta?.participants) ? meta.participants : [];
    const users = participants.map((p) => ({
      jid: p.id,
      label: (p.pushName || String(p.id).split('@')[0]) +
        (p.admin === 'admin' || p.admin === 'superadmin' ? ' \u{1F451}' : '')
    }));
    await setMenu(sock, sender, chatId, 'group_moderation_user', {
      currentGroupJid: groupJid,
      pendingUserIds: users.map((u) => u.jid),
      pendingUserLabels: users.map((u) => u.label),
      pendingPage: 0
    });
    await sendUserPicker({ sock, sender, chatId }, users, 0);
    return true;
  }

  // --- pick a member (paginated) -----------------------------------------
  if (state === 'group_moderation_user') {
    const ids = Array.isArray(session?.pendingUserIds) ? session.pendingUserIds : [];
    const labels = Array.isArray(session?.pendingUserLabels) ? session.pendingUserLabels : [];
    const page = Number(session?.pendingPage) || 0;
    const n = Number(input);
    // A value past the end of the page is a next-page request.
    if (Number.isInteger(n) && n > mod.MEMBER_PAGE_SIZE && n <= Math.ceil(ids.length / mod.MEMBER_PAGE_SIZE)) {
      const next = page + 1;
      await setMenu(sock, sender, chatId, 'group_moderation_user', { pendingPage: next });
      await sendUserPicker({ sock, sender, chatId }, sliceUsers(labels, ids, next), next, ids.length);
      return true;
    }
    const idx = page * mod.MEMBER_PAGE_SIZE + (n - 1);
    if (!Number.isInteger(n) || n < 1 || idx >= ids.length) {
      await sendText(sock, sender, '\u274C ' + toSmallCaps('Invalid choice.'), GROUP_OPTS);
      return true;
    }
    await setMenu(sock, sender, chatId, 'group_moderation_action', {
      pendingGroupJid: ids[idx],
      pendingUserLabel: labels[idx]
    });
    await openUserActions(context);
    return true;
  }

  // --- pick an action -----------------------------------------------------
  if (state === 'group_moderation_action') {
    const groupJid = session?.currentGroupJid;
    const userJid = session?.pendingGroupJid;
    if (!groupJid || !userJid) return back();
    const n = Number(input);
    if (!Number.isInteger(n) || n < 1 || n > 7) {
      await sendText(sock, sender, '\u274C ' + toSmallCaps('Invalid choice.'), GROUP_OPTS);
      return true;
    }
    if (n === 2) {
      // Mute needs a duration first.
      await sendText(sock, sender, mod.renderDurationPicker(), GROUP_OPTS);
      await setMenu(sock, sender, chatId, 'group_moderation_duration', { pendingGroupJid: userJid });
      return true;
    }
    const flows = {
      1: mod.flowWarn,
      3: mod.flowKick,
      4: mod.flowBan,
      5: mod.flowWarnings,
      6: mod.flowUnmute,
      7: mod.flowUnban
    };
    const flow = flows[n];
    if (!flow) return true;
    await flow({ sock, sender, chatId, user }, { groupJid, userJid });
    return openUserActions(context);
  }

  // --- pick a mute duration ----------------------------------------------
  if (state === 'group_moderation_duration') {
    const groupJid = session?.currentGroupJid;
    const userJid = session?.pendingGroupJid;
    if (!groupJid || !userJid) return back();
    const presets = (config.moderation && config.moderation.presetMuteDurations) || [];
    const n = Number(input);
    if (!Number.isInteger(n) || n < 1 || n > presets.length + 1) {
      await sendText(sock, sender, '\u274C ' + toSmallCaps('Invalid choice.'), GROUP_OPTS);
      return true;
    }
    if (n === presets.length + 1) {
      await sendText(
        sock, sender,
        toSmallCaps('Send the number of minutes to mute for.'),
        GROUP_OPTS
      );
      await setMenu(sock, sender, chatId, 'group_moderation_duration_custom', {
        pendingGroupJid: userJid
      });
      return true;
    }
    await mod.flowMute({ sock, sender, chatId, user }, {
      groupJid, userJid, durationMs: presets[n - 1]
    });
    return openUserActions(context);
  }

  // --- custom mute duration (free text) ----------------------------------
  if (state === 'group_moderation_duration_custom') {
    const groupJid = session?.currentGroupJid;
    const userJid = session?.pendingGroupJid;
    if (!groupJid || !userJid) return back();
    const minutes = Number(input);
    if (!Number.isInteger(minutes) || minutes <= 0) {
      await sendText(sock, sender, '\u274C ' + toSmallCaps('Send a whole number of minutes.'), GROUP_OPTS);
      return true;
    }
    await mod.flowMute({ sock, sender, chatId, user }, {
      groupJid, userJid, durationMs: minutes * 60_000
    });
    return openUserActions(context);
  }

  return false;
}

function sliceUsers(labels, ids, page) {
  const start = page * 20;
  return labels.slice(start, start + 20).map((label, i) => ({
    jid: ids[start + i],
    label
  }));
}

async function sendUserPicker(target, users, page, total) {
  const mod = await import('./moderationHandlers.js');
  await sendText(
    target.sock,
    target.sender,
    mod.renderMemberPicker(users, page, total ?? users.length),
    GROUP_OPTS
  );
}

async function openUserActions(context) {
  const { sock, sender, chatId, user, session } = context;
  const mod = await import('./moderationHandlers.js');
  const label = session?.pendingUserLabel || String(session?.pendingGroupJid || '').split('@')[0];
  await sendText(sock, sender, mod.renderUserActions(label), GROUP_OPTS);
  await setMenu(sock, sender, chatId, 'group_moderation_action');
}

// ---------------------------------------------------------------------------
// Stats viewers (Phase 6)
// ---------------------------------------------------------------------------

const num = (n) => (Number.isFinite(Number(n)) ? String(Math.floor(Number(n))) : '0');

/** Bar scaled to the busiest day in the window; at least one block when > 0. */
function bar(count, max) {
  if (!count) return '';
  const filled = Math.max(1, Math.round((count / Math.max(1, max)) * 10));
  return '\u2588'.repeat(filled);
}

/** Open the per-group stats panel and refresh the member count while we are here. */
async function openGroupStats(context, groupJid) {
  const { sock, sender, chatId, user, session } = context;
  if (!await canManageGroup(sock, sender, groupJid)) {
    return noPermission(sock, sender);
  }
  const statsSvc = await import('../services/groupStatsService.js');
  const group = getGroup(groupJid);
  if (!group) {
    return sendText(sock, sender, '\u274C ' + toSmallCaps('Group not found.'), GROUP_OPTS);
  }
  // Self-heal the counter if a join or leave was missed while offline.
  const { syncMemberCount } = await import('../utils/groupHelper.js');
  await syncMemberCount(sock, groupJid);

  const s = statsSvc.getGroupStats(groupJid);
  const members = statsSvc.getCurrentMemberCount(groupJid);
  const daily = statsSvc.getDailyActivity(groupJid, 7);
  const maxDay = Math.max(0, ...daily.map((d) => d.count));
  const peak = statsSvc.getPeakHour(groupJid);
  const top = statsSvc.getTopMembers(groupJid, 5);

  const lines = [
    '> *\u{1F4CA} ' + toSmallCaps('Group Stats') + '*',
    '',
    group.name || groupJid,
    '',
    '\u{1F4E8} ' + toSmallCaps('Total messages') + ': ' + num(s?.totalMessages),
    '\u{1F465} ' + toSmallCaps('Members') + ': ' + (members != null ? num(members) : toSmallCaps('unknown')),
    '\u{1F4E5} ' + toSmallCaps('Joins') + ': ' + num(s?.joins),
    '\u{1F4E4} ' + toSmallCaps('Leaves') + ': ' + num(s?.leaves),
    '\u23F0 ' + toSmallCaps('Peak hour') + ': ' +
      (peak ? peak[0] + ':00\u2013' + ((Number(peak[0]) + 1) % 24) + ':00' : toSmallCaps('unknown'))
  ];

  lines.push('', '\u{1F4C5} ' + toSmallCaps('Last 7 days') + ':');
  for (const d of daily) {
    lines.push(`${d.date.slice(5)} ${bar(d.count, maxDay)} ${num(d.count)}`);
  }

  lines.push('', '\u{1F3C6} ' + toSmallCaps('Top members') + ':');
  if (!top.length) {
    lines.push(toSmallCaps('No activity yet.'));
  } else {
    top.forEach(([jid, count], i) => {
      lines.push(`${i + 1}. ${jid.split('@')[0]} — ${num(count)}`);
    });
  }
  lines.push('', '0. ' + toSmallCaps('Back'));

  await sendText(sock, sender, lines.join('\n'), GROUP_OPTS);
  await setMenu(sock, sender, chatId, 'group_stats_panel', { statsGroupJid: groupJid });
  return true;
}

/** Aggregate totals. Bot admins see every group; group admins see only theirs. */
async function openAggregateStats(context) {
  const { sock, sender, chatId, user } = context;
  const statsSvc = await import('../services/groupStatsService.js');
  const all = statsSvc.getTopGroups(10);
  const totals = statsSvc.getAggregateStats();

  const botAdmin = isBotAdmin(sender);
  let visible = all;
  if (!botAdmin) {
    visible = [];
    for (const row of all) {
      if (await canManageGroup(sock, sender, row.jid)) visible.push(row);
    }
  }

  const names = new Map(getAllGroups().map((g) => [g.id, g.name]));
  const lines = [
    '> *\u{1F4CA} ' + toSmallCaps('Aggregate Stats') + '*',
    '',
    '\u{1F465} ' + toSmallCaps('Total groups') + ': ' + num(totals.groupCount),
    '\u{1F4E8} ' + toSmallCaps('Total messages') + ': ' + num(totals.totalMessages),
    '\u{1F4E5} ' + toSmallCaps('Total joins') + ': ' + num(totals.totalJoins),
    '\u{1F4E4} ' + toSmallCaps('Total leaves') + ': ' + num(totals.totalLeaves),
    '',
    '\u{1F3C6} ' + toSmallCaps('Top groups by activity') + ':'
  ];
  if (!visible.length) {
    lines.push(toSmallCaps('No activity yet.'));
  } else {
    visible.forEach((row, i) => {
      lines.push(`${i + 1}. ${names.get(row.jid) || row.jid} — ${num(row.totalMessages)}`);
    });
  }
  lines.push('', '0. ' + toSmallCaps('Back'));

  await sendText(sock, sender, lines.join('\n'), GROUP_OPTS);
  await setMenu(sock, sender, chatId, 'group_stats_aggregate');
  return true;
}

async function openAboutStats(context) {
  const { sock, sender, chatId } = context;
  const lines = [
    '> *\u2139\uFE0F ' + toSmallCaps('About Stats') + '*',
    '',
    toSmallCaps('Stats track message counts, joins, leaves, top members, and peak hours.'),
    '',
    toSmallCaps('Available in per-group settings and in the aggregate view.'),
    toSmallCaps('Daily history is kept for 90 days.'),
    '',
    '0. ' + toSmallCaps('Back')
  ];
  await sendText(sock, sender, lines.join('\n'), GROUP_OPTS);
  await setMenu(sock, sender, chatId, 'group_stats_about');
  return true;
}

/** Active warnings, mutes and bans for one group. */
async function openModerationLog(context, groupJid) {
  const { sock, sender, chatId, user, session } = context;
  if (!await canManageGroup(sock, sender, groupJid)) {
    return noPermission(sock, sender);
  }
  const mod = await import('../services/moderationService.js');
  const log = mod.getModerationLog(groupJid);
  const group = getGroup(groupJid);
  const short = (jid) => String(jid).split('@')[0];

  const lines = [
    '> *\u26A0\uFE0F ' + toSmallCaps('Moderation Log') + '*',
    '',
    group?.name || groupJid,
    '',
    '\u26A0\uFE0F ' + toSmallCaps('Active warnings') + ': ' + num(Object.keys(log?.warnings || {}).length),
    '\u{1F507} ' + toSmallCaps('Active mutes') + ': ' + num(Object.keys(log?.mutes || {}).length),
    '\u26D4 ' + toSmallCaps('Active bans') + ': ' + num(Object.keys(log?.bans || {}).length)
  ];

  const warned = Object.entries(log?.warnings || {}).sort((a, b) => (b[1].count || 0) - (a[1].count || 0));
  lines.push('', toSmallCaps('Users with warnings') + ':');
  if (!warned.length) lines.push(toSmallCaps('None.'));
  else warned.forEach(([jid, e], i) => {
    lines.push(`${i + 1}. @${short(jid)} — ${num(e.count)} ${toSmallCaps('warnings')}`);
  });

  const muted = Object.entries(log?.mutes || {});
  lines.push('', toSmallCaps('Users muted') + ':');
  if (!muted.length) lines.push(toSmallCaps('None.'));
  else muted.forEach(([jid, e], i) => {
    const until = e.until ? new Date(e.until) : null;
    const when = until && !Number.isNaN(until.getTime())
      ? until.toISOString().slice(11, 16)
      : '?';
    lines.push(`${i + 1}. @${short(jid)} — ${toSmallCaps('until')} ${when}`);
  });

  const banned = Object.entries(log?.bans || {});
  lines.push('', toSmallCaps('Users banned') + ':');
  if (!banned.length) lines.push(toSmallCaps('None.'));
  else banned.forEach(([jid, e], i) => {
    lines.push(`${i + 1}. @${short(jid)} — ${e.reason ?? ''}`);
  });

  lines.push('', '0. ' + toSmallCaps('Back'));
  await sendText(sock, sender, lines.join('\n'), GROUP_OPTS);
  await setMenu(sock, sender, chatId, 'group_moderation_log', { statsGroupJid: groupJid });
  return true;
}

/** Dispatch the group_stats_* / group_moderation_log sub-states. */
async function handleStatsSubState(context, state, input) {
  const { sock, sender, chatId, user, session } = context;
  const sessionManager = (await import('../utils/sessionManager.js')).default;

  if (input === '0' || input === 'back') {
    sessionManager.setState(sender, chatId, { statsGroupJid: null });
    // Return to the Group Management menu from every stats view.
    return sendMenuById(MENU, { sock, sender, chatId, user, language: user?.language }, 'settings_back');
  }

  // These views are informational; anything else is an invalid choice.
  await sendText(sock, sender, '\u274C ' + toSmallCaps('Invalid choice.'), GROUP_OPTS);
  return true;
}

export const groupManagementCustomHandlers = {
  groups_my_groups: (c) => groupsMyGroups(c),
  groups_activate: (c) => groupsActivate(c),
  groups_deactivate: (c) => groupsDeactivate(c),
  groups_defaults: (c) => groupsDefaults(c),
  // Moderation submenu (Phase 4). Reached from Group Management option 5.
  groups_moderation: (c) => openModerationRoot(c),
  // Stats viewers (Phase 6). Reached from Group Management options 6 and 7.
  groups_aggregate_stats: (c) => openAggregateStats(c),
  groups_about_stats: (c) => openAboutStats(c),
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