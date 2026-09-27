import config from '../config/config.js';
import sessionManager from '../utils/sessionManager.js';
import { sendMenuById } from '../utils/menuSender.js';
import { registerCardResolver, registerBodyResolver } from '../utils/menuResolvers.js';
import { sendText } from '../services/messageService.js';
import { toSmallCaps } from '../utils/smallCaps.js';
import { t } from '../services/localeService.js';
import { buildMenu } from '../utils/menuBuilder.js';
import { sendMenu } from '../utils/messageHelper.js';
import {
  getUserByJid,
  getUserByJidSync,
  ensureUserProfile,
  updateUser,
  findUserByUsername,
  getCommandsThisWeek,
  getFavoriteCommand,
  getDaysSinceJoined,
  setNotifyRequest,
  trackFeatureUsage
} from '../services/userService.js';
import { getFeature, getFeatureLabel, getFeatureMessage, getEffectiveMarker, isFeatureEnabled } from '../services/featureFlagService.js';
import { menus, renderOptionLabel, resolveMenuOption } from '../config/menuConfig.js';
import * as conversationService from '../services/conversationService.js';
import * as chatNotifyService from '../services/chatNotifyService.js';
import { buildMessageSettingsStatus } from '../utils/messageSettingsStatus.js';
import { parseScheduleTime, parseRelativeTime } from './adminCommand.js';

const LANG_KEY_BY_CODE = {
  en: 'onboarding.languageEnglish',
  fr: 'onboarding.languageFrench',
  de: 'onboarding.languageGerman',
  es: 'onboarding.languageSpanish',
  ar: 'onboarding.languageArabic'
};

export function languageOf(sender) {
  const user = getUserByJidSync(sender);
  return user?.language || config.defaultLanguage;
}

// Show the unavailable feature submenu with Notify Me and Info options.
export async function featureBlockedReply(context, language, featureName, previousMenu = 'profile') {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const feat = getFeature(featureName);
  if (!feat || feat.status === 'available') return sendProfileView(context, language);

  const label = getFeatureLabel(language, featureName);
  const unavailable = getFeatureMessage(featureName, 'unavailable', language);
  const notifyOption = t(language, 'feature.notifyOption');
  const infoLabel = t(language, 'feature.infoLabel');

  sessionManager.setState(sender, chatId, {
    currentMenu: 'feature_unavailable',
    pendingNotifyFeature: featureName,
    previousMenu
  });

  const body = [
    unavailable,
    '',
    '1. 🔔 ' + notifyOption,
    '2. ℹ️ ' + infoLabel,
    '',
    '0. ' + t(language, 'profile.optionBack'),
    '',
    t(language, 'profile.replyPrompt')
  ];

  await sendMenu({
    sock: context.sock, sender, chatId,
    text: buildMenu(label, '', body),
    transitionKey: 'feature_unavailable'
  });
}

/** Show the feature notification toggle menu. */
async function featureNotifyToggle(context, language, featureName, previousMenu = 'profile') {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const notifyPrompt = getFeatureMessage(featureName, 'notifyPrompt', language);

  sessionManager.setState(sender, chatId, {
    currentMenu: 'feature_notify_toggle',
    pendingNotifyFeature: featureName,
    previousMenu
  });

  const body = [
    notifyPrompt,
    '',
    '1. ✅ ' + t(language, 'feature.notifyEnableOption'),
    '2. ❌ ' + t(language, 'feature.notifyDisableOption'),
    '',
    '3. ' + t(language, 'profile.optionBack'),
    '',
    t(language, 'profile.replyPrompt')
  ];

  await sendMenu({
    sock: context.sock, sender, chatId,
    text: buildMenu('🔔 ' + t(language, 'feature.notifyTitle'), '', body),
    transitionKey: 'feature_notify_toggle'
  });
}

async function featureNotifyResult(context, language, featureName, previousMenu, message, showOptions) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  sessionManager.setState(sender, chatId, {
    currentMenu: 'feature_notify_result',
    pendingNotifyFeature: featureName,
    previousMenu
  });

  const body = ['', message, ''];
  if (showOptions) {
    body.push(
      '1. ✅ ' + t(language, 'feature.notifyEnableOption'),
      '2. ❌ ' + t(language, 'feature.notifyDisableOption'),
      ''
    );
  }
  body.push('0. ' + t(language, 'profile.optionBack'));
  if (showOptions) body.push('', t(language, 'profile.replyPrompt'));

  await sendMenu({
    sock: context.sock, sender, chatId,
    text: buildMenu('🔔 ' + t(language, 'feature.notifyTitle'), '', body),
    transitionKey: 'feature_notify_result'
  });
}

/** Show feature info message. */
async function featureShowInfo(context, language, featureName, previousMenu = 'profile') {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const feat = getFeature(featureName);
  const label = getFeatureLabel(language, featureName);
  const info = getFeatureMessage(featureName, 'info', language);

  sessionManager.setState(sender, chatId, {
    currentMenu: 'feature_info',
    pendingNotifyFeature: featureName,
    previousMenu
  });

  const body = [
    '',
    info,
    '',
    '0. ' + t(language, 'profile.optionBack'),
    '',
    t(language, 'profile.replyPrompt')
  ];

  await sendMenu({
    sock: context.sock, sender, chatId,
    text: buildMenu(label, '', body),
    transitionKey: 'feature_info'
  });
}

/** Human-friendly elapsed time (e.g. "3 hours ago"), localized, small-capped by caller. */
export function relativeTime(iso) {
  if (!iso) return null;
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 0 || ms < 60000) return { key: 'common.timeJustNow' };
  const minutes = Math.floor(ms / 60000);
  if (minutes < 60) {
    return minutes === 1
      ? { key: 'common.timeMinuteAgo' }
      : { key: 'common.timeMinutesAgo', params: { n: minutes } };
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return hours === 1
      ? { key: 'common.timeHourAgo' }
      : { key: 'common.timeHoursAgo', params: { n: hours } };
  }
  const days = Math.floor(hours / 24);
  if (days < 7) {
    return days === 1
      ? { key: 'common.timeDayAgo' }
      : { key: 'common.timeDaysAgo', params: { n: days } };
  }
  const weeks = Math.floor(days / 7);
  if (weeks < 5) {
    return weeks === 1
      ? { key: 'common.timeWeekAgo' }
      : { key: 'common.timeWeeksAgo', params: { n: weeks } };
  }
  const months = Math.floor(days / 30);
  if (months < 12) {
    return months === 1
      ? { key: 'common.timeMonthAgo' }
      : { key: 'common.timeMonthsAgo', params: { n: months } };
  }
  const years = Math.floor(days / 365);
  return years === 1
    ? { key: 'common.timeYearAgo' }
    : { key: 'common.timeYearsAgo', params: { n: years } };
}

function relativeLabel(language, iso) {
  const res = relativeTime(iso);
  if (!res) return '';
  return toSmallCaps(t(language, res.key, res.params || {}));
}

function languageLabel(code) {
  const key = LANG_KEY_BY_CODE[code] || LANG_KEY_BY_CODE[config.defaultLanguage];
  return t(code, key);
}

// ---------------------------------------------------------------------------
// New-renderer resolvers + senders (Phase 4). Card/body lines are verbatim
// copies of the legacy bodies (minus options/back/footer, which the renderer
// owns) so output stays byte-identical.
// ---------------------------------------------------------------------------

function profileCardLines(language, user, sender) {
  const langLabel = languageLabel(user?.language || language);
  const localeMap = { en: 'en-US', fr: 'fr-FR', de: 'de-DE', es: 'es-ES', ar: 'ar-SA' };
  const userLang = user?.language || language;
  const locale = localeMap[userLang] || 'en-US';
  const joined = user?.joined
    ? new Date(user.joined).toLocaleDateString(locale)
    : t(language, 'profile.notAvailable');
  return [
    ...(buildMessageSettingsStatus(language, user) ? [buildMessageSettingsStatus(language, user), ''] : []),
    { static: '👤 *' + toSmallCaps(t(language, 'profile.name')) + '*: ', dynamic: (user?.name || t(language, 'profile.notSet')) },
    { static: '🆔 *' + toSmallCaps(t(language, 'profile.id')) + ':* ', dynamic: (sender || '') },
    { static: '🌟 *' + toSmallCaps(t(language, 'profile.username')) + '*: ', dynamic: (user?.username ? `@${user.username}` : t(language, 'profile.notSet')) },
    '🌐 *' + toSmallCaps(t(language, 'profile.language')) + '*: ' + langLabel,
    '📅 *' + toSmallCaps(t(language, 'profile.joined')) + '*: ' + joined,
    '🕒 *' + toSmallCaps(t(language, 'profile.lastActive')) + '*: ' + relativeLabel(language, user?.lastActive),
    '💾 *' + toSmallCaps(t(language, 'profile.lastUpdated')) + '*: ' + relativeLabel(language, user?.lastUpdated),
    ''
  ];
}

