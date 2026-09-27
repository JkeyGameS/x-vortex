import { getFeature } from '../services/featureFlagService.js';

/**
 * Marker string for a menu option's feature (e.g. '✅', '🔅', '').
 * - No featureId → ''.
 * - Unknown feature id → ''.
 * - Otherwise the feature's effective marker (respects admin removal;
 *   unavailable features still show their marker).
 */
export function getOptionMarker(featureId) {
  if (featureId === undefined || featureId === null) return '';
  try {
    const feature = getFeature(featureId);
    if (!feature) return '';
    return feature.marker || '';
  } catch {
    return '';
  }
}

/**
 * Whether the option's feature is available.
 * - No featureId → true.
 * - Unknown feature id → false.
 * Unavailable options stay selectable; the unavailable flow handles them.
 */
export function isOptionAvailable(featureId) {
  if (featureId === undefined || featureId === null) return true;
  try {
    const feature = getFeature(featureId);
    if (!feature) return false;
    return feature.status === 'available';
  } catch {
    return false;
  }
}
