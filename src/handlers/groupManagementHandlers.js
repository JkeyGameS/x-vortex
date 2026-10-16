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
export const GROUP_STATE_PREFIXES = [
  'group_management',
  'group_settings',
  'group_defaults',
  'group_moderation',
  // Must match the prefix list in src/index.js. Without this the guard below
  // rejected every group_stats_* state before its branch ran, so "0" fell
  // through to the DM chat rules instead of going back.
  'group_stats'
];

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

/**
 * Build the unified "My Groups" rows.
 *
 * Two sources, deduplicated by JID:
 *   1. everything in data/groups.json the user can manage -> active or deactivated
 *   2. every other group the bot is in that the user can manage -> available
 *
 * Source 2 is the fix for the "Group not found." bug: the old list was built
 * from Baileys alone, so a group the user manages but never activated appeared
 * with an "off" marker and selecting it called openGroupSettings ->
 * getGroup() -> undefined -> "Group not found.". Every row now has a status
 * and a defined action.
 *
 * Rows carry jid, name and status; the numeric dispatcher reads them from
 * session.managedGroups rather than re-resolving anything.
 */
async function buildGroupRows(sock, sender) {
  const rows = [];
  const seen = new Set();
  const botAdmin = isBotAdmin(sender);

  for (const g of getAllGroups()) {
    if (!g?.id || seen.has(g.id)) continue;
    seen.add(g.id);
    // A registered group the user cannot manage is still theirs -- they
    // activated it -- so it stays visible, just not selectable as an action
    // target for them.
    const manageable = botAdmin || await canManageGroup(sock, sender, g.id);
    rows.push({
      jid: g.id,
      name: g.name || 'Unknown',
      status: g.enabled === true ? 'active' : 'deactivated',
      manageable
    });
  }

  try {
    const { listBotGroups } = await import('../utils/groupHelper.js');
    for (const g of await listBotGroups(sock)) {
      if (!g?.id || seen.has(g.id)) continue;
      seen.add(g.id);
      const manageable = botAdmin || await canManageGroup(sock, sender, g.id);
      if (!manageable) continue;
      rows.push({ jid: g.id, name: g.subject || 'Unknown', status: 'available', manageable: true });
    }
  } catch { /* the registry rows above are still worth showing */ }

  const order = { active: 0, deactivated: 1, available: 2 };
  rows.sort((a, b) => {
    const o = order[a.status] - order[b.status];
    return o !== 0 ? o : String(a.name).localeCompare(String(b.name));
  });
  return rows;
}

function statusLabel(status) {
  if (status === 'active') return '\u2705 ' + toSmallCaps('Active');
  if (status === 'deactivated') return '\u23F8\uFE0F ' + toSmallCaps('Deactivated');
  return '\u26AA ' + toSmallCaps('Available');
}

const GROUP_LIST_LIMIT = 10;

/** 1. My Groups — one list, three states, one action per row. */
export async function groupsMyGroups(context) {
  const { sock, sender, chatId } = context;
  if (!await canManageGroups(sock, sender)) return denied(sock, sender);
  try {
    const rows = await buildGroupRows(sock, sender);
    const shown = rows.slice(0, GROUP_LIST_LIMIT);
    const lines = ['> *\u{1F4CB} ' + toSmallCaps('My Groups') + '*', ''];

    if (!shown.length) {
      lines.push(
        toSmallCaps('You don\'t manage any groups where I\'m a member.'),
        '',
        '0. ' + toSmallCaps('Back')
      );
    } else {
      shown.forEach((r, i) => {
        lines.push(`${i + 1}. ${r.name} ${statusLabel(r.status)}`);
      });
      if (rows.length > GROUP_LIST_LIMIT) {
        lines.push(
          '',
          toSmallCaps('Showing') + ' *' + GROUP_LIST_LIMIT + '* ' + toSmallCaps('of') + ' *' + rows.length + '*'
        );
      }
      lines.push('', '0. ' + toSmallCaps('Back'));
      lines.push('', '_' + toSmallCaps('Reply with the number of your choice.') + '_');
    }

    await sendText(sock, sender, lines.join('\n'), GROUP_OPTS);
    await setMenu(sock, sender, chatId, 'group_management_list', {
      // Rows, not just JIDs: the dispatcher needs the status to pick an action.
      managedGroups: shown,
      managedGroupTotal: rows.length,
      pendingGroupIds: shown.map((r) => r.jid),
      pendingGroupJid: null
    });
  } catch (err) {
    await failed(sock, sender);
  }
}