function myStatsBodyLines(language, user) {
  const stats = user?.stats || {};
  const favorite = getFavoriteCommand(user);
  const lastRel = relativeLabel(language, stats.lastCommandTime);
  return [
    { static: '📩 *' + toSmallCaps(t(language, 'stats.messagesSent')) + '*: ', dynamic: String(stats.messagesSent || 0) },
    { static: '🤖 *' + toSmallCaps(t(language, 'stats.commandsUsed')) + '*: ', dynamic: String(stats.commandsUsed || 0) },
    { static: '📈 *' + toSmallCaps(t(language, 'stats.commandsThisWeek')) + '*: ', dynamic: String(getCommandsThisWeek(user)) },
    { static: '💬 *' + toSmallCaps(t(language, 'stats.favoriteCommand')) + '*: ', dynamic: (favorite || t(language, 'stats.none')) },
    { static: '🕒 *' + toSmallCaps(t(language, 'stats.lastCommand')) + ':* ', dynamic: ((stats.lastCommand || t(language, 'stats.none')) + (lastRel ? ` (${lastRel})` : '')) },
    { static: '📅 *' + toSmallCaps(t(language, 'stats.daysSinceJoined')) + '*: ', dynamic: String(getDaysSinceJoined(user)) },
    { static: '', dynamic: '' },
    '0. ' + t(language, 'stats.back'),
    '',
    t(language, 'stats.replyPrompt')
  ];
}

registerCardResolver('profileCard', async (user, language, ctx) => profileCardLines(language, user, ctx?.sender || user?.jid || ''));
registerBodyResolver('myStatsBody', async (user, language) => myStatsBodyLines(language, user));

// Build the main profile view (currentMenu: 'profile').
async function sendProfileView(context, language) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  await trackFeatureUsage(sender, 'profile');
  const user = await getUserByJid(sender);
  await sendMenuById('profile', { sock: context.sock, sender, chatId, user, language }, 'profile_submenu', { sessionMenu: 'profile' });
}

// Edit submenu (currentMenu: 'profile_edit').
function profileEditOptionLine(language, number, option, showMarker) {
  const label = t(language, option.labelKey);
  const prefix = option.prefix ? toSmallCaps(option.prefix) + ' ' : '';
  const marker = showMarker ? getEffectiveMarker(option.markerFromFeature) : '';
  return number + '. ' + prefix + label + (marker ? ' ' + marker : '');
}

async function sendEditSubmenu(context, language) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  await trackFeatureUsage(sender, 'profileEditing');
  const user = await getUserByJid(sender);
  await sendMenuById('edit_profile', { sock: context.sock, sender, chatId, user, language }, 'profile_edit', { sessionMenu: 'profile_edit' });
}

export async function sendEditAdvancedSubmenu(context, language) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const unavailable = menus.profile_edit.options.filter((option) => getFeature(option.markerFromFeature)?.status !== 'available');
  const body = [
    t(language, 'profile.replyPrompt'),
    '',
    ...unavailable.map((option, index) => profileEditOptionLine(language, String(index + 1), option, true)),
    '',
    '0. ' + toSmallCaps(t(language, 'profile.optionBack')),
    '',
    t(language, 'preferences.advancedReplyPrompt')
  ];

  sessionManager.setState(sender, chatId, { currentMenu: 'profile_edit_advanced' });
  await sendMenu({
    sock: context.sock, sender, chatId,
    text: buildMenu(t(language, 'profile.editTitle'), '', [
      '*🔒 ' + t(language, 'preferences.advancedOptions') + '*',
      '',
      ...body.slice(2)
    ]),
    transitionKey: 'profile_edit_advanced'
  });
}

// Ask for a new value (name or username). currentMenu = profile_name_input / profile_username_input.
async function promptField(context, language, field) {
  const sender = context.sender;
  const chatId = context.chatId || sender;

  sessionManager.setState(sender, chatId, {
    currentMenu: field === 'name' ? 'profile_name_input' : 'profile_username_input',
    pendingField: field
  });

  const promptKey = field === 'name' ? 'profile.namePrompt' : 'profile.usernamePrompt';
  const body = [
    t(language, promptKey),
    '',
    '0. ' + t(language, 'profile.optionBack'),
    ''
  ];

  await sendMenu({
    sock: context.sock, sender, chatId,
    text: buildMenu(
      field === 'name' ? t(language, 'profile.changeNameHeading') : t(language, 'profile.changeUsernameHeading'),
      '',
      body
    ),
    transitionKey: field === 'name' ? 'profile_name_input' : 'profile_username_input'
  });
}

// Ask Yes/No for a pending edit. currentMenu = 'profile_confirmation'.
async function promptConfirmation(context, language, field, value) {
  const sender = context.sender;
  const chatId = context.chatId || sender;

  sessionManager.setState(sender, chatId, {
    currentMenu: 'profile_confirmation',
    pendingField: field,
    pendingValue: value
  });

  const questionKey = field === 'name' ? 'profile.confirmNameQuestion' : 'profile.confirmUsernameQuestion';
  const body = [
    t(language, questionKey),
    { static: '> ', dynamic: value },
    '',
    '1. ' + t(language, 'profile.confirmYes'),
    '2. ' + t(language, 'profile.confirmNo'),
    '',
    t(language, 'profile.confirmPrompt')
  ];

  await sendMenu({
    sock: context.sock, sender, chatId,
    text: buildMenu(
      field === 'name' ? t(language, 'profile.changeNameHeading') : t(language, 'profile.changeUsernameHeading'),
      '',
      body
    ),
    transitionKey: 'profile_confirmation'
  });
}

// Confirmation reached "Yes": persist the edit, confirm success, return to edit submenu.
async function confirmSuccess(context, language, field, value) {
  const sender = context.sender;
  const chatId = context.chatId || sender;

  const updates = field === 'name' ? { name: value } : { username: value };
  await updateUser(sender, updates);

  const successKey = field === 'name' ? 'profile.nameSuccess' : 'profile.usernameSuccess';
  const body = [
    t(language, successKey),
    '',
    '0. ' + t(language, 'profile.optionBack'),
    ''
  ];

  sessionManager.setState(sender, chatId, { currentMenu: 'profile_edit' });
  await sendMenu({
    sock: context.sock, sender, chatId,
    text: buildMenu(t(language, 'profile.editTitle'), '', body),
    transitionKey: 'profile_confirmation_done'
  });
}

// "My Statistics" submenu (currentMenu: 'stats'). Shown from profile option 2.
async function sendStatsView(context, language) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  await trackFeatureUsage(sender, 'statistics');
  const user = await getUserByJid(sender);
  await sendMenuById('my_stats', { sock: context.sock, sender, chatId, user, language }, 'stats_submenu', { sessionMenu: 'stats' });
}

// ---------------------------------------------------------------------------
// Preferences submenu
// ---------------------------------------------------------------------------

const PREF_LANG_CODES = ['en', 'fr', 'de', 'es', 'ar'];
const LANG_LABEL_KEY = {
  en: 'preferences.languageEnglish',
  fr: 'preferences.languageFrench',
  de: 'preferences.languageGerman',
  es: 'preferences.languageSpanish',
  ar: 'preferences.languageArabic'
};

export const PREFERENCE_FEATURE_OPTIONS = [
  ['1', 'preferences.languageSelection', 'languageSelection'],
  ['2', 'preferences.notifications', 'notifications'],
  ['3', 'preferences.announcements', 'announcements'],
  ['4', 'preferences.messageSettings', 'messageSettings'],
  ['5', 'preferences.inlineHelp', 'inlineHelp'],
  ['6', 'preferences.replyStyle', 'replyStyle'],
  ['7', 'preferences.responseDelay', 'responseDelay'],
  ['8', 'preferences.replyEmojis', 'replyEmojis'],
  ['9', 'preferences.progressBars', 'progressBars'],
  ['10', 'preferences.textStyle', 'textStyle'],
  ['11', 'preferences.dailyDigest', 'dailyDigest'],
  ['12', 'preferences.timezoneAutoDetect', 'timezoneAutoDetect'],
  ['13', 'preferences.privacy', 'privacy'],
  ['14', 'preferences.greetingResponse', 'greetingResponse', '👋'],
  ['15', 'preferences.typingIndicator', 'typingIndicator', '⌨️'],
  ['16', 'preferences.helpPrompt', 'helpPrompt', '❓'],
  ['17', 'preferences.friendlyTone', 'friendlyTone', '😊']
];

function prefLangLabel(code) {
  return t(code, LANG_LABEL_KEY[code] || LANG_LABEL_KEY.en);
}

function preferenceLabel(language, featureId) {
  const feature = getFeature(featureId);
  const label = t(language, `preferences.${featureId}`);
  const prefix = feature?.prefix || '';
  return prefix && label.startsWith(prefix) ? label.slice(prefix.length).trimStart() : label;
}

