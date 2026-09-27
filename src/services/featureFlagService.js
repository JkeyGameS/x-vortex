import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import logger from '../utils/logger.js';
import { t } from './localeService.js';
import {
  FEATURES,
  FEATURE_STATUSES,
  FEATURE_MESSAGE_SLOTS,
  effectiveMarker,
  defaultMarkerForStatus,
  defaultUnavailableKey
} from '../config/features.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '../../data');
const FLAGS_FILE = path.join(DATA_DIR, 'featureFlags.json');

// Build the in-memory registry from the central source of truth.
let registry = deepClone(FEATURES);

function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

// Message-override storage key on each runtime feature entry.
function getOverrides(name) {
  if (!registry[name].messageOverrides) registry[name].messageOverrides = {};
  return registry[name].messageOverrides;
}

function load() {
  try {
    if (fs.existsSync(FLAGS_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(FLAGS_FILE, 'utf8'));
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        for (const name of Object.keys(FEATURES)) {
          const override = parsed[name];
          if (!override || typeof override !== 'object') continue;
          if (FEATURE_STATUSES.includes(override.status)) {
            registry[name].status = override.status;
          }
          if (typeof override.marker === 'string') {
            registry[name].marker = override.marker;
          }
          if (override.messages && typeof override.messages === 'object') {
            for (const slot of FEATURE_MESSAGE_SLOTS) {
              const val = override.messages[slot];
              if (typeof val === 'string' && val.trim()) {
                getOverrides(name)[slot] = val;
              } else if (val === null || val === '') {
                getOverrides(name)[slot] = null;
              }
            }
          }
        }
      }
    }
  } catch (err) {
    logger.warn({ err }, 'Failed to load feature flag options from disk');
  }
}

// Backward-compatible boolean toggle map derived from registry availability.
function flagEnabled(name) {
  return registry[name] ? registry[name].status === 'available' : false;
}

function save() {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    // Persist only the overridable fields for each feature.
    const payload = {};
    for (const name of Object.keys(FEATURES)) {
      const overrides = registry[name].messageOverrides || {};
      payload[name] = {
        status: registry[name].status,
        marker: registry[name].marker,
        messages: {
          unavailable: overrides.unavailable !== undefined ? overrides.unavailable : null,
          notifyPrompt: overrides.notifyPrompt !== undefined ? overrides.notifyPrompt : null,
          info: overrides.info !== undefined ? overrides.info : null
        }
      };
    }
    fs.writeFileSync(FLAGS_FILE, JSON.stringify(payload, null, 2));
  } catch (err) {
    logger.warn({ err }, 'Failed to save feature flag options to disk');
  }
}

load();

export function isFeatureEnabled(featureName) {
  return flagEnabled(featureName);
}

/**
 * Backward-compatible toggle. Only takes effect for known features.
 * Switching to `false` maps to 'unavailable', true maps to 'available'.
 */
export function setFeature(featureName, enabled) {
  if (!(featureName in FEATURES)) return false;
  registry[featureName].status = enabled ? 'available' : 'unavailable';
  save();
  return true;
}

/**
 * Backward-compatible map of { name: boolean-available }.
 */
export function getAllFeatures() {
  const out = {};
  for (const name of Object.keys(FEATURES)) {
    out[name] = flagEnabled(name);
  }
  return out;
}

export function getDefaultFeatures() {
  const out = {};
  for (const name of Object.keys(FEATURES)) {
    out[name] = FEATURES[name].status === 'available';
  }
  return out;
}

// ---------------------------------------------------------------------------
// New registry API
// ---------------------------------------------------------------------------

export function getDefaultFeatureDefs() {
  return deepClone(FEATURES);
}

export function getFeatureDefs() {
  return deepClone(registry);
}

export function getFeature(name) {
  if (!(name in registry)) return null;
  const def = registry[name];
  return {
    label: def.label,
    labelKey: def.labelKey,
    prefix: def.prefix,
    status: def.status,
    marker: effectiveMarker(def.status, def.marker),
    path: def.path,
    enabled: def.status === 'available',
    isSubmenu: def.isSubmenu === true,
    children: Array.isArray(def.children) ? [...def.children] : []
  };
}

export function getFeatureNames() {
  return Object.keys(FEATURES);
}

export function setFeatureStatus(name, status) {
  if (!(name in registry)) return false;
  if (!FEATURE_STATUSES.includes(status)) return false;
  registry[name].status = status;
  save();
  return true;
}

