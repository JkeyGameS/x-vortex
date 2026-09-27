import { menus } from '../../menuConfig.js';
import { getFeature } from '../../../services/featureFlagService.js';

// markerFromFeature → menu key fragment:
// profileName → name, profileUsername → username, ...
const SUFFIX_BY_FEATURE = {
  profileName: 'name',
  profileUsername: 'username',
  profileBio: 'bio',
  profileTimezone: 'timezone',
  profilePicture: 'picture',
  profileCountry: 'country',
  profileBirthday: 'birthday'
};

function buildEditOptionsStable() {
  const all = menus.profile_edit.options;
  const available = all.filter((option) => getFeature(option.markerFromFeature)?.status === 'available');
  const mapped = available.map((option, index) => {
    const suffix = SUFFIX_BY_FEATURE[option.markerFromFeature] || option.markerFromFeature;
    return {
      number: String(index + 1),
      labelKey: `menu.edit_profile.${suffix}`,
      emoji: option.prefix || null,
      action: `custom:dispatch_edit_${suffix}`,
      featureId: option.markerFromFeature,
      fallbackKey: option.labelKey
    };
  });
  if (available.length < all.length) {
    mapped.push({
      number: String(available.length + 1),
      labelKey: 'menu.edit_profile.advanced',
      emoji: '🔒',
      action: 'open:edit_profile_advanced',
      fallbackKey: 'preferences.advancedOptions'
    });
  }
  return mapped;
}

export default {
  id: 'edit_profile',
  headingKey: 'menu.edit_profile.heading',
  headingEmoji: null,
  standaloneCommand: null,
  aliases: [],
  parent: 'profile',
  backTo: 'profile',
  footerKey: 'menu.edit_profile.footer',
  footerItalic: false,
  fallbackHeadingKey: 'profile.editTitle',
  fallbackFooterKey: 'profile.replyPrompt',
  showMarkers: false,
  dynamicOptions: () => buildEditOptionsStable(),
  options: []
};

export { buildEditOptionsStable as buildEditOptions };