function preferenceOptionLine(language, number, labelKey, featureId, showMarker = true, prefs = {}) {
  const feature = getFeature(featureId);
  const label = preferenceLabel(language, featureId);
  const marker = showMarker ? getEffectiveMarker(featureId) : '';
  const state = featureId === 'notifications'
    ? ': ' + toSmallCaps(prefs.notifications ? t(language, 'common.onFlag') : t(language, 'common.offFlag'))
    : featureId === 'announcements'
      ? ': ' + toSmallCaps(prefs.announcements ? t(language, 'common.onFlag') : t(language, 'common.offFlag'))
      : '';
  return number + '. ' + (feature?.prefix ? feature.prefix + ' ' : '') + label + state + (marker ? ' ' + marker : '');
}

// Main preferences view (currentMenu: 'preferences').
async function sendPreferencesView(context, language) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  await trackFeatureUsage(sender, 'preferences');
  const user = await getUserByJid(sender);
  await sendMenuById('preferences', { sock: context.sock, sender, chatId, user, language }, 'preferences_submenu', { sessionMenu: 'preferences' });
}

export async function sendAdvancedPreferencesView(context, language) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const unavailable = PREFERENCE_FEATURE_OPTIONS.filter(([, , featureId]) => getFeature(featureId)?.status !== 'available');
  const body = [
    ...unavailable.map(([, labelKey, featureId], index) => preferenceOptionLine(language, String(index + 1), labelKey, featureId, true)),
    { static: '', dynamic: '' },
    '0. ' + t(language, 'preferences.back'),
    '',
    t(language, 'preferences.languagePrompt')
  ];

  sessionManager.setState(sender, chatId, { currentMenu: 'pref_advanced' });
  await sendMenu({
    sock: context.sock, sender, chatId,
    text: buildMenu(t(language, 'preferences.title'), '', [
      '> *📂 ' + t(language, 'preferences.advancedOptions') + '*',
      '',
      ...body
    ]),
    transitionKey: 'preferences_advanced'
  });
}

// ---------------------------------------------------------------------------
// Typing indicator preferences (currentMenu: 'pref_typing*').
// ---------------------------------------------------------------------------

async function getTypingPrefs(sender) {
  const { sanitizeUserTyping } = await import('../services/typingSettingsService.js');
  const user = await getUserByJid(sender);
  return { user, typing: sanitizeUserTyping(user?.preferences?.typing) };
}

async function getTypingAdmin() {
  const { getTypingSettings } = await import('../services/typingSettingsService.js');
  return getTypingSettings();
}

async function saveTypingPrefs(sender, patch) {
  const { sanitizeUserTyping } = await import('../services/typingSettingsService.js');
  const user = await getUserByJid(sender);
  const cur = sanitizeUserTyping(user?.preferences?.typing);
  const next = sanitizeUserTyping({
    ...cur,
    ...patch,
    targeting: { ...cur.targeting, ...((patch && patch.targeting) || {}) }
  });
  await updateUser(sender, { preferences: { ...(user?.preferences || {}), typing: next } });
  return next;
}

function typingReturnMenu(context) {
  const session = sessionManager.getSession(context.sender, context.chatId || context.sender) || {};
  return session.typingReturnMenu === 'pref_advanced' ? 'pref_advanced' : 'preferences';
}

async function backToTypingReturn(context, language) {
  if (typingReturnMenu(context) === 'pref_advanced') return sendAdvancedPreferencesView(context, language);
  return sendPreferencesView(context, language);
}

export async function sendTypingMenu(context, language, returnMenu = 'preferences') {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const { typing } = await getTypingPrefs(sender);
  const admin = await getTypingAdmin();
  const locked = admin.allowUserOverride !== true;
  const lock = (label) => (locked ? '🔒 ' + label : label);
  sessionManager.setState(sender, chatId, { currentMenu: 'pref_typing', typingReturnMenu: returnMenu });
  const text = buildMenu(
    t(language, 'typing.title'),
    '',
    [
      { static: toSmallCaps(t(language, 'typing.currentMode')) + ': ', dynamic: toSmallCaps(t(language, `typing.mode_${typing.mode}`)) },
      { static: toSmallCaps(t(language, 'typing.currentDelay')) + ': ', dynamic: `${typing.delayMs}ms` },
      { static: toSmallCaps(t(language, 'typing.currentType')) + ': ', dynamic: toSmallCaps(t(language, `typing.type_${typing.typingType}`)) },
      { static: toSmallCaps(t(language, 'typing.currentReceipts')) + ': ', dynamic: toSmallCaps(typing.readReceipts ? t(language, 'common.onFlag') : t(language, 'common.offFlag')) },
      '',
      '1. ' + lock('🔛 ' + toSmallCaps(t(language, 'typing.optMode'))),
      '2. ' + lock('⏱️ ' + toSmallCaps(t(language, 'typing.optDelay'))),
      '3. ' + lock('🎙️ ' + toSmallCaps(t(language, 'typing.optType'))),
      '4. ' + lock('✅ ' + toSmallCaps(t(language, 'typing.optReceipts'))),
      '5. ' + lock('🎛️ ' + toSmallCaps(t(language, 'typing.optAdvanced'))),
      '6. 🧪 ' + toSmallCaps(t(language, 'typing.optTest')),
      '',
      '0. ' + t(language, 'preferences.back')
    ]
  );
  return sendMenu({ sock: context.sock, sender, chatId, text, transitionKey: 'pref_typing' });
}

async function sendTypingLocked(context, language) {
  await sendText(context.sock, context.sender, toSmallCaps(t(language, 'typing.lockedMessage')), { type: 'error' });
  return sendTypingMenu(context, language, typingReturnMenu(context));
}

export async function handleTypingMenuReply(context, language, input) {
  const sender = context.sender;
  const admin = await getTypingAdmin();
  const locked = admin.allowUserOverride !== true;
  const trimmed = String(input || '').trim();
  if (trimmed === '0') return backToTypingReturn(context, language);
  if (trimmed === '6') {
    const { sendText: text } = await import('../services/messageService.js');
    await text(context.sock, sender, t(language, 'typing.testMessage'), { type: 'chatReply' });
    return sendTypingMenu(context, language, typingReturnMenu(context));
  }
  if (!['1', '2', '3', '4', '5'].includes(trimmed)) {
    await sendText(context.sock, sender, toSmallCaps(t(language, 'common.invalidChoiceMinMax', { min: 0, max: 6 })), { type: 'error' });
    return sendTypingMenu(context, language, typingReturnMenu(context));
  }
  if (locked) return sendTypingLocked(context, language);
  if (trimmed === '1') return sendTypingModeMenu(context, language);
  if (trimmed === '2') return sendTypingDelayMenu(context, language);
  if (trimmed === '3') return sendTypingTypeMenu(context, language);
  if (trimmed === '4') {
    const { typing } = await getTypingPrefs(sender);
    await saveTypingPrefs(sender, { readReceipts: !typing.readReceipts });
    return sendTypingMenu(context, language, typingReturnMenu(context));
  }
  return sendTypingAdvancedMenu(context, language);
}

async function sendTypingModeMenu(context, language) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  sessionManager.setState(sender, chatId, { currentMenu: 'pref_typing_mode' });
  const text = buildMenu(
    t(language, 'typing.modeTitle'),
    '',
    [
      '1. ✅ ' + toSmallCaps(t(language, 'typing.mode_on')),
      '2. 🔕 ' + toSmallCaps(t(language, 'typing.mode_off')),
      '3. ⚡ ' + toSmallCaps(t(language, 'typing.mode_instant')),
      '4. 🎯 ' + toSmallCaps(t(language, 'typing.mode_adaptive')),
      '',
      '0. ' + t(language, 'preferences.back')
    ]
  );
  return sendMenu({ sock: context.sock, sender, chatId, text, transitionKey: 'pref_typing_mode' });
}

export async function handleTypingModeReply(context, language, input) {
  const trimmed = String(input || '').trim();
  if (trimmed === '0') return sendTypingMenu(context, language, typingReturnMenu(context));
  const modes = { 1: 'on', 2: 'off', 3: 'instant', 4: 'adaptive' };
  if (!modes[trimmed]) {
    await sendText(context.sock, context.sender, toSmallCaps(t(language, 'common.invalidChoiceMinMax', { min: 0, max: 4 })), { type: 'error' });
    return sendTypingModeMenu(context, language);
  }
  await saveTypingPrefs(context.sender, { mode: modes[trimmed] });
  return sendTypingMenu(context, language, typingReturnMenu(context));
}

async function sendTypingDelayMenu(context, language) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  sessionManager.setState(sender, chatId, { currentMenu: 'pref_typing_delay' });
  const text = buildMenu(
    t(language, 'typing.delayTitle'),
    '',
    [
      '1. ' + toSmallCaps(t(language, 'typing.delay_instant')),
      '2. ' + toSmallCaps(t(language, 'typing.delay_fast')),
      '3. ' + toSmallCaps(t(language, 'typing.delay_natural')),
      '4. ' + toSmallCaps(t(language, 'typing.delay_slow')),
      '5. ' + toSmallCaps(t(language, 'typing.delay_custom')),
      '',
      '0. ' + t(language, 'preferences.back')
    ]
  );
  return sendMenu({ sock: context.sock, sender, chatId, text, transitionKey: 'pref_typing_delay' });
}

