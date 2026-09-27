import config, { isMenuMigrated } from '../config/config.js';
import sessionManager from '../utils/sessionManager.js';
import { sendMenuById } from '../utils/menuSender.js';
import { sendMenu } from '../utils/messageHelper.js';
import { sendText } from '../services/messageService.js';
import { buildMenu } from '../utils/menuBuilder.js';
import { toSmallCaps } from '../utils/smallCaps.js';
import { t } from '../services/localeService.js';
import * as userService from '../services/userService.js';
import * as blockService from '../services/blockedUsersService.js';
import { logAdminAction } from '../services/adminLogService.js';

const PAGE_SIZE = 10;
const languageOf = (context) => context.language || config.defaultLanguage;
const L = (language, key) => toSmallCaps(t(language, key));
const back = (language) => '0. ' + L(language, 'admin.test.optionBack');
const adminContext = (context, menu, extra = {}) => {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  sessionManager.setState(sender, chatId, { currentMenu: menu, ...extra });
  return { sender, chatId };
};

async function render(context, menu, heading, lines, transitionKey = menu, extra = {}) {
  const { sender, chatId } = adminContext(context, menu, extra);
  return sendMenu({ sock: context.sock, sender, chatId, text: buildMenu(heading, '', [...lines, '', back(languageOf(context))]), transitionKey });
}

export async function sendUserManagementMenu(context) {
  if (isMenuMigrated('user_management')) {
    const sender = context.sender;
    const chatId = context.chatId || sender;
    const user = await userService.getUserByJid(sender);
    const language = languageOf(context);
    await sendMenuById('user_management', { sock: context.sock, sender, chatId, user, language }, 'admin_to_users', { sessionMenu: 'admin_users' });
    return;
  }
  const language = languageOf(context);
  const users = await userService.getAllUsers();
  const blocked = blockService.getBlockedUsers();
  const testCount = users.filter((user) => user.isTest === true).length;
  return render(context, 'admin_users', `${t(language, 'admin.userManagement.title')}`, [
    `${L(language, 'admin.userManagement.total')}: ${users.length}`,
    `${L(language, 'admin.userManagement.blocked')}: ${blocked.length}`,
    `${L(language, 'admin.userManagement.test')}: ${testCount}`,
    '',
    `1. 🔍 ${L(language, 'admin.userManagement.search')}`,
    `2. 📄 ${L(language, 'admin.userManagement.list')}`,
    `3. ❌ ${L(language, 'admin.userManagement.delete')}`,
    `4. ⛔ ${L(language, 'admin.userManagement.block')}`,
    `5. ✅ ${L(language, 'admin.userManagement.unblock')}`,
    `6. 📋 ${L(language, 'admin.userManagement.listBlocked')}`,
    `7. 🗑️ ${L(language, 'admin.userManagement.purge')}`,
    `8. 🔧 ${L(language, 'admin.userManagement.advanced')}`,
    `9. 👥 ${L(language, 'admin.userManagement.bulk')}`,
    `10. 🎯 ${L(language, 'admin.userManagement.segments')}`
  ], 'admin_to_users');
}

const BULK_ACTIONS = [
  { number: '1', key: 'block', labelKey: 'admin.userManagement.bulkBlock' },
  { number: '2', key: 'unblock', labelKey: 'admin.userManagement.bulkUnblock' },
  { number: '3', key: 'message', labelKey: 'admin.userManagement.bulkMessage' },
  { number: '4', key: 'delete', labelKey: 'admin.userManagement.bulkDelete' }
];

const FILTER_OPTIONS = [
  { number: '1', key: 'language', labelKey: 'admin.userManagement.filterLanguage' },
  { number: '2', key: 'joinDays', labelKey: 'admin.userManagement.filterJoinDays' },
  { number: '3', key: 'lastDays', labelKey: 'admin.userManagement.filterLastDays' },
  { number: '4', key: 'test', labelKey: 'admin.userManagement.filterTest' },
  { number: '5', key: 'blocked', labelKey: 'admin.userManagement.filterBlocked' },
  { number: '6', key: 'all', labelKey: 'admin.userManagement.filterAll' }
];

