// Feedback main menu (Phase 7). Per-user note sub-lines (last rating,
// bug/suggestion counts) come from dynamicOptions (verbatim legacy logic).
import { getLastRating, getUserFeedbackCounts } from '../../services/feedbackService.js';
import { t } from '../../services/localeService.js';
import { toSmallCaps } from '../../utils/smallCaps.js';

const L = (language, key) => toSmallCaps(t(language, key));

function buildFeedbackOptions(user, language) {
  const userId = user?.jid || user?.sender || null;
  const notes = { 1: [], 2: [], 3: [] };
  if (userId) {
    try {
      const last = getLastRating(userId);
      if (last) notes[1].push(`   ${L(language, 'feedback.lastRating')}: ${last.rating} ⭐`);
      const counts = getUserFeedbackCounts(userId);
      if (counts.bugs > 0) {
        const word = counts.bugs === 1 ? t(language, 'feedback.bugReport') : t(language, 'feedback.bugReports');
        notes[2].push(`   ${counts.bugs} ${toSmallCaps(word)}`);
      }
      if (counts.suggestions > 0) {
        const word = counts.suggestions === 1 ? t(language, 'feedback.suggestion') : t(language, 'feedback.suggestions');
        notes[3].push(`   ${counts.suggestions} ${toSmallCaps(word)}`);
      }
    } catch { /* notes stay empty */ }
  }
  const opt = (number, key, emoji, action, oldKey) => ({
    number, labelKey: `menu.feedback.${key}`, emoji, action, fallbackKey: oldKey, appendLines: notes[number] || []
  });
  return [
    opt('1', 'rate', '⭐', 'custom:fb_rate', 'feedback.optionRate'),
    opt('2', 'bug', '🐛', 'custom:fb_bug', 'feedback.optionBug'),
    opt('3', 'suggestion', '💡', 'custom:fb_suggest', 'feedback.optionSuggest'),
    opt('4', 'contact', '📧', 'custom:fb_contact', 'feedback.optionContact'),
    opt('5', 'history', '📜', 'custom:fb_history', 'feedback.optionHistory')
  ];
}

export default {
  id: 'feedback',
  headingKey: 'menu.feedback.heading',
  headingEmoji: '📮',
  standaloneCommand: '/feedback',
  aliases: ['/fb'],
  parent: 'main_menu',
  backTo: 'main_menu',
  footerKey: 'menu.feedback.footer',
  footerItalic: false,
  fallbackHeadingKey: 'feedback.title',
  fallbackFooterKey: 'feedback.replyPrompt',
  transitionKey: 'main_to_feedback',
  sessionMenu: 'feedback_main',
  dynamicOptions: (user, language) => buildFeedbackOptions(user, language),
  options: []
};