export async function handleTypingDelayReply(context, language, input) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const trimmed = String(input || '').trim();
  if (trimmed === '0') return sendTypingMenu(context, language, typingReturnMenu(context));
  const presets = { 1: 0, 2: 300, 3: 600, 4: 1000 };
  if (presets[trimmed] !== undefined) {
    // 0ms means instant-feel fixed delay; clamp keeps >=100 for stored value,
    // so instant preset maps to the minimum.
    await saveTypingPrefs(sender, { delayMs: presets[trimmed] === 0 ? 100 : presets[trimmed] });
    return sendTypingMenu(context, language, typingReturnMenu(context));
  }
  if (trimmed === '5') {
    sessionManager.setState(sender, chatId, { currentMenu: 'pref_typing_delay_custom' });
    const text = buildMenu(t(language, 'typing.delayTitle'), '', [
      toSmallCaps(t(language, 'typing.delayCustomPrompt')),
      '',
      '0. ' + t(language, 'preferences.back')
    ]);
    return sendMenu({ sock: context.sock, sender, chatId, text, transitionKey: 'pref_typing_delay_custom' });
  }
  await sendText(context.sock, sender, toSmallCaps(t(language, 'common.invalidChoiceMinMax', { min: 0, max: 5 })), { type: 'error' });
  return sendTypingDelayMenu(context, language);
}

export async function handleTypingDelayCustomReply(context, language, input) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const trimmed = String(input || '').trim();
  if (trimmed === '0') return sendTypingDelayMenu(context, language);
  const n = Math.floor(Number(trimmed));
  if (!trimmed || Number.isNaN(n) || n < 100 || n > 3000) {
    await sendText(context.sock, sender, toSmallCaps(t(language, 'common.invalidChoiceMinMax', { min: 100, max: 3000 })), { type: 'error' });
    sessionManager.setState(sender, chatId, { currentMenu: 'pref_typing_delay_custom' });
    const text = buildMenu(t(language, 'typing.delayTitle'), '', [
      toSmallCaps(t(language, 'typing.delayCustomPrompt')),
      '',
      '0. ' + t(language, 'preferences.back')
    ]);
    return sendMenu({ sock: context.sock, sender, chatId, text, transitionKey: 'pref_typing_delay_custom' });
  }
  await saveTypingPrefs(sender, { delayMs: n });
  return sendTypingMenu(context, language, typingReturnMenu(context));
}

async function sendTypingTypeMenu(context, language) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  sessionManager.setState(sender, chatId, { currentMenu: 'pref_typing_type' });
  const text = buildMenu(
    t(language, 'typing.typeTitle'),
    '',
    [
      '1. ⌨️ ' + toSmallCaps(t(language, 'typing.type_composing')),
      '2. 🎙️ ' + toSmallCaps(t(language, 'typing.type_recording')),
      '',
      '0. ' + t(language, 'preferences.back')
    ]
  );
  return sendMenu({ sock: context.sock, sender, chatId, text, transitionKey: 'pref_typing_type' });
}

export async function handleTypingTypeReply(context, language, input) {
  const trimmed = String(input || '').trim();
  if (trimmed === '0') return sendTypingMenu(context, language, typingReturnMenu(context));
  if (trimmed !== '1' && trimmed !== '2') {
    await sendText(context.sock, context.sender, toSmallCaps(t(language, 'common.invalidChoiceMinMax', { min: 0, max: 2 })), { type: 'error' });
    return sendTypingTypeMenu(context, language);
  }
  await saveTypingPrefs(context.sender, { typingType: trimmed === '2' ? 'recording' : 'composing' });
  return sendTypingMenu(context, language, typingReturnMenu(context));
}

const TYPING_TARGET_KEYS = ['mainMenu', 'submenuTransitions', 'chatReplies', 'confirmations', 'errors'];

async function sendTypingAdvancedMenu(context, language) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const { typing } = await getTypingPrefs(sender);
  sessionManager.setState(sender, chatId, { currentMenu: 'pref_typing_advanced' });
  const onOff = (v) => toSmallCaps(v ? t(language, 'common.onFlag') : t(language, 'common.offFlag'));
  const rows = [
    ['🏠', 'typing.target_mainMenu', typing.targeting.mainMenu],
    ['📂', 'typing.target_submenu', typing.targeting.submenuTransitions],
    ['💬', 'typing.target_chat', typing.targeting.chatReplies],
    ['✅', 'typing.target_confirm', typing.targeting.confirmations],
    ['⚠️', 'typing.target_errors', typing.targeting.errors]
  ];
  const text = buildMenu(
    t(language, 'typing.advancedTitle'),
    '',
    [
      ...rows.map(([emoji, key, val], i) => `${i + 1}. ${emoji} ` + toSmallCaps(t(language, key)) + ': ' + onOff(val)),
      '',
      '6. 🎯 ' + toSmallCaps(t(language, 'typing.preset_natural')),
      '7. 🎯 ' + toSmallCaps(t(language, 'typing.preset_minimal')),
      '8. 🎯 ' + toSmallCaps(t(language, 'typing.preset_silent')),
      '',
      '0. ' + t(language, 'preferences.back')
    ]
  );
  return sendMenu({ sock: context.sock, sender, chatId, text, transitionKey: 'pref_typing_advanced' });
}

export async function handleTypingAdvancedReply(context, language, input) {
  const sender = context.sender;
  const trimmed = String(input || '').trim();
  if (trimmed === '0') return sendTypingMenu(context, language, typingReturnMenu(context));
  if (['6', '7', '8'].includes(trimmed)) {
    const { typingPreset } = await import('../services/typingSettingsService.js');
    const preset = typingPreset(trimmed === '6' ? 'natural' : trimmed === '7' ? 'minimal' : 'silent');
    // Map admin-style preset keys to user-style targeting keys.
    await saveTypingPrefs(sender, {
      targeting: {
        mainMenu: preset.mainMenu,
        submenuTransitions: preset.submenuTransition,
        chatReplies: preset.chatReply,
        confirmations: preset.confirmation,
        errors: preset.error
      }
    });
    return sendTypingAdvancedMenu(context, language);
  }
  const idx = Number(trimmed) - 1;
  if (!TYPING_TARGET_KEYS[idx]) {
    await sendText(context.sock, sender, toSmallCaps(t(language, 'common.invalidChoiceMinMax', { min: 0, max: 8 })), { type: 'error' });
    return sendTypingAdvancedMenu(context, language);
  }
  const key = TYPING_TARGET_KEYS[idx];
  const { typing } = await getTypingPrefs(sender);
  await saveTypingPrefs(sender, { targeting: { [key]: !typing.targeting[key] } });
  return sendTypingAdvancedMenu(context, language);
}

// Language selection submenu (currentMenu: 'pref_language_selection').
// `messageKey` optionally prepends an info line (e.g. "already set").
export async function sendLanguageSelection(context, language, opts = {}) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const user = await getUserByJid(sender);
  const currentLang = user?.language || language;
  const existingSession = sessionManager.getSession(sender, chatId) || {};
  const previousMenu = opts.previousMenu || existingSession.languageReturnMenu || 'preferences';

  const body = [];
  if (opts.headingLine) {
    body.push({ static: '', dynamic: '' });
    body.push('*' + toSmallCaps(opts.headingLine) + '*');
    body.push('');
  }
  if (opts.hintLine) {
    body.push(toSmallCaps(opts.hintLine));
    body.push('');
  }

  PREF_LANG_CODES.forEach((code, i) => {
    const active = code === currentLang;
    const label = `${i + 1}. ${prefLangLabel(code)}`;
    body.push(active ? '*' + label + ' ✅*' : label);
  });
  body.push('');
  body.push('0. ' + t(language, 'preferences.back'));
  body.push('');
  body.push(t(language, 'preferences.languagePrompt'));

  sessionManager.setState(sender, chatId, {
    currentMenu: 'pref_language_selection',
    pendingLang: null,
    languageReturnMenu: previousMenu
  });

  await sendMenu({
    sock: context.sock, sender, chatId,
    text: buildMenu(t(language, 'preferences.langSelectionTitle'), '', body),
    transitionKey: opts.transitionKey || (opts.done ? 'preferences_language_done' : 'preferences_language_back')
  });
}

async function returnFromLanguageSelection(context, language) {
  const session = sessionManager.getSession(context.sender, context.chatId || context.sender) || {};
  const previousMenu = session.languageReturnMenu || 'preferences';
  if (previousMenu === 'profile') return sendProfileView(context, language);
  if (previousMenu === 'profile_edit') return sendEditSubmenu(context, language);
  if (previousMenu === 'preferences') return sendPreferencesView(context, language);
  if (previousMenu === 'main') {
    const { command: startCommand } = await import('./startCommand.js');
    return startCommand.execute(context);
  }
  const { command: startCommand } = await import('./startCommand.js');
  return startCommand.execute(context);
}

