import { getFeature } from '../../../services/featureFlagService.js';
import { PREFERENCE_FEATURE_OPTIONS } from '../../../handlers/profileCommand.js';

// Preferences dynamic options: available features numbered 1..N (with live
// registry prefix + notification state suffixes), then Message Display, then
// the Advanced node when anything is unavailable. Advanced Options is always
// the highest number and is separated from the rows above it.
const CUSTOM_ACTION_BY_FEATURE = {
  languageSelection: 'custom:pref_change_language',
  notifications: 'custom:pref_toggle_notifications',
  announcements: 'custom:pref_toggle_announcements',
  typingIndicator: 'custom:pref_typing_menu',
  messageSettings: 'custom:pref_dispatch_message_settings'
};

const SUFFIX_BY_FEATURE = {
  notifications: 'notificationsState',
  announcements: 'announcementsState'
};

function buildPreferencesOptions() {
  const available = PREFERENCE_FEATURE_OPTIONS.filter(([, , featureId]) => getFeature(featureId)?.status === 'available');
  const mapped = available.map(([, , featureId], index) => {
    const opt = {
      number: String(index + 1),
      labelKey: `menu.preferences.${featureId}`,
      emoji: getFeature(featureId)?.prefix || null,
      action: CUSTOM_ACTION_BY_FEATURE[featureId] || 'custom:pref_unhandled_feature',
      featureId,
      fallbackKey: `preferences.${featureId}`
    };
    if (SUFFIX_BY_FEATURE[featureId]) opt.dynamicSuffix = SUFFIX_BY_FEATURE[featureId];
    return opt;
  });
  // Message display is a real preference for every user, so it is a fixed row
  // rather than a hidden entry inside the (conditional) Advanced node.
  mapped.push({
    number: String(mapped.length + 1),
    labelKey: 'menu.message_display.heading',
    emoji: '📩',
    action: 'open:message_display',
    fallbackKey: 'menu.message_display.heading'
  });
  if (available.length < PREFERENCE_FEATURE_OPTIONS.length) {
    mapped.push({
      number: String(mapped.length + 1),
      labelKey: 'menu.preferences.advanced',
      emoji: '🔒',
      action: 'custom:pref_advanced_menu',
      separatorBefore: true,
      fallbackKey: 'preferences.advancedOptions'
    });
  }
  return mapped;
}

export default {
  id: 'preferences',
  headingKey: 'menu.preferences.heading',
  headingEmoji: '⚙️',
  standaloneCommand: '/preferences',
  aliases: ['/prefs'],
  parent: 'profile',
  backTo: 'profile',
  footerKey: 'menu.preferences.footer',
  footerItalic: false,
  fallbackHeadingKey: 'preferences.title',
  fallbackFooterKey: 'preferences.replyPrompt',
  showMarkers: false,
  dynamicOptions: () => buildPreferencesOptions(),
  options: []
};