/** Re-render the list after a cancel, without rebuilding it. */
async function reopenGroupList(context, note) {
  const { sock, sender, chatId } = context;
  const rows = Array.isArray(context.session?.managedGroups) ? context.session.managedGroups : [];
  if (note) await sendText(sock, sender, note, GROUP_OPTS);
  if (!rows.length) return groupsMyGroups(context);
  const lines = ['> *\u{1F4CB} ' + toSmallCaps('My Groups') + '*', ''];
  rows.forEach((r, i) => lines.push(`${i + 1}. ${r.name} ${statusLabel(r.status)}`));
  lines.push('', '0. ' + toSmallCaps('Back'));
  lines.push('', '_' + toSmallCaps('Reply with the number of your choice.') + '_');
  await sendText(sock, sender, lines.join('\n'), GROUP_OPTS);
  await setMenu(sock, sender, chatId, 'group_management_list', {
    managedGroups: rows,
    pendingGroupIds: rows.map((r) => r.jid),
    pendingGroupJid: null,
    pendingGroupAction: null,
    confirmAttempts: 0
  });
  return true;
}

/** Ask before turning the bot on in a group that is not currently on. */
async function promptActivate(context, row) {
  const { sock, sender, chatId } = context;
  const isReactivate = row.status === 'deactivated';
  const lines = [
    isReactivate
      ? toSmallCaps('This group is deactivated.')
      : toSmallCaps('This group is not activated yet.'),
    '',
    toSmallCaps(isReactivate ? 'Do you want to reactivate' : 'Do you want to activate the bot in') + ' *' + row.name + '*?',
    '',
    '1. \u2705 ' + toSmallCaps(isReactivate ? 'Reactivate' : 'Activate'),
    '2. \u274C ' + toSmallCaps('Cancel'),
    '',
    '0. ' + toSmallCaps('Back')
  ];
  await sendText(sock, sender, lines.join('\n'), GROUP_OPTS);
  await setMenu(sock, sender, chatId, 'group_management_activate_confirm', {
    pendingGroupJid: row.jid,
    pendingGroupName: row.name,
    pendingGroupAction: isReactivate ? 'reactivate' : 'activate',
    confirmAttempts: 0
  });
  return true;
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

  // The top-level Group Management menu is a normal registered menu: its
  // options (1-7) and its back option (0 -> main_menu) belong to the generic
  // menu resolver. Decline every input for it so the resolver owns them.
  // Without this, "0" here re-rendered this same menu and the user could not
  // leave Group Management at all.
  if (state === MENU) return false;

  try {
    const { cancelStartHint } = await import('../services/startHintService.js');
    cancelStartHint(sender);
  } catch { /* optional */ }

  const input = String(trimmedText || '').trim();
  const back = () => backToMenu(sock, sender, chatId);

// Stats viewers and the moderation log are informational: 0 goes back, anything
      // else is an invalid choice and the panel stays. Checked BEFORE the
      // moderation branch because group_moderation_log also starts with
      // 'group_moderation' and would otherwise be captured by it.
      if (state === 'group_moderation_log' || state.startsWith('group_stats')) {
        return handleStatsSubState({ sock, sender, chatId, user, session }, state, input);
      }

      // Moderation submenu owns its own numeric flow (Phase 4).
      if (state.startsWith('group_moderation')) {
        return handleModerationSubState({ sock, sender, chatId, user, session }, state, input);
      }

  if (input === '0' || input === 'back') {
    return back();
  }

  // Numeric pick against the stored list for this state.
if (state === 'group_management_list') {
          // Unified list: the row carries its own status, so the action follows
          // from it instead of from which screen the list was opened from.
          // Selecting an active group opens its settings panel; anything not
          // active asks first, then activates. There is no longer a path from
          // here to "Group not found." -- every row has a defined outcome.
          const rows = Array.isArray(session?.managedGroups) ? session.managedGroups : [];
          const idx = Number(input);
          if (!Number.isInteger(idx) || idx < 1 || idx > rows.length) {
            await sendText(sock, sender, '\u274C ' + toSmallCaps('Invalid choice.'), GROUP_OPTS);
            return true;
          }
          const row = rows[idx - 1];
          if (row.status === 'active') {
            return openGroupSettings({ sock, sender, chatId, user, session }, row.jid);
          }
          return promptActivate({ sock, sender, chatId, user, session }, row);
        }

        if (state === 'group_management_activate_confirm') {
          const groupJid = session?.pendingGroupJid;
          if (input === '0' || input === '2') {
            return reopenGroupList(
              { sock, sender, chatId, user, session },
              '\u274C ' + toSmallCaps('Cancelled.')
            );
          }
          if (input !== '1') {
            await sendText(sock, sender, '\u274C ' + toSmallCaps('Invalid choice.'), GROUP_OPTS);
            return true;
          }
          if (!await canManageGroup(sock, sender, groupJid)) {
            await denied(sock, sender);
            return true;
          }
          const wasReactivate = session?.pendingGroupAction === 'reactivate';
          const storedName = session?.pendingGroupName;
          const meta = await getGroupMetadata(sock, groupJid);
          const name = storedName || meta?.subject || 'Unknown';
          activateGroup(groupJid, { name, activatedBy: sender, language: user?.language || 'en' });
          // Establish the stats-backed member baseline now, so the first welcome
          // message reports the real count instead of the lagging metadata
          // roster. Same reason the old top-level activate flow did this.
          try {
            const { syncMemberCount } = await import('../utils/groupHelper.js');
            await syncMemberCount(sock, groupJid);
          } catch { /* member sync is best-effort */ }
          await logAction(sender, wasReactivate ? 'group_reactivated' : 'group_activated', { groupJid, groupName: name });
          await sendText(
            sock, sender,
            '\u2705 ' + toSmallCaps(wasReactivate ? 'Group reactivated.' : 'Group activated.') + ' *' + name + '*',
            GROUP_OPTS
          );
          // Clear the activation bookkeeping, then open the panel directly so
          // the user lands where they would have after activating by hand.
          sessionManager.setState(sender, chatId, {
            pendingGroupJid: null,
            pendingGroupName: null,
            pendingGroupAction: null,
            confirmAttempts: 0
          });
          return openGroupSettings(
            { sock, sender, chatId, user, session: sessionManager.getSession(sender, chatId) },
            groupJid
          );
        }

if (state === 'group_management_deactivate') {
    const n = Number(input);
    const ids = Array.isArray(session?.pendingGroupIds) ? session.pendingGroupIds : [];
    if (!Number.isInteger(n) || n < 1 || n > ids.length) {
      await sendText(sock, sender, '\u274C ' + toSmallCaps('Invalid choice.'), GROUP_OPTS);
      return true;
    }
    const groupJid = ids[n - 1];
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

  // Deactivation only. Activation has its own branch above, reached from the
  // unified My Groups list, which reopens the group's settings panel after the
  // fact rather than bouncing back to the GM menu.
  if (state === 'group_management_deactivate_confirm') {
    const groupJid = session?.pendingGroupJid;
    const meta = groupJid ? await getGroupMetadata(sock, groupJid) : null;
    const groupName = meta?.subject || getGroup(groupJid)?.name || 'Unknown';

    if (input === '1') {
      if (!await canManageGroup(sock, sender, groupJid)) {
        await denied(sock, sender);
        return true;
      }
      deactivateGroup(groupJid);
      await logAction(sender, 'group_deactivated', { groupJid, groupName });
      await sendText(
        sock, sender,
        '\u274C ' + toSmallCaps('Deactivated in') + ' *' + groupName + '*.',
        GROUP_OPTS
      );
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
    const { sendMenuById } = await import('../utils/menuSender.js');
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
    await openUserActions(context);
    return true;
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
    await openUserActions(context);
    return true;
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
    await openUserActions(context);
    return true;
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
    // The old top-level "About Stats" screen became this footnote. It is
    // informational only -- deliberately not a numbered option, because 1..N
    // is already the top-groups leaderboard above and a menu entry there would
    // collide with it.
    lines.push('', '_' + toSmallCaps('Stats track message counts, joins, top members, peak hours (90-day history).') + '_');

    await sendText(sock, sender, lines.join('\n'), GROUP_OPTS);
    await setMenu(sock, sender, chatId, 'group_stats_aggregate');
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
  const { sendMenuById } = await import('../utils/menuSender.js');

  if (input === '0' || input === 'back') {
    if (state === 'group_stats_panel' || state === 'group_moderation_log') {
      // Both are opened from a group's settings panel, so "back" returns there
      // with the group still selected. currentGroupJid is preserved deliberately
      // so the panel can be re-rendered without re-picking.
      const groupJid = session?.statsGroupJid;
      sessionManager.setState(sender, chatId, { statsGroupJid: null, currentGroupJid: groupJid });
      if (!groupJid) {
        return sendMenuById(
          MENU,
          { sock, sender, chatId, user, language: user?.language },
          'settings_back'
        );
      }
      return renderPanelFor({ sock, sender, chatId, user, session }, groupJid);
    }
    // aggregate + about are opened from the Group Management menu.
    sessionManager.setState(sender, chatId, { statsGroupJid: null });
    return sendMenuById(
      MENU,
      { sock, sender, chatId, user, language: user?.language },
      'settings_back'
    );
  }

  // These views are informational; anything else is an invalid choice and the
  // panel stays put.
  await sendText(sock, sender, '\u274C ' + toSmallCaps('Invalid choice.'), GROUP_OPTS);
  return true;
}

export const groupManagementCustomHandlers = {
  groups_my_groups: (c) => groupsMyGroups(c),
  groups_defaults: (c) => groupsDefaults(c),
  // Moderation submenu (Phase 4). Reached from Group Management option 3.
  groups_moderation: (c) => openModerationRoot(c),
  // Stats viewer (Phase 6). Reached from Group Management option 2.
  groups_aggregate_stats: (c) => openAggregateStats(c),
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