// Confirmation for changing language (currentMenu: 'pref_language_confirm').
async function sendLanguageConfirm(context, language, targetCode) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const targetLabel = prefLangLabel(targetCode);

  sessionManager.setState(sender, chatId, {
    currentMenu: 'pref_language_confirm',
    pendingLang: targetCode
  });

  const body = [
    t(language, 'preferences.languageChangeQuestion', { language: targetLabel }),
    '',
    '1. ' + t(language, 'preferences.yes'),
    '2. ' + t(language, 'preferences.no'),
    '',
    t(language, 'preferences.languagePrompt')
  ];

  await sendMenu({
    sock: context.sock, sender, chatId,
    text: buildMenu(t(language, 'preferences.langSelectionTitle'), '', body),
    transitionKey: 'preferences_to_language'
  });
}

// Language selection reply handler.
async function handleLanguageReply(context, language, trimmedText) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const user = await getUserByJid(sender);
  const currentLang = user?.language || language;

  if (trimmedText === '0') return returnFromLanguageSelection(context, language);

  if (!/^[1-5]$/.test(trimmedText)) {
    await sendText(context.sock, sender, toSmallCaps(t(language, 'common.invalidChoiceMinMax', { min: 1, max: 5 })));
    return sendLanguageSelection(context, language, { previousMenu: (sessionManager.getSession(sender, chatId) || {}).languageReturnMenu });
  }

  const targetCode = PREF_LANG_CODES[Number(trimmedText) - 1];

  // Already the active language -> friendly message.
  if (targetCode === currentLang) {
    const hint = buildMenu(t(language, 'preferences.langSelectionTitle'), '', [
      { static: '', dynamic: '' },
      '*' + toSmallCaps(t(language, 'preferences.languageAlreadySet')) + '*',
      '',
      toSmallCaps(t(language, 'preferences.languageAlreadySetHint')),
      ''
    ]);
    await sendText(context.sock, sender, hint);
    return sendLanguageSelection(context, language, { previousMenu: (sessionManager.getSession(sender, chatId) || {}).languageReturnMenu });
  }

  await sendLanguageConfirm(context, language, targetCode);
}

// Confirmation reply handler for language change.
async function handleLanguageConfirmReply(context, language, trimmedText) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const session = sessionManager.getSession(sender, chatId) || {};
  const targetCode = session.pendingLang;

  if (trimmedText === '2') {
    const hint = buildMenu(t(language, 'preferences.langSelectionTitle'), '', [
      { static: '', dynamic: '' },
      '*' + toSmallCaps(t(language, 'preferences.languageCancelled')) + '*',
      ''
    ]);
    await sendText(context.sock, sender, hint);
    return sendLanguageSelection(context, language, { previousMenu: (sessionManager.getSession(sender, chatId) || {}).languageReturnMenu });
  }

  if (trimmedText === '1' && targetCode) {
    await updateUser(sender, { language: targetCode });
    const hint = buildMenu(t(language, 'preferences.langSelectionTitle'), '', [
      { static: '', dynamic: '' },
      '*' + toSmallCaps(t(language, 'preferences.languageChanged')) + '*',
      '',
      toSmallCaps(t(language, 'preferences.languageChangedHint')),
      ''
    ]);
    await sendText(context.sock, sender, hint);
    return sendLanguageSelection(context, targetCode, { done: true });
  }

  await sendText(context.sock, sender, toSmallCaps(t(language, 'preferences.confirmInvalid')));
}

// Toggle a boolean preference and re-render the preferences menu.
export async function togglePreference(context, language, field) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const user = await getUserByJid(sender);
  const prefs = user?.preferences || {};
  const newVal = prefs[field] ? false : true;
  await updateUser(sender, { preferences: { ...prefs, [field]: newVal } });
  await sendPreferencesView(context, language);
}

const SELF_DESTRUCT_PRESETS = {
  minutes: [10, 20, 30, 40, 50, 60],
  hours: [1, 2, 3, 6, 12, 24],
  months: [1, 3, 6],
  years: [1, 2]
};
const SELF_DESTRUCT_UNIT_SECONDS = {
  minutes: 60,
  hours: 60 * 60,
  months: 30 * 24 * 60 * 60,
  years: 365 * 24 * 60 * 60
};
const NATIVE_DISAPPEARING_PRESETS = [
  [24 * 60 * 60, '24Hours'],
  [7 * 24 * 60 * 60, '7Days'],
  [90 * 24 * 60 * 60, '90Days']
];

function preferenceDurationLabel(language, seconds) {
  const units = [
    [365 * 24 * 60 * 60, 'years'],
    [30 * 24 * 60 * 60, 'months'],
    [24 * 60 * 60, 'days'],
    [60 * 60, 'hours'],
    [60, 'minutes'],
    [1, 'seconds']
  ];
  for (const [size, key] of units) {
    if (seconds >= size && seconds % size === 0) {
      return `${seconds / size} ${t(language, 'messageSettings.' + key)}`;
    }
  }
  return `${seconds} ${t(language, 'messageSettings.seconds')}`;
}

function currentMessageMode(language, user) {
  const selfDestruct = user?.preferences?.selfDestruct;
  const native = user?.preferences?.nativeDisappearing || 0;
  if (selfDestruct?.enabled) {
    return t(language, 'messageSettings.enabled') + ' : ' + preferenceDurationLabel(language, selfDestruct.durationSeconds);
  }
  if (native) {
    return t(language, 'messageSettings.enabled') + ' : ' + preferenceDurationLabel(language, native);
  }
  return t(language, 'messageSettings.disabled');
}

export async function sendMessageSettings(context, language) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const user = await getUserByJid(sender);
  const body = [
    t(language, 'messageSettings.currentMode'),
    '>> *' + currentMessageMode(language, user) + '*',
    '',
    '1. ⏱️ ' + t(language, 'messageSettings.selfDestruct'),
    '2. 💬 ' + t(language, 'messageSettings.nativeDisappearing'),
    '',
    '0. ' + t(language, 'profile.optionBack'),
    '',
    t(language, 'messageSettings.replyPrompt')
  ];
  sessionManager.setState(sender, chatId, { currentMenu: 'message_settings' });
  await sendMenu({
    sock: context.sock, sender, chatId,
    text: buildMenu(t(language, 'messageSettings.title'), '', body),
    transitionKey: 'message_settings'
  });
}

async function sendSelfDestructUnit(context, language) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const user = await getUserByJid(sender);
  const body = [
    t(language, 'messageSettings.currentMode'),
    '>> *' + currentMessageMode(language, user) + '*',
    '',
    '1. ' + t(language, 'messageSettings.minutes'),
    '2. ' + t(language, 'messageSettings.hours'),
    '3. ' + t(language, 'messageSettings.months'),
    '4. ' + t(language, 'messageSettings.years'),
    '',
    '5. ' + t(language, 'messageSettings.disable'),
    '6. ' + t(language, 'messageSettings.customize'),
    '',
    '0. ' + t(language, 'profile.optionBack')
  ];
  sessionManager.setState(sender, chatId, { currentMenu: 'self_destruct_unit' });
  await sendMenu({ sock: context.sock, sender, chatId, text: buildMenu(t(language, 'messageSettings.selfDestructTitle'), '', body), transitionKey: 'self_destruct_unit' });
}

async function sendSelfDestructCustomTime(context, language) {
  const body = [
    t(language, 'messageSettings.customTimePrompt'),
    '',
    t(language, 'messageSettings.customTimeBack')
  ];
  sessionManager.setState(context.sender, context.chatId || context.sender, { currentMenu: 'self_destruct_custom_time' });
  await sendMenu({
    sock: context.sock,
    sender: context.sender,
    chatId: context.chatId || context.sender,
    text: buildMenu(t(language, 'messageSettings.selfDestructTitle'), '', body),
    transitionKey: 'self_destruct_custom_time'
  });
}

async function sendSelfDestructDuration(context, language, unit) {
  const values = SELF_DESTRUCT_PRESETS[unit] || [];
  const body = values.map((value, index) => `${index + 1}. ${value} ${t(language, 'messageSettings.' + unit)}`);
  body.push('', '0. ' + t(language, 'profile.optionBack'));
  sessionManager.setState(context.sender, context.chatId || context.sender, { currentMenu: 'self_destruct_duration', pendingSelfDestructUnit: unit });
  await sendMenu({ sock: context.sock, sender: context.sender, chatId: context.chatId || context.sender, text: buildMenu(t(language, 'messageSettings.selfDestructTitle'), '', body), transitionKey: 'self_destruct_duration' });
}

function repetitionDescription(language, count) {
  if (count === -1) return t(language, 'messageSettings.allFuture');
  if (count === 1) return t(language, 'messageSettings.nextOnly');
  return t(language, 'messageSettings.nextCount', { count });
}