async function prompt(context, menu, heading, text, extra = {}) {
  return render(context, menu, heading, [text], menu, extra);
}

function bulkActionLines(language) {
  return BULK_ACTIONS.map((a) => `${a.number}. ${t(language, a.labelKey)}`);
}

function buildFilterObject(filter, param) {
  if (filter === 'language') return { language: param };
  if (filter === 'joinDays') return { joinedWithinDays: parseInt(param, 10) };
  if (filter === 'lastDays') return { lastActiveWithinDays: parseInt(param, 10) };
  if (filter === 'test') return { testOnly: true };
  if (filter === 'blocked') return { blockedOnly: true };
  return {};
}

function describeFilter(language, filter, param) {
  const opt = FILTER_OPTIONS.find((f) => f.key === filter);
  const label = opt ? t(language, opt.labelKey) : filter;
  return param ? `${label}: ${param}` : label;
}

async function bulkMaybeMessage(context, pending) {
  const language = languageOf(context);
  if (pending.pendingBulkAction === 'message') {
    return prompt(context, 'user_management_bulk_message', `📢 ${t(language, 'admin.userManagement.bulkMessage')}`, t(language, 'admin.userManagement.bulkMessagePrompt'), pending);
  }
  return showBulkPreview(context, pending);
}

async function showBulkPreview(context, pending) {
  const language = languageOf(context);
  const users = userService.filterUsers(buildFilterObject(pending.pendingBulkFilter, pending.pendingBulkParam));
  const action = BULK_ACTIONS.find((a) => a.key === pending.pendingBulkAction);
  return render(context, 'user_management_bulk_preview', `👥 ${t(language, 'admin.userManagement.bulkPreview')}`, [
    `${L(language, 'admin.userManagement.bulkPreviewAction')}: ${action ? t(language, action.labelKey) : pending.pendingBulkAction}`,
    `${L(language, 'admin.userManagement.bulkPreviewFilter')}: ${describeFilter(language, pending.pendingBulkFilter, pending.pendingBulkParam)}`,
    `${L(language, 'admin.userManagement.bulkPreviewMatching')}: ${users.length}`,
    ...(pending.pendingBulkMessage ? [pending.pendingBulkMessage, ''] : []),
    `1. ✅ ${L(language, 'admin.userManagement.bulkConfirm')}`,
    `2. ❌ ${L(language, 'admin.userManagement.bulkCancel')}`
  ], 'user_management_bulk_preview', pending);
}

async function sendBulkMessages(context, users, text) {
  const language = languageOf(context);
  let sent = 0;
  for (let i = 0; i < users.length; i++) {
    const user = users[i];
    if (!user?.jid) continue;
    try {
      await context.sock.sendMessage(user.jid, { text });
      sent++;
    } catch { /* skip unreachable users */ }
    if (users.length > 20 && (i + 1) % 20 === 0) {
      await sendText(context.sock, context.sender, `${L(language, 'admin.userManagement.bulkProgress')}: ${i + 1}/${users.length}`);
    }
  }
  return sent;
}

async function executeBulkAction(context, pending) {
  const language = languageOf(context);
  const users = userService.filterUsers(buildFilterObject(pending.filter, pending.param));
  let done = 0;
  if (pending.action === 'message' && pending.message) {
    done = await sendBulkMessages(context, users, pending.message);
  } else if (pending.action === 'block') {
    for (const user of users) {
      if (!user?.jid) continue;
      blockService.blockUser(user.jid, 'bulk filter');
      done++;
    }
  } else if (pending.action === 'unblock') {
    for (const user of users) {
      if (!user?.jid) continue;
      blockService.unblockUser(user.jid);
      done++;
    }
  } else if (pending.action === 'delete') {
    for (const user of users) {
      if (!user?.jid) continue;
      await userService.deleteUser(user.jid);
      done++;
    }
  }
  logAdminAction(context.sender, 'bulk_' + (pending.action || 'unknown'), `${done}/${users.length} user(s)`);
  await sendText(context.sock, context.sender, `${L(language, 'admin.userManagement.bulkDone')}: ${done}/${users.length}`);
  return sendUserManagementMenu(context);
}

