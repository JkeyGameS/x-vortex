// Admin-side action for the welcome-back toggle.
//
// The flip lives in adminCommand.js alongside the rest of the General Settings
// options, which builds that menu inline. This thin module exists so the
// config-driven menu resolver (menuCustomHandlers) can reach the same code
// without menuCustomHandlers growing its own settings logic -- the two paths
// must never disagree about the stored value.
import { handleGeneralSettingsReply } from './adminCommand.js';

export async function handleWelcomeBackToggle(context) {
  return handleGeneralSettingsReply(context, '9');
}