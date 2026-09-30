// Canonical Bot Notifications toggle table.
//
// These toggles are persisted by the admin menu (menuCustomHandlers) and read
// by the senders (lifecycleService and the onboarding handler). They used to be
// duplicated in three places, and lifecycleService read config.botNotifications
// while the menu wrote data/settings.json -- so the admin menu could turn a
// notification off and the bot kept sending it. One table, one reader.
import config from './config.js';
import settingsService from '../services/settingsService.js';

// toggle name -> key in the settings store
export const BOT_NOTIFY_KEYS = {
  toggleAll: 'botNotificationsEnabled',
  onStartup: 'botNotifyOnStartup',
  onShutdown: 'botNotifyOnShutdown',
  onCrash: 'botNotifyOnCrash',
  onNewUser: 'botNotifyOnNewUser',
  onOnboardingComplete: 'botNotifyOnOnboardingComplete'
};

// Per-event toggles, in menu order. `toggleAll` is the master switch and is
// intentionally absent.
export const BOT_NOTIFY_EVENTS = ['onStartup', 'onShutdown', 'onCrash', 'onNewUser', 'onOnboardingComplete'];

/** Current value of every toggle, with the master switch applied. */
export function readBotNotifyToggles() {
  const stored = settingsService.getSettings() || {};
  const defaults = config.botNotifications || {};
  const out = {};
  for (const name of BOT_NOTIFY_EVENTS) {
    const key = BOT_NOTIFY_KEYS[name];
    const fallback = defaults[name] !== false;
    const raw = stored[key];
    out[name] = raw === undefined ? fallback : raw !== false;
  }
  const masterKey = BOT_NOTIFY_KEYS.toggleAll;
  const masterDefault = defaults.enabled !== false;
  const masterRaw = stored[masterKey];
  out.enabled = masterRaw === undefined ? masterDefault : masterRaw !== false;
  return out;
}

/** Master switch plus one event toggle. */
export function isBotNotifyEnabled(name) {
  const all = readBotNotifyToggles();
  return all.enabled && all[name] !== false;
}

/** Patch for the settings store when a toggle is flipped. */
export function botNotifyPatch(name, value) {
  return { [BOT_NOTIFY_KEYS[name]]: value };
}
