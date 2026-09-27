import config from '../config/config.js';
import logger from '../utils/logger.js';
import { sendText, sendError } from '../services/messageService.js';
import { t } from '../services/localeService.js';
import { toSmallCaps } from '../utils/smallCaps.js';
import { buildMenu } from '../utils/menuBuilder.js';
import { addError } from '../services/errorLogService.js';
import { logAdminAction } from '../services/adminLogService.js';
import { getUserByJidSync } from '../services/userService.js';
import * as featureFlagService from '../services/featureFlagService.js';
import * as featureScheduleService from '../services/featureScheduleService.js';
import { sendFeatureFlagsPanel } from './adminCommand.js';

function isAdmin(sender) {
  return (config.adminJids || []).includes(sender);
}

function resolveLanguage(sender) {
  try {
    const u = getUserByJidSync(sender) || {};
    return u.language || config.defaultLanguage;
  } catch {
    return config.defaultLanguage;
  }
}

function featureLabel(language, featureName) {
  return featureFlagService.getFeatureLabel(language, featureName);
}

function featureStatusLabel(language, status) {
  return t(language, 'admin.featureStatus.' + status);
}

// Build a simple localized list message for `/features list`.
// Format: `N. {prefix} {label} {marker}` — status is indicated by the marker.
function cleanFeatureLabel(label) {
  if (typeof label !== 'string') return label;
  return label.replace(/^[^\p{L}\p{N}]+/u, '').trim();
}

function buildListing(language) {
  const lines = featureFlagService.getFeatureNames().map((name, i) => {
    const feat = featureFlagService.getFeature(name);
    const prefix = feat.prefix ? feat.prefix + ' ' : '';
    const marker = feat.marker ? ' ' + feat.marker : '';
    return `${i + 1}. ${prefix}${cleanFeatureLabel(featureLabel(language, name))}${marker}`;
  });
  return buildMenu('📋 ' + toSmallCaps(t(language, 'admin.flags.listTitle')), '', lines);
}

export const command = {
  name: 'features',
  description: 'Manage bot features (owner/admin/moderator)',
  usage: '/features [list | toggle <featureId> <status> | marker <featureId> <marker>]',
  aliases: ['feature'],
  adminOnly: true,
  groupAllowed: false,
  async execute(context) {
    const sender = context.sender;
    const language = resolveLanguage(sender);
    const args = context.args || [];

    try {
      const { hasPermission } = await import('../services/rolesService.js');
      if (!isAdmin(sender) && !hasPermission(sender, 'features')) {
        return sendText(context.sock, sender, toSmallCaps(t(language, 'common.notAuthorized')));
      }

      // No arguments: open the Feature Management menu.
      if (args.length === 0) {
        return sendFeatureFlagsPanel(context, { transitionKey: 'system_to_flags' });
      }

      const sub = String(args[0]).toLowerCase();

      if (sub === 'list') {
        return sendText(context.sock, sender, buildListing(language));
      }

      if (sub === 'toggle' && args.length >= 3) {
        const name = String(args[1]).trim();
        const status = String(args[2]).toLowerCase();
        if (!featureFlagService.getFeature(name)) {
          return sendText(context.sock, sender, toSmallCaps(t(language, 'admin.flags.noFeature')) + ': ' + name);
        }
        if (!['available', 'unavailable', 'coming_soon', 'maintenance'].includes(status)) {
          return sendText(context.sock, sender, toSmallCaps(t(language, 'admin.flags.invalidStatus')) + ': ' + status);
        }
        const prev = featureFlagService.getFeature(name).status;
        featureFlagService.setFeatureStatus(name, status);
        logAdminAction(sender, 'feature_status', (name + ' → ' + status));
        if (status === 'available' && prev !== 'available') {
          await featureScheduleService.notifyFeatureAvailable(name);
        }
        const msg = t(language, 'admin.flags.statusChanged') + ': ' +
          toSmallCaps(featureLabel(language, name)) + ' → ' +
          toSmallCaps(featureStatusLabel(language, status));
        return sendText(context.sock, sender, toSmallCaps(msg));
      }

      if (sub === 'marker' && args.length >= 3) {
        const name = String(args[1]).trim();
        const markerArg = String(args[2]).trim().toLowerCase();
        if (!featureFlagService.getFeature(name)) {
          return sendText(context.sock, sender, toSmallCaps(t(language, 'admin.flags.noFeature')) + ': ' + name);
        }
        if (markerArg === 'remove') {
          featureFlagService.clearFeatureMarker(name);
          logAdminAction(sender, 'feature_marker', (name + ' → (removed)'));
          const msg = t(language, 'admin.flags.markerRemoved') + ': ' +
            toSmallCaps(featureLabel(language, name));
          return sendText(context.sock, sender, toSmallCaps(msg));
        }
        const marker = String(args[2]).trim();
        if (!marker) {
          return sendText(context.sock, sender, toSmallCaps(t(language, 'common.invalidChoice')));
        }
        featureFlagService.setFeatureMarker(name, marker);
        logAdminAction(sender, 'feature_marker', (name + ' → ' + marker));
        const msg = t(language, 'admin.flags.markerChanged') + ': ' +
          toSmallCaps(featureLabel(language, name)) + ' → ' + marker;
        return sendText(context.sock, sender, toSmallCaps(msg));
      }

      // Unknown / malformed: fall back to the menu.
      return sendFeatureFlagsPanel(context, { transitionKey: 'system_to_flags' });
    } catch (error) {
      addError(error);
      logger.error({ err: error, sender, action: 'features_command' }, '[ADMIN] /features failed');
      await sendError(context.sock, sender, 'Failed to manage features.');
      throw error;
    }
  }
};