async function sendSelfDestructRepetition(context, language, durationSeconds) {
  const body = [
    t(language, 'messageSettings.repetitionPrompt'),
    '',
    '1. ' + t(language, 'messageSettings.once'),
    '2. ' + t(language, 'messageSettings.twice'),
    '3. ' + t(language, 'messageSettings.always'),
    '4. ' + t(language, 'messageSettings.customize'),
    '',
    '0. ' + t(language, 'profile.optionBack')
  ];
  sessionManager.setState(context.sender, context.chatId || context.sender, { currentMenu: 'self_destruct_repetition', pendingSelfDestructDuration: durationSeconds });
  await sendMenu({ sock: context.sock, sender: context.sender, chatId: context.chatId || context.sender, text: buildMenu(t(language, 'messageSettings.selfDestructTitle'), '', body), transitionKey: 'self_destruct_repetition' });
}

async function sendSelfDestructConfirmation(context, language, durationSeconds, count) {
  const body = [
    '*⚠️ ' + t(language, 'messageSettings.warning', { duration: preferenceDurationLabel(language, durationSeconds) }) + '*',
    '',
    t(language, 'messageSettings.enableQuestion', { repetition: repetitionDescription(language, count) }),
    '',
    '1. ' + t(language, 'messageSettings.yes'),
    '2. ' + t(language, 'messageSettings.no'),
    '3. ' + t(language, 'messageSettings.edit'),
    '',
    '0. ' + t(language, 'profile.optionBack')
  ];
  sessionManager.setState(context.sender, context.chatId || context.sender, { currentMenu: 'self_destruct_confirm', pendingSelfDestructDuration: durationSeconds, pendingSelfDestructCount: count });
  await sendMenu({ sock: context.sock, sender: context.sender, chatId: context.chatId || context.sender, text: buildMenu(t(language, 'messageSettings.title'), '', body), transitionKey: 'self_destruct_confirm' });
}

async function sendSelfDestructSuccess(context, language, durationSeconds) {
  const body = [
    '✅ ' + t(language, 'messageSettings.selfDestructSet', { duration: preferenceDurationLabel(language, durationSeconds) }),
    '',
    '0. ' + t(language, 'profile.optionBack')
  ];
  sessionManager.setState(context.sender, context.chatId || context.sender, { currentMenu: 'message_settings' });
  await sendMenu({ sock: context.sock, sender: context.sender, chatId: context.chatId || context.sender, text: buildMenu(t(language, 'messageSettings.title'), '', body), transitionKey: 'self_destruct_confirm' });
}

async function sendNativeDisappearing(context, language) {
  const user = await getUserByJid(context.sender);
  const current = user?.preferences?.nativeDisappearing || 0;
  const body = [
    t(language, 'messageSettings.currentMode'),
    '>> ' + (current ? t(language, 'messageSettings.enabled') + ' : ' + preferenceDurationLabel(language, current) : t(language, 'messageSettings.disabled')),
    '',
    ...NATIVE_DISAPPEARING_PRESETS.map(([seconds, key], index) => `${index + 1}. ${t(language, 'messageSettings.' + key)}`),
    '4. ' + t(language, 'messageSettings.disable'),
    '',
    '0. ' + t(language, 'profile.optionBack')
  ];
  sessionManager.setState(context.sender, context.chatId || context.sender, { currentMenu: 'native_disappearing' });
  await sendMenu({ sock: context.sock, sender: context.sender, chatId: context.chatId || context.sender, text: buildMenu(t(language, 'messageSettings.nativeTitle'), '', body), transitionKey: 'native_disappearing' });
}

async function saveNativeDisappearing(context, language, seconds) {
  const user = await getUserByJid(context.sender);
  await context.sock.sendMessage(context.chatId || context.sender, { disappearingMessagesInChat: seconds });
  await updateUser(context.sender, { preferences: { ...(user?.preferences || {}), nativeDisappearing: seconds } });
  const body = ['✅ ' + t(language, 'messageSettings.nativeSet', { duration: seconds ? preferenceDurationLabel(language, seconds) : t(language, 'messageSettings.disabled') }), '', '0. ' + t(language, 'profile.optionBack')];
  sessionManager.setState(context.sender, context.chatId || context.sender, { currentMenu: 'message_settings' });
  await sendMenu({ sock: context.sock, sender: context.sender, chatId: context.chatId || context.sender, text: buildMenu(t(language, 'messageSettings.title'), '', body), transitionKey: 'self_destruct_confirm' });
}

// "Copy My ID" from the profile menu (option 4). Sends the user's ID with
// username/profile link via the hybrid edit/delete+send system. No auto-return.
async function sendCopyId(context, language) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const user = await getUserByJid(sender);
  const username = user?.username || null;
  const id = sender || '';
  const profileUrl = username
    ? `https://yourbot.com/u/@${username}`
    : `https://yourbot.com/u/${id}`;

  // Static labels small-capped; dynamic values (id, username, url) normal case.
  const usernameLabel = username ? `@${username}` : toSmallCaps(t(language, 'profile.notSet'));
  const lines = [
    '> *' + toSmallCaps(t(language, 'profile.copyId')) + '* `' + id + '`',
    '',
    '*👤 ' + toSmallCaps(t(language, 'profile.username')) + ':* ' + usernameLabel,
    '*🔗 ' + toSmallCaps(t(language, 'profile.profile')) + ':* ' + profileUrl,
    '',
    '📱 ' + toSmallCaps(t(language, 'profile.holdToCopy')),
    toSmallCaps(t(language, 'profile.sendBack'))
  ];

  await sendMenu({
    sock: context.sock, sender, chatId,
    text: lines.join('\n'),
    transitionKey: 'profile_to_copyid'
  });
}

export async function backToMain(context, language) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const user = getUserByJidSync(sender);

  sessionManager.setState(sender, chatId, { currentMenu: 'main' });
  const { sendMigratedMainMenu } = await import('./startCommand.js');
  await sendMigratedMainMenu({ sock: context.sock, sender, chatId, user, language, transitionKey: 'profile_to_main' });
}

/** Entry point: open the profile view (invoked from main menu option 1). */
export async function openProfile(context) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = languageOf(sender);
  await sendProfileView(context, language);
}

// ---------------------------------------------------------------------------
// Standalone menu commands: /profile /editprofile /stats /preferences
// These open the same views as the numbered navigation (hybrid edit/delete+send
// transitions) and reset the session to the opened menu. Feature-gated options
// respond with the disabled message and leave the current session untouched.
// ---------------------------------------------------------------------------

/** Open the profile view (also used to resume from global help). */
export async function openProfileView(context) {
  const language = languageOf(context.sender);
  await sendProfileView(context, language);
}

/** Open the edit-profile submenu (also used to resume from global help). */
export async function openEditProfile(context) {
  const language = languageOf(context.sender);
  await sendEditSubmenu(context, language);
}

/** Open the statistics submenu (also used to resume from global help). */
export async function openStats(context) {
  const language = languageOf(context.sender);
  await sendStatsView(context, language);
}

/** Open the preferences submenu (also used to resume from global help). */
export async function openPreferences(context) {
  const language = languageOf(context.sender);
  await sendPreferencesView(context, language);
}

/** Open the preferences language-selection submenu. */
export async function openLanguageSelection(context, opts = {}) {
  const language = languageOf(context.sender);
  await sendLanguageSelection(context, language, opts);
}

async function gateCommandFeature(context, features) {
  const enabled = features.some((f) => isFeatureEnabled(f));
  if (enabled) return true;
  const language = languageOf(context.sender);
  await sendText(context.sock, context.sender, toSmallCaps(t(language, 'common.featureDisabled')));
  return false;
}

const profileCommand = {
  name: 'profile',
  description: 'View your profile',
  usage: '/profile',
  aliases: ['me', 'myprofile'],
  adminOnly: false,
  groupAllowed: true,
  async execute(context) {
    if (!(await gateCommandFeature(context, ['profileEditing', 'shareProfile']))) return { success: false };
    await openProfileView(context);
    return { success: true };
  }
};

const editProfileCommand = {
  name: 'editprofile',
  description: 'Edit your profile',
  usage: '/editprofile',
  aliases: ['edit'],
  adminOnly: false,
  groupAllowed: true,
  async execute(context) {
    if (!(await gateCommandFeature(context, ['profileEditing']))) return { success: false };
    await openEditProfile(context);
    return { success: true };
  }
};

const statsCommand = {
  name: 'stats',
  description: 'View your statistics',
  usage: '/stats',
  aliases: ['mystats'],
  adminOnly: false,
  groupAllowed: true,
  async execute(context) {
    if (!(await gateCommandFeature(context, ['statistics']))) return { success: false };
    await openStats(context);
    return { success: true };
  }
};

const preferencesCommand = {
  name: 'preferences',
  description: 'Change your preferences',
  usage: '/preferences',
  aliases: ['prefs'],
  adminOnly: false,
  groupAllowed: true,
  async execute(context) {
    if (!(await gateCommandFeature(context, ['preferences']))) return { success: false };
    await openPreferences(context);
    return { success: true };
  }
};

export const commands = [profileCommand, editProfileCommand, statsCommand, preferencesCommand];

/**
 * Dispatch a resolved action from the central menu config for the
 * `profile` and `profile_edit` menus. Feature-gated options respond with
 * the appropriate disabled/coming_soon/maintenance message and re-render.
 */