async function sendSegmentsMenu(context) {
  const language = languageOf(context);
  return render(context, 'user_management_segments', `🎯 ${t(language, 'admin.userManagement.segments')}`, [
    `1. 📋 ${L(language, 'admin.userManagement.segmentView')}`,
    `2. ➕ ${L(language, 'admin.userManagement.segmentCreate')}`,
    `3. 🗑️ ${L(language, 'admin.userManagement.segmentDelete')}`,
    `4. 📢 ${L(language, 'admin.userManagement.segmentBroadcast')}`
  ], 'user_management_segments', {});
}

async function showSegmentList(context, mode) {
  const language = languageOf(context);
  const { getSegments, getUsersInSegment } = await import('../services/segmentsService.js');
  const list = getSegments();
  const lines = [];
  for (let i = 0; i < list.length; i++) {
    const count = (await getUsersInSegment(list[i])).length;
    lines.push(`${i + 1}. ${list[i].name} (${count})`);
  }
  const target = mode === 'delete' ? 'user_management_segment_delete' : mode === 'broadcast' ? 'user_management_segment_broadcast' : 'user_management_segments';
  if (!lines.length) {
    await sendText(context.sock, context.sender, L(language, 'admin.userManagement.segmentEmpty'));
    return sendSegmentsMenu(context);
  }
  if (mode === 'view') {
    return render(context, 'user_management_segments', `🎯 ${t(language, 'admin.userManagement.segments')}`, lines, 'user_management_segments', {});
  }
  return render(context, target, `🎯 ${t(language, 'admin.userManagement.segments')}`, lines, target, {});
}

async function saveSegmentAndBack(context, pending) {
  const language = languageOf(context);
  const { createSegment, getUsersInSegment } = await import('../services/segmentsService.js');
  const seg = createSegment(pending.pendingSegmentName, buildFilterObject(pending.pendingSegmentFilter, pending.pendingSegmentParam));
  if (!seg) {
    await sendText(context.sock, context.sender, L(language, 'admin.userManagement.segmentNameEmpty'));
    return sendSegmentsMenu(context);
  }
  const count = (await getUsersInSegment(seg)).length;
  logAdminAction(context.sender, 'segment_create', `${seg.name} (${count} user(s))`);
  await sendText(context.sock, context.sender, `${L(language, 'admin.userManagement.segmentCreated')}: ${count}`);
  return sendSegmentsMenu(context);
}

function userDetails(language, user) {
  return [
    `🆔 ${L(language, 'admin.userManagement.id')}: ${user.jid}`,
    `📛 ${L(language, 'admin.userManagement.name')}: ${user.name || '-'}`,
    `👤 ${L(language, 'admin.userManagement.username')}: ${user.username ? '@' + user.username : '-'}`,
    `🌐 ${L(language, 'admin.userManagement.language')}: ${user.language || '-'}`,
    `🕒 ${L(language, 'admin.userManagement.timezone')}: ${user.timezone || '-'}`,
    `📅 ${L(language, 'admin.userManagement.joined')}: ${user.joined || '-'}`,
    `🔄 ${L(language, 'admin.userManagement.lastActive')}: ${user.lastActive || '-'}`,
    '',
    `1. ❌ ${L(language, 'admin.userManagement.delete')}`,
    `2. ⛔ ${L(language, 'admin.userManagement.block')}`,
    `3. ✅ ${L(language, 'admin.userManagement.unblock')}`,
    `4. 🔧 ${L(language, 'admin.userManagement.more')}`
  ];
}

async function showDetails(context, user) {
  const language = languageOf(context);
  return render(context, 'user_management_details', `👤 ${t(language, 'admin.userManagement.details')}`, userDetails(language, user), 'user_management_details', { targetUser: user.jid });
}