/**
 * Set the marker for a feature. Pass '' to remove the marker entirely
 * (nothing is displayed), or null/undefined to fall back to the status
 * default marker.
 * @param {string} name
 * @param {string} marker
 * @returns {boolean}
 */
export function setFeatureMarker(name, marker) {
  if (!(name in registry)) return false;
  if (typeof marker !== 'string') return false;
  registry[name].marker = marker;
  save();
  return true;
}

export function clearFeatureMarker(name) {
  return setFeatureMarker(name, '');
}

/**
 * Set or restore markers for every feature with the given status.
 * @param {string} status
 * @param {boolean} enabled
 * @returns {number} number of matching features updated
 */
export function setMarkersByStatus(status, enabled) {
  if (!FEATURE_STATUSES.includes(status)) return 0;
  let updated = 0;
  for (const name of Object.keys(FEATURES)) {
    if (registry[name].status !== status) continue;
    registry[name].marker = enabled ? defaultMarkerForStatus(status) : '';
    updated++;
  }
  if (updated > 0) save();
  return updated;
}

export function setMarkerByStatus(status, marker) {
  if (!FEATURE_STATUSES.includes(status) || typeof marker !== 'string') return 0;
  let updated = 0;
  for (const name of Object.keys(FEATURES)) {
    if (registry[name].status !== status) continue;
    registry[name].marker = marker;
    updated++;
  }
  if (updated > 0) save();
  return updated;
}

export function hasVisibleMarkersByStatus(status) {
  return Object.keys(FEATURES).some((name) =>
    registry[name].status === status && effectiveMarker(status, registry[name].marker)
  );
}

/**
 * Set (or clear with null) a custom message override for a feature slot.
 * @param {string} name
 * @param {string} slot - one of FEATURE_MESSAGE_SLOTS
 * @param {string|null} text
 * @returns {boolean}
 */
export function setFeatureMessage(name, slot, text) {
  if (!(name in registry)) return false;
  if (!FEATURE_MESSAGE_SLOTS.includes(slot)) return false;
  if (typeof text !== 'string' && text !== null) return false;
  if (typeof text === 'string' && !text.trim() && text !== '') text = null;
  getOverrides(name)[slot] = text;
  save();
  return true;
}

/**
 * Resolve the message shown for a feature slot: the admin override if set,
 * otherwise the localized default.
 * @param {string} name
 * @param {string} slot - unavailable | notifyPrompt | info
 * @param {string} language
 * @returns {string}
 */
export function getFeatureMessage(name, slot, language) {
  if (!(name in registry)) return '';
  const override = getOverrides(name)[slot];
  if (typeof override === 'string' && override.trim()) return override;
  if (slot === 'unavailable') {
    return t(language, defaultUnavailableKey(registry[name].status));
  }
  if (slot === 'notifyPrompt') return t(language, 'feature.notifyPrompt');
  if (slot === 'info') return t(language, 'feature.info');
  return '';
}

/**
 * True when the feature has a custom override for the given slot.
 * @param {string} name
 * @param {string} slot
 * @returns {boolean}
 */
export function hasCustomMessage(name, slot) {
  if (!(name in registry)) return false;
  const override = getOverrides(name)[slot];
  return typeof override === 'string' && override.trim() !== '';
}

/**
 * Snapshot of the current custom message overrides for a feature
 * ({ slot: string | null }). Used when building a scheduled change payload.
 * @param {string} name
 * @returns {object|null}
 */
export function getFeatureMessageOverrides(name) {
  if (!(name in registry)) return null;
  const o = registry[name].messageOverrides || {};
  return {
    unavailable: o.unavailable !== undefined ? o.unavailable : null,
    notifyPrompt: o.notifyPrompt !== undefined ? o.notifyPrompt : null,
    info: o.info !== undefined ? o.info : null
  };
}

export function getEffectiveMarker(name) {
  if (!(name in registry)) return defaultMarkerForStatus('unavailable');
  return effectiveMarker(registry[name].status, registry[name].marker);
}

/**
 * Localized label for a feature (admin lists, notifications).
 * @param {string} language
 * @param {string} name
 * @returns {string}
 */
export function getFeatureLabel(language, name) {
  if (!(name in registry)) return name;
  const key = registry[name].labelKey;
  if (!key) return name;
  const label = t(language, key);
  return label === key ? name : label;
}