export async function dispatchProfileAction(context, language, action) {
  const featureFor = (action) => {
    if (action === 'profile.edit') return 'profileEditing';
    if (action === 'profile.stats') return 'statistics';
    if (action === 'profile.preferences') return 'preferences';
    if (action === 'profile.messageSettings') return 'messageSettings';
    if (action === 'profile.copyid') return 'copyMyId';
    const editFeature = {
      'profile.edit.name': 'profileName',
      'profile.edit.username': 'profileUsername',
      'profile.edit.bio': 'profileBio',
      'profile.edit.timezone': 'profileTimezone',
      'profile.edit.picture': 'profilePicture',
      'profile.edit.country': 'profileCountry',
      'profile.edit.birthday': 'profileBirthday'
    };
    if (editFeature[action]) return editFeature[action];
    return null;
  };
  const feature = featureFor(action);
  if (feature) {
    const feat = getFeature(feature);
    if (feat && feat.status !== 'available') {
      return featureBlockedReply(context, language, feature, action.startsWith('profile.edit.') ? 'profile_edit' : 'profile');
    }
  }
  switch (action) {
    case 'profile.exit': return backToMain(context, language);
    case 'profile.view': return sendProfileView(context, language);
    case 'profile.edit': return sendEditSubmenu(context, language);
    case 'profile.stats': return sendStatsView(context, language);
    case 'profile.preferences': return sendPreferencesView(context, language);
    case 'profile.messageSettings': return sendMessageSettings(context, language);
    case 'profile.copyid': return sendCopyId(context, language);
    case 'profile.edit.name': return promptField(context, language, 'name');
    case 'profile.edit.username': return promptField(context, language, 'username');
    default: return sendProfileView(context, language);
  }
}