async function showUserList(context, page = 0) {
  const language = languageOf(context);
  const result = await userService.getAllUsersPaginated(page, PAGE_SIZE);
  const lines = result.users.map((user, index) => `${index + 1}. ${user.isTest ? '🧪 ' : ''}${user.name || '-'} (${user.username ? '@' + user.username : '-'}) - ${user.jid}`);
  if (result.page < result.totalPages - 1) lines.push(`11. ${L(language, 'common.next')}`);
  if (result.page > 0) lines.push(`12. ${L(language, 'common.previous')}`);
  return render(context, 'user_management_list', `📄 ${t(language, 'admin.userManagement.list')}`, lines, 'user_management_list', { userPage: result.page });
}

async function showBlockedList(context, page = 0) {
  const language = languageOf(context);
  const entries = blockService.getBlockedUsers();
  const start = page * PAGE_SIZE;
  const visible = entries.slice(start, start + PAGE_SIZE);
  const lines = visible.map((entry, index) => `${index + 1}. ${entry.jid} - ${entry.reason || '-'} - ${entry.timestamp || '-'}`);
  if (start + PAGE_SIZE < entries.length) lines.push(`11. ${L(language, 'common.next')}`);
  if (page > 0) lines.push(`12. ${L(language, 'common.previous')}`);
  return render(context, 'user_management_blocked_list', `📋 ${t(language, 'admin.userManagement.listBlocked')}`, lines, 'user_management_blocked_list', { blockedPage: page });
}

async function confirmAction(context, action, user, extra = {}) {
  const language = languageOf(context);
  const question = action === 'purge'
    ? t(language, 'admin.userManagement.purgeConfirm', extra)
    : t(language, 'admin.userManagement.deleteConfirm', { name: user.name || user.jid });
  return render(context, 'user_management_confirm', `❓ ${t(language, 'admin.userManagement.confirm')}`, [question, '', `1. ${L(language, 'admin.yes')}`, `2. ${L(language, 'admin.no')}`], 'user_management_confirm', { targetUser: user?.jid, pendingUserAction: action, ...extra });
}

