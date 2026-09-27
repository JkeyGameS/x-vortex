/**
 * Central feature registry.
 *
 * This is the single source of truth for feature availability. Runtime
 * overrides (status + marker + custom messages) are merged from
 * data/featureFlags.json by featureFlagService on startup and persisted back
 * on admin changes.
 *
 * A feature is "available" when its effective status is 'available'.
 *
 * Markers:
 *   - marker = null/undefined  -> status default marker is shown (✅/⛔️/🔅/⚠️)
 *   - marker = ''              -> marker explicitly removed (nothing shown)
 *   - marker = 'X'             -> custom marker shown
 *
 * Messages:
 *   - messages.X holds the translation KEY used as the default message for
 *     that slot. Custom per-feature overrides are stored in featureFlags.json
 *     under `messages` and resolved by featureFlagService.getFeatureMessage().
 *
 * @typedef {Object} FeatureDef
 * @property {string} label      - internal id / static label
 * @property {string} labelKey   - translation key for the localized label
 * @property {string} prefix     - display emoji prefix used in admin lists
 * @property {string} status     - 'available' | 'unavailable' | 'coming_soon' | 'maintenance'
 * @property {string} [marker]   - dynamic marker shown in menus (default per status)
 * @property {string} [path]     - internal navigation identifier
 * @property {Object} messages   - default message translation keys per slot
 */
export const DEFAULT_STATUS_MARKERS = {
  available: '✅',
  unavailable: '⛔️',
  coming_soon: '🔅',
  maintenance: '⚠️'
};

export const FEATURE_STATUSES = ['available', 'unavailable', 'coming_soon', 'maintenance'];

export const FEATURE_MESSAGE_SLOTS = ['unavailable', 'notifyPrompt', 'info'];

function preferenceFeature(labelKey, prefix, status, marker) {
  return {
    label: labelKey.split('.').pop(),
    labelKey,
    prefix,
    status,
    marker,
    path: 'preferences.' + labelKey.split('.').pop(),
    isSubmenu: false,
    children: [],
    messages: {
      unavailable: 'feature.unavailable',
      notifyPrompt: 'feature.notifyPrompt',
      info: 'feature.info'
    }
  };
}