/** Route profile submenu replies (currentMenu: profile / profile_edit / *_input / profile_confirmation). */
export async function handleProfileReply(context, trimmedText) {
  const sender = context.sender;
  const chatId = context.chatId || sender;
  const language = languageOf(sender);
  const session = sessionManager.getSession(sender, chatId) || {};
  const currentMenu = session.currentMenu;

  if (currentMenu === 'profile' || currentMenu === 'profile_edit') {
    if (currentMenu === 'profile_edit') {
      const available = menus.profile_edit.options.filter((option) => getFeature(option.markerFromFeature)?.status === 'available');
      if (trimmedText === '0') return sendProfileView(context, language);
      const selected = available[Number(trimmedText) - 1];
      if (selected) return dispatchProfileAction(context, language, selected.action);
      if (trimmedText === String(available.length + 1) && available.length < menus.profile_edit.options.length) {
        return sendEditAdvancedSubmenu(context, language);
      }
      const max = available.length + (available.length < menus.profile_edit.options.length ? 1 : 0);
      await sendText(context.sock, sender, toSmallCaps(t(language, 'common.invalidChoiceMinMax', { min: 0, max })));
      return;
    }
    if (currentMenu === 'profile' && trimmedText === '0') return backToMain(context, language);
    const menuKey = currentMenu === 'profile_edit' ? 'profile_edit' : 'profile';
    const resolved = resolveMenuOption(menuKey, trimmedText);
    if (resolved) {
      return dispatchProfileAction(context, language, resolved.action);
    }
    await sendText(context.sock, sender, toSmallCaps(t(language, 'common.invalidChoiceMinMax', { min: 0, max: 7 })));
    return;
  }

  if (currentMenu === 'profile_edit_advanced') {
    const unavailable = menus.profile_edit.options.filter((option) => getFeature(option.markerFromFeature)?.status !== 'available');
    if (trimmedText === '0') return sendEditSubmenu(context, language);
    const selected = unavailable[Number(trimmedText) - 1];
    if (selected) return dispatchProfileAction(context, language, selected.action);
    await sendText(context.sock, sender, toSmallCaps(t(language, 'common.invalidChoiceMinMax', { min: 0, max: unavailable.length })));
    return;
  }

  if (currentMenu === 'stats') {
    if (trimmedText === '0') return sendProfileView(context, language);
    await sendText(context.sock, sender, toSmallCaps(t(language, 'common.invalidChoiceValid')));
    return;
  }

// Preferences main view.
  if (currentMenu === 'preferences') {
    if (trimmedText === '0') return sendProfileView(context, language);
    const available = PREFERENCE_FEATURE_OPTIONS.filter(([, , featureId]) => getFeature(featureId)?.status === 'available');
    const selected = available[Number(trimmedText) - 1];
    if (selected) {
      const featureId = selected[2];
      if (featureId === 'languageSelection') return sendLanguageSelection(context, language);
      if (featureId === 'notifications' || featureId === 'announcements') return togglePreference(context, language, featureId);
      if (featureId === 'messageSettings') return sendMessageSettings(context, language);
      if (featureId === 'typingIndicator') return sendTypingMenu(context, language, 'preferences');
    }
    if (trimmedText === String(available.length + 1) && available.length < PREFERENCE_FEATURE_OPTIONS.length) {
      return sendAdvancedPreferencesView(context, language);
    }
    const max = available.length + (available.length < PREFERENCE_FEATURE_OPTIONS.length ? 1 : 0);
    await sendText(context.sock, sender, toSmallCaps(t(language, 'common.invalidChoiceMinMax', { min: 0, max })));
    return;
  }

  // Advanced Preferences submenu contains every currently unavailable feature.
  if (currentMenu === 'pref_advanced') {
    const unavailable = PREFERENCE_FEATURE_OPTIONS.filter(([, , featureId]) => getFeature(featureId)?.status !== 'available');
    if (trimmedText === '0') return sendPreferencesView(context, language);
    const selected = unavailable[Number(trimmedText) - 1];
    if (selected && selected[2] === 'typingIndicator') return sendTypingMenu(context, language, 'pref_advanced');
    if (selected) return featureBlockedReply(context, language, selected[2], 'pref_advanced');
    await sendText(context.sock, sender, toSmallCaps(t(language, 'common.invalidChoiceMinMax', { min: 0, max: unavailable.length })));
    return;
  }

  if (currentMenu === 'message_settings') {
    if (trimmedText === '0') return sendPreferencesView(context, language);
    if (trimmedText === '1') return sendSelfDestructUnit(context, language);
    if (trimmedText === '2') return sendNativeDisappearing(context, language);
    await sendText(context.sock, sender, toSmallCaps(t(language, 'common.invalidChoiceValid')));
    return;
  }

  if (currentMenu === 'self_destruct_unit') {
    if (trimmedText === '0') return sendMessageSettings(context, language);
    if (trimmedText === '5') {
      const user = await getUserByJid(sender);
      await updateUser(sender, { preferences: { ...(user?.preferences || {}), selfDestruct: { enabled: false, durationSeconds: 0, remainingCount: 0, always: false } } });
      return sendMessageSettings(context, language);
    }
    if (trimmedText === '6') return sendSelfDestructCustomTime(context, language);
    const units = ['minutes', 'hours', 'months', 'years'];
    if (units[Number(trimmedText) - 1]) return sendSelfDestructDuration(context, language, units[Number(trimmedText) - 1]);
    await sendText(context.sock, sender, toSmallCaps(t(language, 'common.invalidChoiceValid')));
    return;
  }

  if (currentMenu === 'self_destruct_custom_time') {
    if (trimmedText === '0') return sendSelfDestructUnit(context, language);
    const target = parseScheduleTime(trimmedText) || parseRelativeTime(trimmedText);
    const durationSeconds = target ? Math.floor((target - Date.now()) / 1000) : 0;
    if (durationSeconds > 0) {
      return sendSelfDestructRepetition(context, language, durationSeconds);
    }
    await sendText(context.sock, sender, toSmallCaps(t(language, 'messageSettings.customTimeInvalid')));
    return sendSelfDestructCustomTime(context, language);
  }

  if (currentMenu === 'self_destruct_duration') {
    const unit = session.pendingSelfDestructUnit;
    if (trimmedText === '0') return sendSelfDestructUnit(context, language);
    const values = SELF_DESTRUCT_PRESETS[unit] || [];
    const value = values[Number(trimmedText) - 1];
    if (value) return sendSelfDestructRepetition(context, language, value * SELF_DESTRUCT_UNIT_SECONDS[unit]);
    await sendText(context.sock, sender, toSmallCaps(t(language, 'common.invalidChoiceValid')));
    return;
  }

  if (currentMenu === 'self_destruct_repetition') {
    if (trimmedText === '0') return sendSelfDestructUnit(context, language);
    if (trimmedText === '1') return sendSelfDestructConfirmation(context, language, session.pendingSelfDestructDuration, 1);
    if (trimmedText === '2') return sendSelfDestructConfirmation(context, language, session.pendingSelfDestructDuration, 2);
    if (trimmedText === '3') return sendSelfDestructConfirmation(context, language, session.pendingSelfDestructDuration, -1);
    if (trimmedText === '4') {
      sessionManager.setState(sender, chatId, { currentMenu: 'self_destruct_custom' });
      return sendMenu({ sock: context.sock, sender, chatId, text: buildMenu(t(language, 'messageSettings.selfDestructTitle'), '', [t(language, 'messageSettings.customPrompt'), '', '0. ' + t(language, 'profile.optionBack')]), transitionKey: 'self_destruct_custom' });
    }
    await sendText(context.sock, sender, toSmallCaps(t(language, 'common.invalidChoiceValid')));
    return;
  }

  if (currentMenu === 'self_destruct_custom') {
    if (trimmedText === '0') return sendSelfDestructRepetition(context, language, session.pendingSelfDestructDuration);
    const count = Number(trimmedText);
    if (Number.isInteger(count) && count >= 1) return sendSelfDestructConfirmation(context, language, session.pendingSelfDestructDuration, count);
    await sendText(context.sock, sender, toSmallCaps(t(language, 'messageSettings.customInvalid')));
    return;
  }

  if (currentMenu === 'self_destruct_confirm') {
    if (trimmedText === '0' || trimmedText === '2') return sendMessageSettings(context, language);
    if (trimmedText === '3') return sendSelfDestructUnit(context, language);
    if (trimmedText === '1') {
      const user = await getUserByJid(sender);
      const always = session.pendingSelfDestructCount === -1;
      await updateUser(sender, { preferences: { ...(user?.preferences || {}), selfDestruct: { enabled: true, durationSeconds: session.pendingSelfDestructDuration, remainingCount: session.pendingSelfDestructCount, always } } });
      return sendSelfDestructSuccess(context, language, session.pendingSelfDestructDuration);
    }
    await sendText(context.sock, sender, toSmallCaps(t(language, 'common.invalidChoiceValid')));
    return;
  }

  if (currentMenu === 'native_disappearing') {
    if (trimmedText === '0') return sendMessageSettings(context, language);
    if (trimmedText === '4') return saveNativeDisappearing(context, language, 0);
    const selected = NATIVE_DISAPPEARING_PRESETS[Number(trimmedText) - 1];
    if (selected) return saveNativeDisappearing(context, language, selected[0]);
    await sendText(context.sock, sender, toSmallCaps(t(language, 'common.invalidChoiceValid')));
    return;
  }

  // Typing indicator preferences.
  if (currentMenu === 'pref_typing') {
    return handleTypingMenuReply(context, language, trimmedText);
  }
  if (currentMenu === 'pref_typing_mode') {
    return handleTypingModeReply(context, language, trimmedText);
  }
  if (currentMenu === 'pref_typing_delay') {
    return handleTypingDelayReply(context, language, trimmedText);
  }
  if (currentMenu === 'pref_typing_delay_custom') {
    return handleTypingDelayCustomReply(context, language, trimmedText);
  }
  if (currentMenu === 'pref_typing_type') {
    return handleTypingTypeReply(context, language, trimmedText);
  }
  if (currentMenu === 'pref_typing_advanced') {
    return handleTypingAdvancedReply(context, language, trimmedText);
  }

  // Preferences language selection.
  if (currentMenu === 'pref_language_selection') {
    return handleLanguageReply(context, language, trimmedText);
  }

  // Preferences language change confirmation.
  if (currentMenu === 'pref_language_confirm') {
    return handleLanguageConfirmReply(context, language, trimmedText);
  }

  if (currentMenu === 'profile_name_input') {
    if (trimmedText === '0') {
      await sendText(context.sock, sender, toSmallCaps(t(language, 'profile.nameCancel')));
      return sendEditSubmenu(context, language);
    }
    const name = trimmedText.trim();
    if (name.length > 30) {
      await sendText(context.sock, sender, toSmallCaps(t(language, 'profile.nameMax')));
      return promptField(context, language, 'name');
    }
    return promptConfirmation(context, language, 'name', name);
  }

  if (currentMenu === 'profile_username_input') {
    if (trimmedText === '0') {
      await sendText(context.sock, sender, toSmallCaps(t(language, 'profile.usernameCancel')));
      return sendEditSubmenu(context, language);
    }
    const username = trimmedText.trim();
    if (username.length > 20 || !/^[A-Za-z0-9_]+$/.test(username)) {
      await sendText(context.sock, sender, toSmallCaps(t(language, 'profile.usernameInvalid')));
      return promptField(context, language, 'username');
    }
    const existing = await findUserByUsername(username);
    if (existing && existing.jid !== sender) {
      await sendText(context.sock, sender, toSmallCaps(t(language, 'profile.usernameTaken')));
      return promptField(context, language, 'username');
    }
    return promptConfirmation(context, language, 'username', username);
  }

  if (currentMenu === 'profile_confirmation') {
    const field = session.pendingField;
    const value = session.pendingValue;
    if (trimmedText === '2') {
      await sendText(context.sock, sender, toSmallCaps(t(language, 'profile.changeCancelled')));
      await sendEditSubmenu(context, language);
      return;
    }
    if (trimmedText === '1' && field && value) {
      return confirmSuccess(context, language, field, value);
    }
    await sendText(context.sock, sender, toSmallCaps(t(language, 'profile.confirmInvalid')));
    return;
  }

// Feature unavailable submenu (Notify Me / Info / Back).
  if (currentMenu === 'feature_unavailable') {
  const featureName = session.pendingNotifyFeature;
  const previousMenu = session.previousMenu || 'profile';

  if (trimmedText === '0') {
    if (previousMenu === 'main') return backToMain(context, language);
    if (previousMenu === 'profile') return sendProfileView(context, language);
    if (previousMenu === 'profile_edit') return sendEditSubmenu(context, language);
    if (previousMenu === 'preferences') return sendPreferencesView(context, language);
    if (previousMenu === 'pref_advanced') return sendAdvancedPreferencesView(context, language);
    return sendProfileView(context, language);
  }

  if (trimmedText === '1') return featureNotifyToggle(context, language, featureName, previousMenu);
  if (trimmedText === '2') return featureShowInfo(context, language, featureName, previousMenu);

  await sendText(context.sock, sender, toSmallCaps(t(language, 'common.invalidChoiceMinMax', { min: 0, max: 2 })));
  return;
}

  // Feature notification toggle and result menus.
  if (currentMenu === 'feature_notify_toggle' || currentMenu === 'feature_notify_result') {
    const featureName = session.pendingNotifyFeature;
    const previousMenu = session.previousMenu || 'profile';
    const isResult = currentMenu === 'feature_notify_result';

    if (trimmedText === '0' || (!isResult && trimmedText === '3')) {
      return featureBlockedReply(context, language, featureName, previousMenu);
    }
    if (isResult && (trimmedText !== '1' && trimmedText !== '2')) {
      await sendText(context.sock, sender, toSmallCaps(t(language, 'common.invalidChoice')));
      return;
    }
    if (!featureName || (trimmedText !== '1' && trimmedText !== '2')) {
      await sendText(context.sock, sender, toSmallCaps(t(language, 'common.invalidChoiceMinMax', { min: 1, max: 3 })));
      return;
    }

    await ensureUserProfile({ jid: sender, name: context.pushName || 'User' });
    const user = await getUserByJid(sender);
    const hasNotify = user?.notifyRequests?.[featureName] === true;
    if (trimmedText === '1') {
      if (hasNotify) {
        return featureNotifyResult(context, language, featureName, previousMenu, t(language, 'feature.notifyAlreadyEnabled'), true);
      }
      const enabled = await setNotifyRequest(sender, featureName, true);
      if (!enabled) {
        await sendText(context.sock, sender, toSmallCaps(t(language, 'common.invalidChoice')));
        return;
      }
      return featureNotifyResult(context, language, featureName, previousMenu, t(language, 'feature.notifySuccess'), false);
    }
    if (!hasNotify) {
      return featureNotifyResult(context, language, featureName, previousMenu, t(language, 'feature.notifyAlreadyDisabled'), true);
    }
    const disabled = await setNotifyRequest(sender, featureName, false);
    if (!disabled) {
      await sendText(context.sock, sender, toSmallCaps(t(language, 'common.invalidChoice')));
      return;
    }
    return featureNotifyResult(context, language, featureName, previousMenu, t(language, 'feature.notifyDisabled'), false);
  }

  // Feature info view.
  if (currentMenu === 'feature_info') {
    const featureName = session.pendingNotifyFeature;
    const previousMenu = session.previousMenu || 'profile';
    if (trimmedText === '0') {
      return featureBlockedReply(context, language, featureName, previousMenu);
    }
    await sendText(context.sock, sender, toSmallCaps(t(language, 'common.reply0Back')));
    return;
  }

  // Notification opt-in for the conversational chat (from preferences 13-16).
  if (currentMenu === 'chat_notify') {
    if (trimmedText === '0') return sendPreferencesView(context, language);
    if (trimmedText === '1') {
      await chatNotifyService.addRequest(sender);
      await sendText(context.sock, sender, toSmallCaps(t(language, 'feature.notifySuccess')));
      return sendPreferencesView(context, language);
    }
    await sendText(context.sock, sender, toSmallCaps(t(language, 'common.invalidChoiceValid')));
    return;
  }

  // Unexpected fallback: return to the profile view.
  return sendProfileView(context, language);
}
