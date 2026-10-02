// Canonical welcome-back toggle state.
//
// config.welcomeBack holds the compiled-in defaults only; the admin menu
// writes data/settings.json. Reading the default from config while the menu
// wrote settings is exactly the bug notificationToggles.js was written to fix,
// so the sender and the menu both come through this table.
import config from './config.js';
import settingsService from '../services/settingsService.js';

const ENABLED_KEY = 'welcomeBackEnabled';
const TIP_SHOWN_KEY = 'welcomeBackTipShown';

/** True when admins have welcome-back switched on. */
export function isWelcomeBackEnabled() {
  const stored = settingsService.getSettings() || {};
  const fallback = config.welcomeBack?.enabled !== false;
  const raw = stored[ENABLED_KEY];
  return raw === undefined ? fallback : raw !== false;
}

/** Settings patch for flipping the master toggle. */
export function welcomeBackPatch(value) {
  return { [ENABLED_KEY]: value !== false };
}

/** True once the one-time tip has been shown (B1/B2 only). */
export function welcomeBackTipShown() {
  const stored = settingsService.getSettings() || {};
  return stored[TIP_SHOWN_KEY] === true;
}

/** Settings patch that marks the tip as delivered. */
export function welcomeBackTipShownPatch() {
  return { [TIP_SHOWN_KEY]: true };
}

/**
 * Decide whether the tip should ride along with this welcome.
 * Only the short and medium category-B variants (B1/B2) get it, and only once.
 */
export function shouldShowTip(variant) {
  if (!isWelcomeBackEnabled()) return false;
  if (config.welcomeBack?.tipEnabled === false) return false;
  if (variant !== 'B1' && variant !== 'B2') return false;
  if (welcomeBackTipShown()) return false;
  return true;
}

export { ENABLED_KEY, TIP_SHOWN_KEY };