export const FEATURES = {
  profileEditing: {
    label: 'profileEditing',
    labelKey: 'admin.flags.labelProfileEditing',
    prefix: '✏️',
    status: 'available',
    marker: '✅',
    path: 'profile.edit',
    isSubmenu: true,
    children: ['profileName', 'profileUsername', 'profileBio', 'profileTimezone', 'profilePicture', 'profileCountry', 'profileBirthday'],
    messages: {
      unavailable: 'feature.unavailable',
      notifyPrompt: 'feature.notifyPrompt',
      info: 'feature.info'
    }
  },
  profileName: {
    label: 'profileName',
    labelKey: 'profile.editName',
    prefix: '👤',
    status: 'available',
    marker: '✅',
    path: 'profile.edit.name',
    messages: {
      unavailable: 'feature.unavailable',
      notifyPrompt: 'feature.notifyPrompt',
      info: 'feature.info'
    }
  },
  profileUsername: {
    label: 'profileUsername',
    labelKey: 'profile.editUsername',
    prefix: '📛',
    status: 'available',
    marker: '✅',
    path: 'profile.edit.username',
    messages: {
      unavailable: 'feature.unavailable',
      notifyPrompt: 'feature.notifyPrompt',
      info: 'feature.info'
    }
  },
  profileBio: {
    label: 'profileBio',
    labelKey: 'profile.editBio',
    prefix: '📝',
    status: 'coming_soon',
    marker: '🔅',
    path: 'profile.edit.bio',
    messages: {
      unavailable: 'feature.unavailable',
      notifyPrompt: 'feature.notifyPrompt',
      info: 'feature.info'
    }
  },
  profileTimezone: {
    label: 'profileTimezone',
    labelKey: 'profile.editTimezone',
    prefix: '🕒',
    status: 'coming_soon',
    marker: '🔅',
    path: 'profile.edit.timezone',
    messages: {
      unavailable: 'feature.unavailable',
      notifyPrompt: 'feature.notifyPrompt',
      info: 'feature.info'
    }
  },
  profilePicture: {
    label: 'profilePicture',
    labelKey: 'profile.editPicture',
    prefix: '🖼️',
    status: 'coming_soon',
    marker: '🔅',
    path: 'profile.edit.picture',
    messages: {
      unavailable: 'feature.unavailable',
      notifyPrompt: 'feature.notifyPrompt',
      info: 'feature.info'
    }
  },
  profileCountry: {
    label: 'profileCountry',
    labelKey: 'profile.editCountry',
    prefix: '🌍',
    status: 'coming_soon',
    marker: '🔅',
    path: 'profile.edit.country',
    messages: {
      unavailable: 'feature.unavailable',
      notifyPrompt: 'feature.notifyPrompt',
      info: 'feature.info'
    }
  },
  profileBirthday: {
    label: 'profileBirthday',
    labelKey: 'profile.editBirthday',
    prefix: '🎂',
    status: 'coming_soon',
    marker: '🔅',
    path: 'profile.edit.birthday',
    messages: {
      unavailable: 'feature.unavailable',
      notifyPrompt: 'feature.notifyPrompt',
      info: 'feature.info'
    }
  },
  languageSelection: preferenceFeature('preferences.languageSelection', '🌐', 'available', '✅'),
  notifications: preferenceFeature('preferences.notifications', '🔔', 'available', '✅'),
  announcements: preferenceFeature('preferences.announcements', '📢', 'available', '✅'),
  messageSettings: preferenceFeature('preferences.messageSettings', '📩', 'available', '✅'),
  inlineHelp: preferenceFeature('preferences.inlineHelp', '📖', 'coming_soon', '🔅'),
  replyStyle: preferenceFeature('preferences.replyStyle', '💬', 'coming_soon', '🔅'),
  responseDelay: preferenceFeature('preferences.responseDelay', '⏱️', 'coming_soon', '🔅'),
  replyEmojis: preferenceFeature('preferences.replyEmojis', '💬', 'coming_soon', '🔅'),
  progressBars: preferenceFeature('preferences.progressBars', '📊', 'coming_soon', '🔅'),
  textStyle: preferenceFeature('preferences.textStyle', '🔤', 'coming_soon', '🔅'),
  dailyDigest: preferenceFeature('preferences.dailyDigest', '🗞️', 'coming_soon', '🔅'),
  timezoneAutoDetect: preferenceFeature('preferences.timezoneAutoDetect', '🌍', 'coming_soon', '🔅'),
  privacy: preferenceFeature('preferences.privacy', '🔐', 'coming_soon', '🔅'),
  greetingResponse: preferenceFeature('preferences.greetingResponse', '👋', 'coming_soon', '🔅'),
  typingIndicator: preferenceFeature('preferences.typingIndicator', '⌨️', 'coming_soon', '🔅'),
  helpPrompt: preferenceFeature('preferences.helpPrompt', '❓', 'coming_soon', '🔅'),
  friendlyTone: preferenceFeature('preferences.friendlyTone', '😊', 'coming_soon', '🔅'),
  shareProfile: {
    label: 'shareProfile',
    labelKey: 'admin.flags.labelShareProfile',
    prefix: '📩',
    status: 'coming_soon',
    marker: '🔅',
    path: 'profile.share',
    messages: {
      unavailable: 'feature.unavailable',
      notifyPrompt: 'feature.notifyPrompt',
      info: 'feature.info'
    }
  },
  copyMyId: {
    label: 'copyMyId',
    labelKey: 'admin.flags.labelCopyMyId',
    prefix: '🆔',
    status: 'available',
    path: 'profile.copyid',
    messages: {
      unavailable: 'feature.unavailable',
      notifyPrompt: 'feature.notifyPrompt',
      info: 'feature.info'
    }
  },
  preferences: {
    label: 'preferences',
    labelKey: 'admin.flags.labelPreferences',
    prefix: '⚙️',
    status: 'available',
    path: 'profile.preferences',
    isSubmenu: true,
    children: ['languageSelection', 'notifications', 'announcements', 'messageSettings', 'inlineHelp', 'replyStyle', 'responseDelay', 'replyEmojis', 'progressBars', 'textStyle', 'dailyDigest', 'timezoneAutoDetect', 'privacy', 'greetingResponse', 'typingIndicator', 'helpPrompt', 'friendlyTone'],
    messages: {
      unavailable: 'feature.unavailable',
      notifyPrompt: 'feature.notifyPrompt',
      info: 'feature.info'
    }
  },
  statistics: {
    label: 'statistics',
    labelKey: 'admin.flags.labelStatistics',
    prefix: '📊',
    status: 'available',
    path: 'profile.stats',
    isSubmenu: true,
    children: ['statistics'],
    messages: {
      unavailable: 'feature.unavailable',
      notifyPrompt: 'feature.notifyPrompt',
      info: 'feature.info'
    }
  },
  tutorial: {
    label: 'tutorial',
    labelKey: 'admin.flags.labelTutorial',
    prefix: '📚',
    status: 'available',
    marker: '✅',
    path: 'tutorial',
    isSubmenu: false,
    children: [],
    messages: {
      unavailable: 'feature.unavailable',
      notifyPrompt: 'feature.notifyPrompt',
      info: 'feature.info'
    }
  },
  info: {
    label: 'info',
    labelKey: 'admin.flags.labelInfo',
    prefix: 'ℹ️',
    status: 'available',
    marker: '✅',
    path: 'info',
    isSubmenu: true,
    children: [],
    messages: {
      unavailable: 'feature.unavailable',
      notifyPrompt: 'feature.notifyPrompt',
      info: 'feature.info'
    }
  },
  help: {
    label: 'help',
    labelKey: 'admin.flags.labelHelp',
    prefix: '❓',
    status: 'available',
    path: 'help',
    isSubmenu: false,
    children: [],
    messages: {
      unavailable: 'feature.unavailable',
      notifyPrompt: 'feature.notifyPrompt',
      info: 'feature.info'
    }
  },
  adminPanel: {
    label: 'adminPanel',
    labelKey: 'admin.flags.labelAdminPanel',
    prefix: '🧰',
    status: 'available',
    path: 'admin',
    isSubmenu: true,
    children: ['adminPanel', 'chatResponses', 'faq'],
    messages: {
      unavailable: 'feature.unavailable',
      notifyPrompt: 'feature.notifyPrompt',
      info: 'feature.info'
    }
  },
  feedback: {
    label: 'feedback',
    labelKey: 'admin.flags.labelFeedback',
    prefix: '📮',
    status: 'available',
    marker: '✅',
    path: 'feedback',
    isSubmenu: true,
    children: ['feedback'],
    messages: {
      unavailable: 'feature.unavailable',
      notifyPrompt: 'feature.notifyPrompt',
      info: 'feature.info'
    }
  },
  chatResponses: {
    label: 'chatResponses',
    labelKey: 'admin.flags.labelChatResponses',
    prefix: '💬',
    status: 'available',
    path: 'chat_responses',
    messages: {
      unavailable: 'feature.unavailable',
      notifyPrompt: 'feature.notifyPrompt',
      info: 'feature.info'
    }
  },
  faq: {
    label: 'faq',
    labelKey: 'admin.flags.labelFaq',
    prefix: '📚',
    status: 'available',
    path: 'faq',
    messages: {
      unavailable: 'feature.unavailable',
      notifyPrompt: 'feature.notifyPrompt',
      info: 'feature.info'
    }
  }
};