export async function handleUserManagementReply(context, input) {
  const value = String(input || '').trim();
  const language = languageOf(context);
  const session = sessionManager.getSession(context.sender, context.chatId || context.sender) || {};
  const menu = session.currentMenu;

  if (menu === 'admin_users') {
    if (value === '0') return (await import('./adminCommand.js')).sendAdminPanel(context, { transitionKey: 'users_to_admin' });
    if (value === '1') return prompt(context, 'user_management_search_input', `🔍 ${t(language, 'admin.userManagement.search')}`, t(language, 'admin.userManagement.searchPrompt'));
    if (value === '2') return showUserList(context);
    if (value === '3') return prompt(context, 'user_management_delete_input', `❌ ${t(language, 'admin.userManagement.delete')}`, t(language, 'admin.userManagement.identifyPrompt'));
    if (value === '4') return prompt(context, 'user_management_block_input', `⛔ ${t(language, 'admin.userManagement.block')}`, t(language, 'admin.userManagement.identifyPrompt'));
    if (value === '5') return prompt(context, 'user_management_unblock_input', `✅ ${t(language, 'admin.userManagement.unblock')}`, t(language, 'admin.userManagement.identifyPrompt'));
    if (value === '6') return showBlockedList(context);
    if (value === '7') {
      const count = (await userService.getAllUsers()).filter((user) => user.isTest === true).length;
      if (!count) return sendText(context.sock, context.sender, L(language, 'admin.userManagement.noTestUsers'));
      return confirmAction(context, 'purge', null, { count });
    }
    if (value === '8') return render(context, 'user_management_advanced', `🔧 ${t(language, 'admin.userManagement.advancedTitle')}`, [
      `1. ✏️ ${L(language, 'admin.userManagement.edit')}`, `2. 📤 ${L(language, 'admin.userManagement.export')}`, `3. 🔄 ${L(language, 'admin.userManagement.reset')}`, `4. 📝 ${L(language, 'admin.userManagement.notes')}`, `5. 🔒 ${L(language, 'admin.userManagement.ban')}`, `6. 🕒 ${L(language, 'admin.userManagement.activity')}`, `7. 💬 ${L(language, 'admin.userManagement.message')}`, `8. 🧩 ${L(language, 'admin.userManagement.flags')}`, `9. 📅 ${L(language, 'admin.userManagement.sortFilter')}`
    ]);
    if (value === '9') return render(context, 'user_management_bulk', `👥 ${t(language, 'admin.userManagement.bulk')}`, bulkActionLines(language), 'user_management_bulk', {});
    if (value === '10') return sendSegmentsMenu(context);
    return sendUserManagementMenu(context);
  }

  if (menu === 'user_management_search_input' || menu === 'user_management_delete_input' || menu === 'user_management_block_input' || menu === 'user_management_unblock_input') {
    if (value === '0') return sendUserManagementMenu(context);
    const matches = await userService.searchUsers(value);
    const user = matches[0];
    if (!user) return sendText(context.sock, context.sender, L(language, 'admin.userManagement.noUserFound'));
    if (menu === 'user_management_search_input') return showDetails(context, user);
    if (menu === 'user_management_delete_input') return confirmAction(context, 'delete', user);
    if (menu === 'user_management_block_input') return prompt(context, 'user_management_reason_input', `⛔ ${t(language, 'admin.userManagement.reason')}`, t(language, 'admin.userManagement.reasonPrompt'), { targetUser: user.jid, pendingUserAction: 'block' });
    return confirmAction(context, 'unblock', user);
  }

  if (menu === 'user_management_reason_input') {
    if (value === '0') return sendUserManagementMenu(context);
    return confirmAction(context, 'block', { jid: session.targetUser, name: session.targetUser }, { reason: value });
  }

  if (menu === 'user_management_confirm') {
    if (value === '2' || value === '0') return sendUserManagementMenu(context);
    if (value !== '1') return confirmAction(context, session.pendingUserAction === 'purge' ? 'purge' : 'delete', { name: session.targetUser }, { count: session.count });
    if (session.pendingUserAction === 'purge') {
      const removed = await userService.purgeTestUsers();
      logAdminAction(context.sender, 'purge_test_users', String(removed.length));
      return sendUserManagementMenu(context);
    }
    if (session.pendingUserAction === 'delete') {
      await userService.deleteUser(session.targetUser); logAdminAction(context.sender, 'delete_user', session.targetUser); return sendUserManagementMenu(context);
    }
    if (session.pendingUserAction === 'block' || session.pendingUserAction === 'ban') {
      blockService.blockUser(session.targetUser, session.reason || '', session.pendingUserAction); await userService.updateUser(session.targetUser, { banned: session.pendingUserAction === 'ban' }); logAdminAction(context.sender, session.pendingUserAction + '_user', session.targetUser); return sendUserManagementMenu(context);
    }
    if (session.pendingUserAction === 'unblock') {
      blockService.unblockUser(session.targetUser); await userService.updateUser(session.targetUser, { banned: false }); logAdminAction(context.sender, 'unblock_user', session.targetUser); return sendUserManagementMenu(context);
    }
  }

  if (menu === 'user_management_list') {
    if (value === '0') return sendUserManagementMenu(context);
    const page = Number(session.userPage || 0);
    if (value === '11') return showUserList(context, page + 1);
    if (value === '12') return showUserList(context, page - 1);
    const result = await userService.getAllUsersPaginated(page, PAGE_SIZE);
    const user = result.users[Number(value) - 1];
    return user ? showDetails(context, user) : showUserList(context, page);
  }

  if (menu === 'user_management_blocked_list') {
    if (value === '0') return sendUserManagementMenu(context);
    const page = Number(session.blockedPage || 0);
    if (value === '11') return showBlockedList(context, page + 1);
    if (value === '12') return showBlockedList(context, page - 1);
    const user = blockService.getBlockedUsers()[page * PAGE_SIZE + Number(value) - 1];
    return user ? confirmAction(context, 'unblock', user) : showBlockedList(context, page);
  }

  if (menu === 'user_management_details') {
    if (value === '0') return sendUserManagementMenu(context);
    const user = await userService.getUserByJid(session.targetUser);
    if (!user) return sendUserManagementMenu(context);
    if (value === '1') return confirmAction(context, 'delete', user);
    if (value === '2') return confirmAction(context, 'block', user);
    if (value === '3') return confirmAction(context, 'unblock', user);
    return showDetails(context, user);
  }

  if (menu === 'user_management_advanced') {
    if (value === '0') return sendUserManagementMenu(context);
    if (/^[1-9]$/.test(value)) return prompt(context, 'user_management_advanced_input', `🔧 ${t(language, 'admin.userManagement.advancedTitle')}`, t(language, 'admin.userManagement.identifyPrompt'), { advancedAction: value });
    return render(context, menu, `🔧 ${t(language, 'admin.userManagement.advancedTitle')}`, []);
  }

  if (menu === 'user_management_bulk') {
    if (value === '0') return sendUserManagementMenu(context);
    const action = BULK_ACTIONS.find((a) => a.number === value);
    if (!action) return render(context, menu, `👥 ${t(language, 'admin.userManagement.bulk')}`, []);
    return render(context, 'user_management_bulk_filter', `👥 ${t(language, 'admin.userManagement.bulkFilter')}`, [
      t(language, 'admin.userManagement.bulkFilterPrompt'),
      '',
      ...FILTER_OPTIONS.map((f) => `${f.number}. ${t(language, f.labelKey)}`)
    ], 'user_management_bulk_filter', { pendingBulkAction: action.key });
  }

  if (menu === 'user_management_bulk_filter') {
    if (value === '0') return render(context, 'user_management_bulk', `👥 ${t(language, 'admin.userManagement.bulk')}`, bulkActionLines(language), 'user_management_bulk', { pendingBulkAction: session.pendingBulkAction });
    const filter = FILTER_OPTIONS.find((f) => f.number === value);
    if (!filter) return render(context, menu, `👥 ${t(language, 'admin.userManagement.bulkFilter')}`, []);
    const base = { pendingBulkAction: session.pendingBulkAction, pendingBulkFilter: filter.key };
    if (filter.key === 'language' || filter.key === 'joinDays' || filter.key === 'lastDays') {
      return prompt(context, 'user_management_bulk_param', `👥 ${t(language, 'admin.userManagement.bulkFilter')}`, t(language, filter.key === 'language' ? 'admin.userManagement.bulkParamLanguage' : 'admin.userManagement.bulkParamDays'), base);
    }
    return bulkMaybeMessage(context, { ...base });
  }

  if (menu === 'user_management_bulk_param') {
    if (value === '0') return render(context, 'user_management_bulk', `👥 ${t(language, 'admin.userManagement.bulk')}`, bulkActionLines(language), 'user_management_bulk', { pendingBulkAction: session.pendingBulkAction });
    const filter = session.pendingBulkFilter;
    if ((filter === 'joinDays' || filter === 'lastDays') && (!/^\d+$/.test(value) || parseInt(value, 10) <= 0)) {
      return sendText(context.sock, context.sender, L(language, 'admin.userManagement.bulkInvalidDays'));
    }
    if (filter === 'language' && !value) {
      return sendText(context.sock, context.sender, L(language, 'admin.userManagement.bulkInvalidLanguage'));
    }
    return bulkMaybeMessage(context, { pendingBulkAction: session.pendingBulkAction, pendingBulkFilter: filter, pendingBulkParam: value });
  }

  if (menu === 'user_management_bulk_message') {
    if (value === '0') return render(context, 'user_management_bulk', `👥 ${t(language, 'admin.userManagement.bulk')}`, bulkActionLines(language), 'user_management_bulk', { pendingBulkAction: session.pendingBulkAction });
    if (!value) return sendText(context.sock, context.sender, L(language, 'admin.userManagement.bulkEmptyMessage'));
    return showBulkPreview(context, { pendingBulkAction: session.pendingBulkAction, pendingBulkFilter: session.pendingBulkFilter, pendingBulkParam: session.pendingBulkParam, pendingBulkMessage: value });
  }

  if (menu === 'user_management_bulk_preview') {
    if (value === '0' || value === '2') return render(context, 'user_management_bulk', `👥 ${t(language, 'admin.userManagement.bulk')}`, bulkActionLines(language), 'user_management_bulk', { pendingBulkAction: session.pendingBulkAction });
    if (value !== '1') return render(context, menu, `👥 ${t(language, 'admin.userManagement.bulkPreview')}`, []);
    return executeBulkAction(context, {
      action: session.pendingBulkAction,
      filter: session.pendingBulkFilter,
      param: session.pendingBulkParam,
      message: session.pendingBulkMessage
    });
  }

  if (menu === 'user_management_segments') {
    if (value === '0') return sendUserManagementMenu(context);
    if (value === '1') return showSegmentList(context, 'view');
    if (value === '2') return prompt(context, 'user_management_segment_name', `🎯 ${t(language, 'admin.userManagement.segments')}`, t(language, 'admin.userManagement.segmentNamePrompt'));
    if (value === '3') return showSegmentList(context, 'delete');
    if (value === '4') return showSegmentList(context, 'broadcast');
    return sendSegmentsMenu(context);
  }

  if (menu === 'user_management_segment_name') {
    if (value === '0') return sendSegmentsMenu(context);
    if (!value) return sendText(context.sock, context.sender, L(language, 'admin.userManagement.segmentNameEmpty'));
    return render(context, 'user_management_segment_filter', `🎯 ${t(language, 'admin.userManagement.segments')}`, [
      t(language, 'admin.userManagement.bulkFilterPrompt'),
      '',
      ...FILTER_OPTIONS.map((f) => `${f.number}. ${t(language, f.labelKey)}`)
    ], 'user_management_segment_filter', { pendingSegmentName: value });
  }

  if (menu === 'user_management_segment_filter') {
    if (value === '0') return sendSegmentsMenu(context);
    const filter = FILTER_OPTIONS.find((f) => f.number === value);
    if (!filter) return render(context, menu, `🎯 ${t(language, 'admin.userManagement.segments')}`, []);
    const base = { pendingSegmentName: session.pendingSegmentName, pendingSegmentFilter: filter.key };
    if (filter.key === 'language' || filter.key === 'joinDays' || filter.key === 'lastDays') {
      return prompt(context, 'user_management_segment_param', `🎯 ${t(language, 'admin.userManagement.segments')}`, t(language, filter.key === 'language' ? 'admin.userManagement.bulkParamLanguage' : 'admin.userManagement.bulkParamDays'), base);
    }
    return saveSegmentAndBack(context, { ...base });
  }

  if (menu === 'user_management_segment_param') {
    if (value === '0') return sendSegmentsMenu(context);
    const filter = session.pendingSegmentFilter;
    if ((filter === 'joinDays' || filter === 'lastDays') && (!/^\d+$/.test(value) || parseInt(value, 10) <= 0)) {
      return sendText(context.sock, context.sender, L(language, 'admin.userManagement.bulkInvalidDays'));
    }
    return saveSegmentAndBack(context, { pendingSegmentName: session.pendingSegmentName, pendingSegmentFilter: filter, pendingSegmentParam: value });
  }

  if (menu === 'user_management_segment_delete') {
    if (value === '0') return sendSegmentsMenu(context);
    const { getSegments } = await import('../services/segmentsService.js');
    const list = getSegments();
    const seg = list[Number(value) - 1];
    if (!seg) return showSegmentList(context, 'delete');
    return render(context, 'user_management_segment_delete_confirm', `🗑️ ${t(language, 'admin.userManagement.segments')}`, [
      `${seg.name}`,
      '',
      `1. ${L(language, 'admin.yes')}`,
      `2. ${L(language, 'admin.no')}`
    ], 'user_management_segment_delete_confirm', { pendingSegmentId: seg.id });
  }

  if (menu === 'user_management_segment_delete_confirm') {
    if (value === '1' && session.pendingSegmentId) {
      const { deleteSegment } = await import('../services/segmentsService.js');
      deleteSegment(session.pendingSegmentId);
      logAdminAction(context.sender, 'segment_delete', session.pendingSegmentId);
    }
    return sendSegmentsMenu(context);
  }

  if (menu === 'user_management_segment_broadcast') {
    if (value === '0') return sendSegmentsMenu(context);
    const { getSegments } = await import('../services/segmentsService.js');
    const seg = getSegments()[Number(value) - 1];
    if (!seg) return showSegmentList(context, 'broadcast');
    return prompt(context, 'user_management_segment_msg', `📢 ${t(language, 'admin.userManagement.segments')}`, t(language, 'admin.userManagement.segmentMsgPrompt'), { pendingSegmentId: seg.id });
  }

  if (menu === 'user_management_segment_msg') {
    if (value === '0') return sendSegmentsMenu(context);
    if (!value) return sendText(context.sock, context.sender, L(language, 'admin.userManagement.bulkEmptyMessage'));
    return render(context, 'user_management_segment_confirm', `📢 ${t(language, 'admin.userManagement.segments')}`, [
      value,
      '',
      `1. ${L(language, 'admin.yes')}`,
      `2. ${L(language, 'admin.no')}`
    ], 'user_management_segment_confirm', { pendingSegmentId: session.pendingSegmentId, pendingSegmentMessage: value });
  }

  if (menu === 'user_management_segment_confirm') {
    if (value !== '1') return sendSegmentsMenu(context);
    const { getSegment, getUsersInSegment } = await import('../services/segmentsService.js');
    const seg = getSegment(session.pendingSegmentId);
    if (!seg) return sendSegmentsMenu(context);
    const users = await getUsersInSegment(seg);
    await sendBulkMessages(context, users, session.pendingSegmentMessage);
    logAdminAction(context.sender, 'segment_broadcast', `${seg.name} -> ${users.length} user(s)`);
    return sendSegmentsMenu(context);
  }

  if (menu === 'user_management_advanced_input') {
    if (value === '0') return sendUserManagementMenu(context);
    const user = (await userService.searchUsers(value))[0];
    if (!user) return sendText(context.sock, context.sender, L(language, 'admin.userManagement.noUserFound'));
    if (session.advancedAction === '2') {
      await context.sock.sendMessage(context.sender, { document: Buffer.from(JSON.stringify(user, null, 2)), mimetype: 'application/json', fileName: `user-${user.jid}.json` });
      logAdminAction(context.sender, 'export_user', user.jid);
      return sendUserManagementMenu(context);
    }
    if (session.advancedAction === '5') return confirmAction(context, 'ban', user);
    if (session.advancedAction === '6') return render(context, 'user_management_activity', `🕒 ${t(language, 'admin.userManagement.activity')}`, (await userService.getUserRecentActivity(user.jid)).map((entry, index) => `${index + 1}. ${entry.command} - ${entry.timestamp}`));
    return showDetails(context, user);
  }

  return sendUserManagementMenu(context);
}

export const command = {
  name: 'manageusers',
  description: 'Manage users',
  usage: '/manageusers',
  aliases: ['users'],
  adminOnly: true,
  groupAllowed: false,
  async execute(context) {
    const isAdmin = (config.adminJids || []).includes(context.sender);
    if (!isAdmin) return sendText(context.sock, context.sender, L(languageOf(context), 'admin.notAuthorized'));
    return sendUserManagementMenu(context);
  }
};