/**
 * Navigation metadata defaults: every feature declares whether it backs a
 * submenu in the admin hierarchical navigation and which features are its
 * children. Entries without explicit values are leaves.
 */
for (const def of Object.values(FEATURES)) {
  if (typeof def.isSubmenu !== 'boolean') def.isSubmenu = false;
  if (!Array.isArray(def.children)) def.children = [];
}

/**
 * Resolve the default marker for a feature based on its status.
 * @param {string} status
 * @returns {string}
 */
export function defaultMarkerForStatus(status) {
  return DEFAULT_STATUS_MARKERS[status] || DEFAULT_STATUS_MARKERS.unavailable;
}

/**
 * Resolve the effective marker for a feature.
 * - ''      -> explicitly removed, display nothing
 * - set     -> use the custom marker
 * - missing -> fall back to the status default
 * @param {string} status
 * @param {string} [marker]
 * @returns {string}
 */
export function effectiveMarker(status, marker) {
  if (marker === '') return '';
  if (marker && marker.trim()) return marker;
  return defaultMarkerForStatus(status);
}

/**
 * Translation key used for the status-appropriate "unavailable" message.
 * @param {string} status
 * @returns {string}
 */
export function defaultUnavailableKey(status) {
  if (status === 'coming_soon') return 'feature.comingSoon';
  if (status === 'maintenance') return 'feature.maintenance';
  return 'feature.unavailable';
}