import { toSmallCaps } from '../utils/smallCaps.js';
import { t } from '../services/localeService.js';
import { getEffectiveMarker } from '../services/featureFlagService.js';

// Localized confirmation prompt helper. `data.language` is injected by
// confirmationHelper.askConfirmation, so prompts render in the user's language.
function L(data, key, params = {}) {
  return toSmallCaps(t(data.language, key, params));
}

export const menuTransitions = {
  // Main menu
  main_menu: { mode: 'edit', storeKey: true },
  main_to_main: { mode: 'delete_send', storeKey: true },
  main_to_exit: { mode: 'delete_send', storeKey: false },
  main_to_profile: { mode: 'edit', storeKey: true },
  profile_submenu: { mode: 'edit', storeKey: true },
  profile_to_main: { mode: 'delete_send', storeKey: true },
  profile_to_edit: { mode: 'edit', storeKey: true },
  profile_edit: { mode: 'edit', storeKey: true },
  profile_edit_advanced: { mode: 'edit', storeKey: true },
  profile_edit_to_profile: { mode: 'delete_send', storeKey: true },
  profile_name_input: { mode: 'edit', storeKey: true },
  profile_username_input: { mode: 'edit', storeKey: true },
  profile_confirmation: { mode: 'edit', storeKey: true },
  profile_confirmation_no: { mode: 'delete_send', storeKey: true },
  profile_confirmation_done: { mode: 'delete_send', storeKey: true },
  profile_to_stats: { mode: 'edit', storeKey: true },
  stats_submenu: { mode: 'edit', storeKey: true },
  stats_to_profile: { mode: 'delete_send', storeKey: true },
  profile_to_preferences: { mode: 'edit', storeKey: true },
  preferences_submenu: { mode: 'edit', storeKey: true },
  preferences_advanced: { mode: 'edit', storeKey: true },
  pref_typing: { mode: 'edit', storeKey: true },
  pref_typing_mode: { mode: 'edit', storeKey: true },
  pref_typing_delay: { mode: 'edit', storeKey: true },
  pref_typing_delay_custom: { mode: 'edit', storeKey: true },
  pref_typing_type: { mode: 'edit', storeKey: true },
  pref_typing_advanced: { mode: 'edit', storeKey: true },
  message_settings: { mode: 'edit', storeKey: true },
  self_destruct_unit: { mode: 'edit', storeKey: true },
  self_destruct_custom_time: { mode: 'edit', storeKey: true },
  self_destruct_duration: { mode: 'edit', storeKey: true },
  self_destruct_repetition: { mode: 'edit', storeKey: true },
  self_destruct_custom: { mode: 'edit', storeKey: true },
  self_destruct_confirm: { mode: 'edit', storeKey: true },
  native_disappearing: { mode: 'edit', storeKey: true },
  preferences_to_profile: { mode: 'delete_send', storeKey: true },
  preferences_to_language: { mode: 'edit', storeKey: true },
  preferences_placeholder: { mode: 'edit', storeKey: true },
  preferences_language_back: { mode: 'edit', storeKey: true },
  language_selection_back: { mode: 'edit', storeKey: true },
  preferences_language_done: { mode: 'delete_send', storeKey: true },
  profile_to_copyid: { mode: 'delete_send', storeKey: true },
  main_to_settings: { mode: 'edit', storeKey: true },
  tutorial_main: { mode: 'edit', storeKey: true },
  tutorial_getting_started: { mode: 'edit', storeKey: true },
  tutorial_commands: { mode: 'edit', storeKey: true },
  tutorial_profile_guide: { mode: 'edit', storeKey: true },
  tutorial_settings: { mode: 'edit', storeKey: true },
  tutorial_selfdestruct: { mode: 'edit', storeKey: true },
  tutorial_feedback: { mode: 'edit', storeKey: true },
  tutorial_quick_tips: { mode: 'edit', storeKey: true },
  tutorial_what_new: { mode: 'edit', storeKey: true },
  tutorial_search_prompt: { mode: 'edit', storeKey: true },
  tutorial_search_results: { mode: 'edit', storeKey: true },
  tutorial_to_main: { mode: 'delete_send', storeKey: true },

  // Language / onboarding
  language_selection: { mode: 'delete_send', storeKey: true },
  lang_command_active: { mode: 'delete_send', storeKey: true },
  lang_command_new: { mode: 'new', storeKey: true },
  try_onboarding: { mode: 'new', storeKey: true },
  language_to_main: { mode: 'new', storeKey: true },
  language_confirmation: { mode: 'delete_send', storeKey: false },

  // Admin panel
  main_to_admin: { mode: 'delete_send', storeKey: true },
  admin_to_users: { mode: 'edit', storeKey: true },
  users_to_admin: { mode: 'delete_send', storeKey: true },
  admin_to_chat_faq: { mode: 'edit', storeKey: true },
  chat_faq_to_admin: { mode: 'delete_send', storeKey: true },
  admin_to_logs: { mode: 'edit', storeKey: true },
  logs_to_admin: { mode: 'delete_send', storeKey: true },
  admin_to_errors: { mode: 'edit', storeKey: true },
  admin_panel: { mode: 'edit', storeKey: true },
  admin_to_main: { mode: 'edit_or_new', storeKey: true },
  admin_return: { mode: 'delete_send', storeKey: true },
  admin_to_test: { mode: 'delete_send', storeKey: true },
  test_submenu: { mode: 'edit', storeKey: true },
  try_timer: { mode: 'edit', storeKey: true },
  try_timer_custom: { mode: 'edit', storeKey: true },
  try_timer_confirmation: { mode: 'edit', storeKey: true },
  try_end: { mode: 'edit', storeKey: true },
  test_to_admin: { mode: 'delete_send', storeKey: true },
  test_return: { mode: 'delete_send', storeKey: true },

  // Backup & Restore submenu (admin)
  admin_to_backup: { mode: 'delete_send', storeKey: true },
  backup_restore: { mode: 'edit', storeKey: true },
  backup_to_admin: { mode: 'delete_send', storeKey: true },
  restore_input: { mode: 'delete_send', storeKey: true },

  // System Settings submenu (admin)
  admin_to_system: { mode: 'delete_send', storeKey: true },
  system_settings: { mode: 'edit', storeKey: true },
  system_general: { mode: 'edit', storeKey: true },
  system_admins: { mode: 'edit', storeKey: true },
  system_admin_add: { mode: 'edit', storeKey: true },
  system_admin_remove: { mode: 'edit', storeKey: true },
  system_admin_remove_confirm: { mode: 'edit', storeKey: true },
  system_notifications: { mode: 'edit', storeKey: true },
  system_updates: { mode: 'edit', storeKey: true },
  system_data: { mode: 'edit', storeKey: true },
  system_logs: { mode: 'edit', storeKey: true },
  system_return: { mode: 'delete_send', storeKey: true },
  system_to_admin: { mode: 'delete_send', storeKey: true },
  system_name_input: { mode: 'edit', storeKey: true },

  // Conversation Chat submenu (admin)
  system_to_conversation: { mode: 'delete_send', storeKey: true },
  conversation_settings: { mode: 'edit', storeKey: true },
  conversation_to_system: { mode: 'delete_send', storeKey: true },
  conversation_temp_duration: { mode: 'edit', storeKey: true },
  conversation_temp_custom: { mode: 'edit', storeKey: true },
  conversation_notify_list: { mode: 'edit', storeKey: true },

  // Chat-related preferences (user): notification opt-in when chat is off
  chat_notify: { mode: 'edit', storeKey: true },

  // Onboarding intro -> main menu (user)
  onboarding_to_main: { mode: 'new', storeKey: true },

  // Feature Flags submenu (admin)
  system_to_flags: { mode: 'delete_send', storeKey: true },
  feature_flags: { mode: 'edit', storeKey: true },
  change_marker_scope: { mode: 'edit', storeKey: true },
  marker_nav: { mode: 'edit', storeKey: true },
  marker_submenu_action: { mode: 'edit', storeKey: true },
  marker_picker: { mode: 'edit', storeKey: true },
  marker_change_confirm: { mode: 'edit', storeKey: true },
  marker_custom_input: { mode: 'edit', storeKey: true },
  change_marker_status_list: { mode: 'edit', storeKey: true },
  change_marker_bulk_confirm: { mode: 'edit', storeKey: true },
  change_marker_value: { mode: 'edit', storeKey: true },
  change_marker_custom_input: { mode: 'edit', storeKey: true },
  change_marker_bulk_confirm_value: { mode: 'edit', storeKey: true },
  status_change: { mode: 'edit', storeKey: true },
  status_confirm: { mode: 'edit', storeKey: true },
  flags_to_system: { mode: 'delete_send', storeKey: true },

  // Error Log viewer (admin)
  system_to_errors: { mode: 'delete_send', storeKey: true },
  error_log: { mode: 'edit', storeKey: true },

  // Broadcast input prompt (admin)
  broadcast_input: { mode: 'edit', storeKey: true },

  // Broadcast submenu + scheduling + templates (admin)
  admin_to_broadcast: { mode: 'edit', storeKey: true },
  broadcast_submenu: { mode: 'edit', storeKey: true },
  broadcast_to_admin: { mode: 'delete_send', storeKey: true },
  broadcast_schedule_text: { mode: 'edit', storeKey: true },
  broadcast_schedule_time: { mode: 'edit', storeKey: true },
  broadcast_schedule_manual: { mode: 'edit', storeKey: true },
  broadcast_schedule_repeat: { mode: 'edit', storeKey: true },
  broadcast_schedule_empty: { mode: 'edit', storeKey: true },
  broadcast_schedule: { mode: 'edit', storeKey: true },
  broadcast_to_schedule: { mode: 'delete_send', storeKey: true },
  schedule_to_broadcast: { mode: 'delete_send', storeKey: true },
  broadcast_schedule_list: { mode: 'edit', storeKey: true },
  broadcast_schedule_detail: { mode: 'edit', storeKey: true },
  broadcast_schedule_edit: { mode: 'edit', storeKey: true },
  broadcast_schedule_edit_message: { mode: 'edit', storeKey: true },
  broadcast_to_templates: { mode: 'edit', storeKey: true },
  templates: { mode: 'edit', storeKey: true },
  templates_to_broadcast: { mode: 'delete_send', storeKey: true },
  template_use_list: { mode: 'edit', storeKey: true },
  template_preview: { mode: 'edit', storeKey: true },
  template_edit: { mode: 'edit', storeKey: true },
  template_save_name: { mode: 'edit', storeKey: true },
  template_save_text: { mode: 'edit', storeKey: true },
  template_delete_list: { mode: 'edit', storeKey: true },

  // Command analytics (admin)
  command_analytics: { mode: 'edit', storeKey: true },

  // Blocked users submenu (admin)
  admin_to_blocked: { mode: 'edit', storeKey: true },
  blocked_submenu: { mode: 'edit', storeKey: true },
  blocked_to_admin: { mode: 'delete_send', storeKey: true },
  blocked_block_jid: { mode: 'edit', storeKey: true },
  blocked_block_reason: { mode: 'edit', storeKey: true },
  blocked_unblock_jid: { mode: 'edit', storeKey: true },

  // Confirmation system
  confirmation: { mode: 'edit', storeKey: true },
  confirmation_cancel: { mode: 'delete_send', storeKey: false },
  confirmation_done: { mode: 'delete_send', storeKey: true },

  // Feature unavailable submenu + notify/info flows
  feature_unavailable: { mode: 'edit', storeKey: true },
  feature_notify_toggle: { mode: 'edit', storeKey: true },
  feature_notify_result: { mode: 'edit', storeKey: true },
  feature_info: { mode: 'edit', storeKey: true },
  sleep_confirm: { mode: 'delete_send', storeKey: true },
  sleep_animation: { mode: 'edit_or_new', storeKey: true },
  sleep_final_edit_or_new: { mode: 'edit_or_new', storeKey: true },
  sleep_final: { mode: 'edit_or_new', storeKey: true },
  wake_animation: { mode: 'delete_send', storeKey: true },

  // Inline help
  help_show: { mode: 'edit', storeKey: true },
  help_back: { mode: 'edit', storeKey: true },

  // User management bulk actions + segments
  user_management_bulk: { mode: 'edit', storeKey: true },
  user_management_bulk_filter: { mode: 'edit', storeKey: true },
  user_management_bulk_param: { mode: 'edit', storeKey: true },
  user_management_bulk_message: { mode: 'edit', storeKey: true },
  user_management_bulk_preview: { mode: 'edit', storeKey: true },
  user_management_segments: { mode: 'edit', storeKey: true },
  user_management_segment_name: { mode: 'edit', storeKey: true },
  user_management_segment_filter: { mode: 'edit', storeKey: true },
  user_management_segment_param: { mode: 'edit', storeKey: true },
  user_management_segment_delete: { mode: 'edit', storeKey: true },
  user_management_segment_delete_confirm: { mode: 'edit', storeKey: true },
  user_management_segment_broadcast: { mode: 'edit', storeKey: true },
  user_management_segment_msg: { mode: 'edit', storeKey: true },
  user_management_segment_confirm: { mode: 'edit', storeKey: true },

  // Maintenance scheduling
  maint_menu: { mode: 'edit', storeKey: true },
  maint_schedule_time: { mode: 'edit', storeKey: true },
  maint_windows: { mode: 'edit', storeKey: true },
  maint_window_detail: { mode: 'edit', storeKey: true },

  // Analytics detail views
  command_analytics_top: { mode: 'edit', storeKey: true },
  command_analytics_response: { mode: 'edit', storeKey: true },

  // Admin overview: quick actions, search, scheduled tasks, emergency, roles
  admin_quick_actions: { mode: 'edit', storeKey: true },
  admin_quick_confirm: { mode: 'edit', storeKey: true },
  admin_search: { mode: 'edit', storeKey: true },
  admin_search_results: { mode: 'edit', storeKey: true },
  admin_search_detail: { mode: 'edit', storeKey: true },
  admin_scheduled_tasks: { mode: 'edit', storeKey: true },
  admin_scheduled_detail: { mode: 'edit', storeKey: true },
  admin_emergency: { mode: 'edit', storeKey: true },
  admin_emergency_confirm: { mode: 'edit', storeKey: true },
  admin_roles: { mode: 'edit', storeKey: true },
  admin_roles_user: { mode: 'edit', storeKey: true },
  admin_roles_set: { mode: 'edit', storeKey: true },

  // Info section (main menu option 5)
  main_to_info: { mode: 'edit', storeKey: true },
  info_menu: { mode: 'edit', storeKey: true },
  info_to_about: { mode: 'edit', storeKey: true },
  info_to_version: { mode: 'edit', storeKey: true },
  info_to_developer: { mode: 'edit', storeKey: true },
  info_to_website: { mode: 'edit', storeKey: true },
  info_back_to_main: { mode: 'delete_send', storeKey: true },

  // Statistics section (main menu option 3)
  main_to_stats: { mode: 'edit', storeKey: true },
  stats_menu: { mode: 'edit', storeKey: true },
  stats_to_my: { mode: 'edit', storeKey: true },
  stats_to_top: { mode: 'edit', storeKey: true },
  stats_to_users: { mode: 'edit', storeKey: true },
  stats_to_feedback: { mode: 'edit', storeKey: true },
  stats_to_advanced: { mode: 'edit', storeKey: true },
  stats_to_advanced_detail: { mode: 'edit', storeKey: true },
  stats_to_feedback_admin: { mode: 'delete_send', storeKey: true },
  stats_back_to_main: { mode: 'delete_send', storeKey: true },

  // Feedback section (main menu option 6)
  main_to_feedback: { mode: 'edit', storeKey: true },
  feedback_menu: { mode: 'edit', storeKey: true },
  feedback_to_rating: { mode: 'edit', storeKey: true },
  feedback_to_bug: { mode: 'edit', storeKey: true },
  feedback_to_suggestion: { mode: 'edit', storeKey: true },
  feedback_to_contact: { mode: 'edit', storeKey: true },
  feedback_to_history: { mode: 'edit', storeKey: true },
  feedback_history_detail: { mode: 'edit', storeKey: true },
  feedback_rating_confirm: { mode: 'edit', storeKey: true },
  feedback_rating_motivation: { mode: 'edit', storeKey: true },
  feedback_back_to_main: { mode: 'delete_send', storeKey: true },

  // Feedback admin management (/feedback, admin only)
  feedback_admin: { mode: 'edit', storeKey: true },
  feedback_admin_view: { mode: 'edit', storeKey: true },
  feedback_admin_search: { mode: 'edit', storeKey: true },
  feedback_admin_delete: { mode: 'edit', storeKey: true },
  feedback_admin_type: { mode: 'edit', storeKey: true },
  feedback_admin_detail: { mode: 'edit', storeKey: true },
  feedback_admin_reply: { mode: 'edit', storeKey: true },
  feedback_admin_presets: { mode: 'edit', storeKey: true },

  // Main menu -> global help (edit/delete+send, reuse the edit mode)
  menu_to_help: { mode: 'edit', storeKey: true },

  // Global help navigation
  help_to_help_page: { mode: 'edit', storeKey: true },
  help_back_to_main: { mode: 'delete_send', storeKey: true },
  help_cancel: { mode: 'delete_send', storeKey: false },

  // Chat & FAQ hub (admin)
  chat_faq_menu: { mode: 'edit', storeKey: true },
  chat_rule_edit: { mode: 'edit', storeKey: true },
  chat_rule_delete: { mode: 'edit', storeKey: true },
  chat_rule_toggle: { mode: 'edit', storeKey: true },
  chat_add_rule: { mode: 'edit', storeKey: true },
  chat_create_from_example: { mode: 'edit', storeKey: true },
  chat_create_from_example_reply: { mode: 'edit', storeKey: true },
  chat_multi_language_add: { mode: 'edit', storeKey: true },
  chat_multilang_reply_input: { mode: 'edit', storeKey: true },
  chat_drafts: { mode: 'edit', storeKey: true },
  chat_draft_detail: { mode: 'edit', storeKey: true },
  chat_draft_delete: { mode: 'edit', storeKey: true },
  chat_draft_save: { mode: 'edit', storeKey: true },
  chat_duplicate_confirm: { mode: 'edit', storeKey: true },
  chat_exit_confirm: { mode: 'edit', storeKey: true },
  chat_recent_favorites: { mode: 'edit', storeKey: true },
  chat_unmatched_detail: { mode: 'edit', storeKey: true },
  faq_list: { mode: 'edit', storeKey: true },
  faq_edit_select: { mode: 'edit', storeKey: true },
  faq_delete_select: { mode: 'edit', storeKey: true },
  faq_toggle_select: { mode: 'edit', storeKey: true },
  chat_stats: { mode: 'edit', storeKey: true },
  chat_import_export: { mode: 'edit', storeKey: true },
  chat_ie_import: { mode: 'edit', storeKey: true },
  chat_ie_policy: { mode: 'edit', storeKey: true },
  chat_test_panel: { mode: 'edit', storeKey: true },
  chat_test_select: { mode: 'edit', storeKey: true },
  chat_test_result: { mode: 'edit', storeKey: true },
  chat_bulk_confirm: { mode: 'edit', storeKey: true },
  chat_filter_language: { mode: 'edit', storeKey: true },
  chat_duplicate_select: { mode: 'edit', storeKey: true },
  chat_duplicate_language: { mode: 'edit', storeKey: true },
  faq_test_select: { mode: 'edit', storeKey: true },
  faq_test_result: { mode: 'edit', storeKey: true },
  chat_trigger_variations: { mode: 'edit', storeKey: true },
  chat_trigger_variations_add: { mode: 'edit', storeKey: true },
  chat_response_preview: { mode: 'edit', storeKey: true },
  chat_priority_reorder: { mode: 'edit', storeKey: true },
  chat_response_action: { mode: 'edit', storeKey: true },
  chat_add_context: { mode: 'edit', storeKey: true },
  chat_add_context_input: { mode: 'edit', storeKey: true },
  chat_add_context_confirm: { mode: 'edit', storeKey: true },
  chat_add_context_sets: { mode: 'edit', storeKey: true },
  chat_add_context_sets_input: { mode: 'edit', storeKey: true },
  chat_add_context_expiry: { mode: 'edit', storeKey: true },
  chat_edit_context: { mode: 'edit', storeKey: true },
  chat_edit_context_input: { mode: 'edit', storeKey: true },
  chat_edit_context_expiry: { mode: 'edit', storeKey: true },
  chat_settings_context_expiry: { mode: 'edit', storeKey: true },
  chat_context_registry: { mode: 'edit', storeKey: true },
  chat_cooldown: { mode: 'edit', storeKey: true },
  chat_cooldown_custom: { mode: 'edit', storeKey: true },
  chat_active_dates: { mode: 'edit', storeKey: true },
  chat_active_start: { mode: 'edit', storeKey: true },
  chat_active_end: { mode: 'edit', storeKey: true },
  faq_response_preview: { mode: 'edit', storeKey: true },
  faq_bulk_confirm: { mode: 'edit', storeKey: true },
  faq_filter_category: { mode: 'edit', storeKey: true },
  faq_duplicate_select: { mode: 'edit', storeKey: true },
  faq_duplicate_language: { mode: 'edit', storeKey: true },

  // Chat Responses submenu + wizard (admin)
  chat_quick_triggers: { mode: 'edit', storeKey: true },
  chat_quick_ai: { mode: 'edit', storeKey: true },
  chat_quick_replies: { mode: 'edit', storeKey: true },
  chat_quick_preview: { mode: 'edit', storeKey: true },
  chat_quick_language: { mode: 'edit', storeKey: true },
  chat_template_library: { mode: 'edit', storeKey: true },
  chat_template_category: { mode: 'edit', storeKey: true },
  chat_template_create_pack: { mode: 'edit', storeKey: true },
  chat_template_import_export: { mode: 'edit', storeKey: true },
  chat_template_import_confirm: { mode: 'edit', storeKey: true },
  chat_template_pack_preview: { mode: 'edit', storeKey: true },
  chat_template_language_select: { mode: 'edit', storeKey: true },
  chat_template_preview_edit: { mode: 'edit', storeKey: true },
  chat_template_preview_edit_input: { mode: 'edit', storeKey: true },
  chat_template_uninstall: { mode: 'edit', storeKey: true },
  chat_template_duplicate_confirm: { mode: 'edit', storeKey: true },
  template_featured: { mode: 'edit', storeKey: true },
  template_search: { mode: 'edit', storeKey: true },
  template_tag_filter: { mode: 'edit', storeKey: true },
  pack_updates_list: { mode: 'edit', storeKey: true },
  chat_smart_suggestions: { mode: 'edit', storeKey: true },
  chat_performance_dashboard: { mode: 'edit', storeKey: true },
  chat_reply_analytics: { mode: 'edit', storeKey: true },
  chat_reply_analytics_detail: { mode: 'edit', storeKey: true },
  chat_reply_analytics_reset: { mode: 'edit', storeKey: true },
  chat_analytics_import: { mode: 'edit', storeKey: true },
  chat_settings_context_boost: { mode: 'edit', storeKey: true },
  chat_settings_rate_limit_max: { mode: 'edit', storeKey: true },
  chat_settings_rate_limit_window: { mode: 'edit', storeKey: true },
  chat_settings_snippet_depth: { mode: 'edit', storeKey: true },
  chat_settings_typing_targeting: { mode: 'edit', storeKey: true },
  chat_settings_typing_type: { mode: 'edit', storeKey: true },
  chat_rate_limit_log: { mode: 'edit', storeKey: true },
  chat_dryrun_log: { mode: 'edit', storeKey: true },
  chat_dryrun_log_detail: { mode: 'edit', storeKey: true },
  chat_dryrun_log_clear: { mode: 'edit', storeKey: true },
  chat_bulk_toggle_lang: { mode: 'edit', storeKey: true },
  chat_bulk_toggle_category: { mode: 'edit', storeKey: true },
  chat_bulk_toggle_pack: { mode: 'edit', storeKey: true },
  chat_snapshots: { mode: 'edit', storeKey: true },
  chat_snapshot_restore: { mode: 'edit', storeKey: true },
  chat_settings: { mode: 'edit', storeKey: true },
  chat_settings_fuzzy: { mode: 'edit', storeKey: true },
  chat_settings_cooldown: { mode: 'edit', storeKey: true },
  chat_settings_fallback: { mode: 'edit', storeKey: true },
  chat_settings_priority: { mode: 'edit', storeKey: true },
  chat_settings_max_replies: { mode: 'edit', storeKey: true },
  chat_settings_ignore_list: { mode: 'edit', storeKey: true },
  chat_settings_language_filter: { mode: 'edit', storeKey: true },
  chat_settings_delay_override: { mode: 'edit', storeKey: true },
  chat_cleanup_suggestions: { mode: 'edit', storeKey: true },
  chat_cleanup_group: { mode: 'edit', storeKey: true },
  chat_bulk_add: { mode: 'edit', storeKey: true },
  chat_bulk_preview: { mode: 'edit', storeKey: true },
  chat_bulk_language: { mode: 'edit', storeKey: true },
  chat_bulk_policy: { mode: 'edit', storeKey: true },
  chat_unmatched: { mode: 'edit', storeKey: true },
  fallback_ask_admin: { mode: 'edit', storeKey: true },
  fallback_unknown: { mode: 'edit', storeKey: true },
  chat_snippets: { mode: 'edit', storeKey: true },
  chat_snippet_add: { mode: 'edit', storeKey: true },
  chat_snippet_text: { mode: 'edit', storeKey: true },
  chat_snippet_edit: { mode: 'edit', storeKey: true },
  chat_snippet_edit_text: { mode: 'edit', storeKey: true },
  chat_snippet_delete: { mode: 'edit', storeKey: true },
  chat_snippet_translate: { mode: 'edit', storeKey: true },
  chat_snippet_translate_lang: { mode: 'edit', storeKey: true },
  chat_snippet_translate_text: { mode: 'edit', storeKey: true },
  chat_snippet_impex: { mode: 'edit', storeKey: true },
  chat_snippet_import: { mode: 'edit', storeKey: true },
  chat_add_reply_snippet: { mode: 'edit', storeKey: true },
  chat_add_reply_snippet_pick: { mode: 'edit', storeKey: true },
  chat_bulk_delete: { mode: 'edit', storeKey: true },
  chat_bulk_delete_lang: { mode: 'edit', storeKey: true },
  chat_bulk_delete_category: { mode: 'edit', storeKey: true },
  chat_bulk_delete_confirm: { mode: 'edit', storeKey: true },
  chat_trash_move: { mode: 'edit', storeKey: true },
  chat_trash_move_lang: { mode: 'edit', storeKey: true },
  chat_trash_move_category: { mode: 'edit', storeKey: true },
  chat_trash: { mode: 'edit', storeKey: true },
  chat_bulk_uninstall_pack: { mode: 'edit', storeKey: true },
  chat_recent: { mode: 'edit', storeKey: true },
  chat_recent_open: { mode: 'edit', storeKey: true },
  chat_recent_add: { mode: 'edit', storeKey: true },
  chat_recent_remove: { mode: 'edit', storeKey: true },
  chat_duplicate_modify: { mode: 'edit', storeKey: true },
  admin_to_chat: { mode: 'delete_send', storeKey: true },
  chat_submenu: { mode: 'edit', storeKey: true },
  chat_responses_main: { mode: 'edit', storeKey: true },
  chat_view_rules: { mode: 'edit', storeKey: true },
  chat_view_list: { mode: 'edit', storeKey: true },
  chat_manage_rules: { mode: 'edit', storeKey: true },
  chat_search: { mode: 'edit', storeKey: true },
  chat_search_results: { mode: 'edit', storeKey: true },
  chat_rule_detail: { mode: 'edit', storeKey: true },
  chat_to_admin: { mode: 'delete_send', storeKey: true },
  chat_add_start: { mode: 'edit', storeKey: true },
  chat_add_triggers: { mode: 'edit', storeKey: true },
  chat_add_trigger_edit: { mode: 'edit', storeKey: true },
  chat_add_custom_trigger: { mode: 'edit', storeKey: true },
  chat_add_replies: { mode: 'edit', storeKey: true },
  chat_add_preview: { mode: 'edit', storeKey: true },
  chat_add_language: { mode: 'edit', storeKey: true },
  chat_add_priority: { mode: 'edit', storeKey: true },
  chat_add_style: { mode: 'edit', storeKey: true },
  chat_add_emoji: { mode: 'edit', storeKey: true },
  chat_add_another_lang: { mode: 'edit', storeKey: true },
  chat_edit_menu: { mode: 'edit', storeKey: true },
  chat_edit_triggers: { mode: 'edit', storeKey: true },
  chat_edit_replies: { mode: 'edit', storeKey: true },
  chat_edit_weights: { mode: 'edit', storeKey: true },
  chat_add_reply_tags: { mode: 'edit', storeKey: true },
  chat_edit_reply_tags: { mode: 'edit', storeKey: true },
  chat_add_reply_styles: { mode: 'edit', storeKey: true },
  chat_edit_reply_styles: { mode: 'edit', storeKey: true },
  chat_settings_followup_chance: { mode: 'edit', storeKey: true },
  chat_settings_tone_words: { mode: 'edit', storeKey: true },
  chat_edit_language: { mode: 'edit', storeKey: true },
  chat_edit_priority: { mode: 'edit', storeKey: true },
  chat_edit_style: { mode: 'edit', storeKey: true },
  chat_search_input: { mode: 'edit', storeKey: true },
  chat_import_input: { mode: 'edit', storeKey: true },

  // FAQ Knowledge Base submenu + wizard (admin)
  admin_to_faq: { mode: 'delete_send', storeKey: true },
  faq_submenu: { mode: 'edit', storeKey: true },
  faq_to_admin: { mode: 'delete_send', storeKey: true },
  faq_add_question: { mode: 'edit', storeKey: true },
  faq_add_answer: { mode: 'edit', storeKey: true },
  faq_add_keywords: { mode: 'edit', storeKey: true },
  faq_add_keywords_input: { mode: 'edit', storeKey: true },
  faq_add_category: { mode: 'edit', storeKey: true },
  faq_add_language: { mode: 'edit', storeKey: true },
  faq_add_another_lang: { mode: 'edit', storeKey: true },
  faq_edit_menu: { mode: 'edit', storeKey: true },
  faq_edit_answer: { mode: 'edit', storeKey: true },
  faq_edit_keywords: { mode: 'edit', storeKey: true },
  faq_edit_category: { mode: 'edit', storeKey: true },
  faq_edit_language: { mode: 'edit', storeKey: true },
  faq_edit_priority: { mode: 'edit', storeKey: true },
  faq_search_input: { mode: 'edit', storeKey: true },
  faq_import_input: { mode: 'edit', storeKey: true },
  faq_main: { mode: 'edit', storeKey: true },
  faq_add: { mode: 'edit', storeKey: true },
  faq_quick_add: { mode: 'edit', storeKey: true },
  faq_quick_add_keywords: { mode: 'edit', storeKey: true },
  faq_quick_add_keywords_input: { mode: 'edit', storeKey: true },
  faq_quick_add_answer: { mode: 'edit', storeKey: true },
  faq_quick_add_done: { mode: 'edit', storeKey: true },
  faq_exit_confirm: { mode: 'edit', storeKey: true },
  faq_bulk_add: { mode: 'edit', storeKey: true },
  faq_from_unmatched: { mode: 'edit', storeKey: true },
  faq_resume_draft: { mode: 'edit', storeKey: true },
  faq_create_from_example: { mode: 'edit', storeKey: true },
  faq_multilang_add: { mode: 'edit', storeKey: true },
  faq_view: { mode: 'edit', storeKey: true },
  faq_view_list: { mode: 'edit', storeKey: true },
  faq_view_by_lang: { mode: 'edit', storeKey: true },
  faq_view_by_category: { mode: 'edit', storeKey: true },
  faq_manage: { mode: 'edit', storeKey: true },
  faq_bulk_toggle: { mode: 'edit', storeKey: true },
  faq_detail: { mode: 'edit', storeKey: true },
  faq_search: { mode: 'edit', storeKey: true },
  faq_search_results: { mode: 'edit', storeKey: true },
  faq_import_export: { mode: 'edit', storeKey: true },
  faq_test_question: { mode: 'edit', storeKey: true },
  faq_batch_test: { mode: 'edit', storeKey: true },
  faq_stats: { mode: 'edit', storeKey: true },
  faq_performance_dashboard: { mode: 'edit', storeKey: true },
  faq_snapshots: { mode: 'edit', storeKey: true },
  faq_snapshot_restore: { mode: 'edit', storeKey: true },
  faq_cleanup_suggestions: { mode: 'edit', storeKey: true },
  faq_cleanup_group: { mode: 'edit', storeKey: true },
  faq_template_library: { mode: 'edit', storeKey: true },
  faq_template_category: { mode: 'edit', storeKey: true },
  faq_template_pack_preview: { mode: 'edit', storeKey: true },
  faq_template_language_select: { mode: 'edit', storeKey: true },
  faq_template_preview_edit: { mode: 'edit', storeKey: true },
  faq_template_preview_edit_input: { mode: 'edit', storeKey: true },
  faq_template_uninstall: { mode: 'edit', storeKey: true },
  faq_template_duplicate_confirm: { mode: 'edit', storeKey: true },
  faq_template_import_export: { mode: 'edit', storeKey: true },
  faq_pack_updates_list: { mode: 'edit', storeKey: true },

  // Exports / Import / Activation management (admin)
  admin_to_exports: { mode: 'delete_send', storeKey: true },
  exports_menu: { mode: 'edit', storeKey: true },
  exports_to_admin: { mode: 'delete_send', storeKey: true },
  exports_detail: { mode: 'edit', storeKey: true },
  exports_rename_input: { mode: 'edit', storeKey: true },
  exports_import_policy: { mode: 'edit', storeKey: true },
  import_policy_to_exports: { mode: 'delete_send', storeKey: true },

  // Processing states (admin-lock)
  processing: { mode: 'new', storeKey: false }
};

/**
 * Reusable confirmation prompts for admin actions.
 * `prompt(data)` returns the confirmation text (must then be wrapped in a menu).
 * Each entry may declare an `action` function to run when confirmed.
 */
export const actionConfirmations = {
  broadcast: {
    prompt: (data) =>
      '> *' + L(data, 'confirm.broadcastTitle') + '*\n\n' +
      L(data, 'confirm.broadcastQuestion') + '\n\n' +
      '> ' + data.text + '\n\n' +
      '1. ' + toSmallCaps(t(data.language, 'admin.yes')) + '\n' +
      '2. ' + toSmallCaps(t(data.language, 'admin.no'))
  },
  purgeTestUsers: {
    prompt: (data) =>
      '> *' + L(data, 'confirm.purgeTitle') + '*\n\n' +
      L(data, 'confirm.purgeQuestion') + '\n\n' +
      '1. ' + toSmallCaps(t(data.language, 'admin.yes')) + '\n' +
      '2. ' + toSmallCaps(t(data.language, 'admin.no'))
  },
  deleteUser: {
    prompt: (data) =>
      '> *' + L(data, 'confirm.deleteUserTitle') + '*\n\n' +
      L(data, 'confirm.deleteUserQuestion') + '\n' +
      '> ' + (data.name || data.jid) + '\n\n' +
      '1. ' + toSmallCaps(t(data.language, 'admin.yes')) + '\n' +
      '2. ' + toSmallCaps(t(data.language, 'admin.no'))
  },
  blockUser: {
    prompt: (data) => {
      const reasonLine = data.reason ? '\n' + L(data, 'confirm.reason') + ': ' + data.reason : '';
      return '> *' + L(data, 'confirm.blockUserTitle') + '*\n\n' +
        L(data, 'confirm.blockUserQuestion') + '\n' +
        '> ' + (data.name || data.jid) + reasonLine + '\n\n' +
        '1. ' + toSmallCaps(t(data.language, 'admin.yes')) + '\n' +
        '2. ' + toSmallCaps(t(data.language, 'admin.no'));
    }
  },
  unblockUser: {
    prompt: (data) =>
      '> *' + L(data, 'confirm.unblockUserTitle') + '*\n\n' +
      L(data, 'confirm.unblockUserQuestion') + '\n' +
      '> ' + (data.name || data.jid) + '\n\n' +
      '1. ' + toSmallCaps(t(data.language, 'admin.yes')) + '\n' +
      '2. ' + toSmallCaps(t(data.language, 'admin.no'))
  },
  restoreBackup: {
    prompt: (data) =>
      '> *' + L(data, 'confirm.restoreTitle') + '*\n\n' +
      L(data, 'confirm.restoreQuestion', { count: data.count || '?' }) + '\n\n' +
      '1. ' + toSmallCaps(t(data.language, 'admin.yes')) + '\n' +
      '2. ' + toSmallCaps(t(data.language, 'admin.no'))
  },
  changeBotName: {
    prompt: (data) =>
      '> *' + L(data, 'confirm.changeBotNameTitle') + '*\n\n' +
      L(data, 'confirm.changeBotNameQuestion') + '\n' +
      '> ' + (data?.name ?? '') + '\n\n' +
      '1. ' + toSmallCaps(t(data.language, 'admin.yes')) + '\n' +
      '2. ' + toSmallCaps(t(data.language, 'admin.no'))
  },
  toggleSleepAnimation: {
    prompt: (data) => {
      const activeState = data?.current ? t(data.language, 'admin.systemSettings.enabled') : t(data.language, 'admin.systemSettings.disabled');
      return '> *' + L(data, 'admin.systemSettings.optionSleepAnimation') + '*\n\n' +
        L(data, 'admin.systemSettings.sleepAnimationPrompt') + '\n\n' +
        '>> ' + L(data, 'admin.systemSettings.current') + ': *' + toSmallCaps(activeState) + ' ' + (data?.current ? '✅' : '❌') + '*\n\n' +
        '1. ' + toSmallCaps(t(data.language, 'admin.systemSettings.enable')) + ' ✅\n' +
        '2. ' + toSmallCaps(t(data.language, 'admin.systemSettings.disable')) + ' ❌\n\n' +
        '0. ' + toSmallCaps(t(data.language, 'admin.systemSettings.optionBack')) + '\n\n' +
        toSmallCaps(t(data.language, 'admin.systemSettings.replyPrompt'));
    }
  },
  tryStart: {
    prompt: (data) => {
      const lines = data.warning
        ? ['⚠️ ' + L(data, 'admin.try.activeWarning'), data.current ? data.current.testUserJid : '', '', L(data, 'admin.try.replaceQuestion')]
        : [L(data, 'admin.try.startQuestion')];
      return '> *' + L(data, 'admin.try.title') + ' ♻️*\n\n' + lines.join('\n') + '\n\n' +
        '1. ' + toSmallCaps(t(data.language, 'admin.yes')) + '\n' +
        '2. ' + toSmallCaps(t(data.language, 'admin.no'));
    }
  },
  scheduleBroadcast: {
    prompt: (data) => {
      const recLabel = data?.recurrenceLabel || toSmallCaps(t(data.language, 'admin.schedule.recurrence.once'));
      return '> *' + L(data, 'confirm.scheduleBroadcastTitle') + '*\n\n' +
        L(data, 'confirm.scheduleBroadcastQuestion', { time: data?.timeLabel || '?' }) + '\n\n' +
        '> ' + ((data?.text || '').length > 200 ? (data.text.slice(0, 200)) + '…' : (data?.text || '')) + '\n\n' +
        '🔁 ' + L(data, 'confirm.repeat') + ': ' + recLabel + '\n\n' +
        '1. ' + toSmallCaps(t(data.language, 'admin.yes')) + '\n' +
        '2. ' + toSmallCaps(t(data.language, 'admin.no'));
    }
  },
  saveTemplate: {
    prompt: (data) =>
      '> *' + L(data, 'confirm.saveTemplateTitle') + '*\n\n' +
      L(data, 'confirm.saveTemplateQuestion') + '\n\n' +
      L(data, 'confirm.name') + ': ' + (data?.name || '?') + '\n' +
      L(data, 'confirm.text') + ': ' + ((data?.text || '').length > 120 ? (data.text.slice(0, 120)) + '…' : (data?.text || '')) + '\n\n' +
      '1. ' + toSmallCaps(t(data.language, 'admin.yes')) + '\n' +
      '2. ' + toSmallCaps(t(data.language, 'admin.no'))
  },
  deleteTemplate: {
    prompt: (data) =>
      '> *' + L(data, 'confirm.deleteTemplateTitle') + '*\n\n' +
      L(data, 'confirm.deleteTemplateQuestion') + '\n\n' +
      L(data, 'confirm.name') + ': ' + (data?.name || '?') + '\n\n' +
      '1. ' + toSmallCaps(t(data.language, 'admin.yes')) + '\n' +
      '2. ' + toSmallCaps(t(data.language, 'admin.no'))
  },
  deleteSchedule: {
    prompt: (data) =>
      '> *' + L(data, 'confirm.deleteScheduleTitle') + '*\n\n' +
      L(data, 'confirm.deleteScheduleQuestion') + '\n\n' +
      '> ' + ((data?.text || '').length > 120 ? (data.text.slice(0, 120)) + '…' : (data?.text || '')) + '\n\n' +
      '1. ' + toSmallCaps(t(data.language, 'admin.yes')) + '\n' +
      '2. ' + toSmallCaps(t(data.language, 'admin.no'))
  },
  clearSchedules: {
    prompt: (data) => {
      const headlines = Array.isArray(data?.headlines) ? data.headlines : [];
      const head = headlines.length ? headlines.join('\n') + '\n\n' : '';
      return '> *' + L(data, 'confirm.clearAllTitle') + '*\n\n' +
        head +
        L(data, 'confirm.clearAllQuestion') + '\n\n' +
        '1. ' + toSmallCaps(t(data.language, 'admin.yes')) + '\n' +
        '2. ' + toSmallCaps(t(data.language, 'admin.no'));
    }
  },
    editSchedule: {
    prompt: (data) => {
      const fieldLabel = data?.field === 'sendAt' ? L(data, 'confirm.fieldTime')
        : data?.field === 'recurrence' ? L(data, 'confirm.fieldRepeat')
        : L(data, 'confirm.fieldMessage');
      const newVal = data?.field === 'sendAt'
        ? (data?.timeLabel || '?')
        : data?.field === 'recurrence'
          ? (data?.recurrenceLabel || toSmallCaps(t(data.language, 'admin.schedule.recurrence.once')))
          : ((data?.text || '...').length > 120 ? data.text.slice(0, 120) + '…' : (data?.text || '...'));
      return '> *' + L(data, 'confirm.editScheduleTitle') + '*\n\n' +
        L(data, 'confirm.editScheduleQuestion', { field: fieldLabel }) + '\n' +
        '> ' + newVal + '\n\n' +
        '1. ' + toSmallCaps(t(data.language, 'admin.yes')) + '\n' +
        '2. ' + toSmallCaps(t(data.language, 'admin.no'));
    }
  },
  deleteChatRule: {
    prompt: (data) =>
      '> *' + L(data, 'confirmed.deleteChatRule') + '*\n' +
      '> ' + (data?.id || '?') + '\n\n' +
      '1. ' + toSmallCaps(t(data.language, 'admin.yes')) + '\n' +
      '2. ' + toSmallCaps(t(data.language, 'admin.no'))
  },
  deleteFaqEntry: {
    prompt: (data) =>
      '> *' + L(data, 'confirmed.deleteFaqEntry') + '*\n' +
      '> ' + (data?.id || '?') + '\n\n' +
      '1. ' + toSmallCaps(t(data.language, 'admin.yes')) + '\n' +
      '2. ' + toSmallCaps(t(data.language, 'admin.no'))
  },
  importChatRules: {
    prompt: (data) =>
      '> *' + L(data, 'confirmed.importChatRules') + '*\n\n' +
      L(data, 'confirm.importCount', { count: data?.count || '?' }) + '\n\n' +
      '1. ' + toSmallCaps(t(data.language, 'admin.yes')) + '\n' +
      '2. ' + toSmallCaps(t(data.language, 'admin.no'))
  },
  importFaqEntries: {
    prompt: (data) =>
      '> *' + L(data, 'confirmed.importFaqEntries') + '*\n\n' +
      L(data, 'confirm.importCount', { count: data?.count || '?' }) + '\n\n' +
      '1. ' + toSmallCaps(t(data.language, 'admin.yes')) + '\n' +
      '2. ' + toSmallCaps(t(data.language, 'admin.no'))
  },
  activateExport: {
    prompt: (data) =>
      '> *' + L(data, 'confirmed.activateExport') + '*\n\n' +
      L(data, 'confirm.activateExportQuestion', { file: data?.filename || '?' }) + '\n\n' +
      '1. ' + toSmallCaps(t(data.language, 'admin.yes')) + '\n' +
      '2. ' + toSmallCaps(t(data.language, 'admin.no'))
  },
  deleteExport: {
    prompt: (data) =>
      '> *' + L(data, 'confirmed.deleteExport') + '*\n\n' +
      L(data, 'confirm.deleteExportQuestion', { file: data?.filename || '?' }) + '\n\n' +
      '1. ' + toSmallCaps(t(data.language, 'admin.yes')) + '\n' +
      '2. ' + toSmallCaps(t(data.language, 'admin.no'))
  }
};

/**
 * Central menu configuration.
 *
 * Each entry models a menu used for navigation:
 *   key      - the currentMenu session value that maps to this menu
 *   titleKey - translation key for the optional heading line
 *   options  - array of option descriptors:
 *       { number, action, labelKey?, markerFromFeature? }
 *   backAction - the action identifier executed when the user replies 0.
 *
 * Menu-builders consume `resolveOptionLabel` to render each option with the
 * current feature marker appended after the label when `markerFromFeature` is set, so admins
 * can rename/renumber/reorder options purely by editing this file, and can
 * change a feature's marker/status to make the option appear disabled at
 * runtime.
 */
export const menus = {
  profile: {
    titleKey: 'profile.title',
    options: [
      { number: '1', action: 'profile.edit', labelKey: 'profile.optionEdit', prefix: '✏️', markerFromFeature: 'profileEditing' },
      { number: '2', action: 'profile.stats', labelKey: 'profile.optionStats', prefix: '📊', markerFromFeature: 'statistics' },
      { number: '3', action: 'profile.preferences', labelKey: 'profile.optionPreferences', prefix: '⚙️', markerFromFeature: 'preferences' },
      { number: '4', action: 'profile.copyid', labelKey: 'profile.optionCopyId', prefix: '🆔', markerFromFeature: 'copyMyId' }
    ],
    backAction: 'profile.view'
  },
  profile_edit: {
    titleKey: 'profile.editTitle',
    options: [
      { number: '1', action: 'profile.edit.name', labelKey: 'profile.editName', prefix: '👤', markerFromFeature: 'profileName' },
      { number: '2', action: 'profile.edit.username', labelKey: 'profile.editUsername', prefix: '📛', markerFromFeature: 'profileUsername' },
      { number: '3', action: 'profile.edit.bio', labelKey: 'profile.editBio', prefix: '📝', markerFromFeature: 'profileBio' },
      { number: '4', action: 'profile.edit.timezone', labelKey: 'profile.editTimezone', prefix: '🕒', markerFromFeature: 'profileTimezone' },
      { number: '5', action: 'profile.edit.picture', labelKey: 'profile.editPicture', prefix: '🖼️', markerFromFeature: 'profilePicture' },
      { number: '6', action: 'profile.edit.country', labelKey: 'profile.editCountry', prefix: '🌍', markerFromFeature: 'profileCountry' },
      { number: '7', action: 'profile.edit.birthday', labelKey: 'profile.editBirthday', prefix: '🎂', markerFromFeature: 'profileBirthday' }
    ],
    backAction: 'profile.view'
  },
  feature_management: {
    titleKey: 'admin.flags.title',
    options: [
      { number: '1', action: 'features.list', labelKey: 'admin.flags.optionList' },
      { number: '2', action: 'features.select_status', labelKey: 'admin.flags.optionStatus' },
      { number: '3', action: 'features.change_marker_scope', labelKey: 'admin.flags.optionMarker' },
      { number: '4', action: 'features.toggle_markers_status', labelKey: 'admin.flags.optionToggleMarkers' }
    ],
    backAction: 'features.back'
  }
};

/**
 * Given a menu key, return the option matching the user's numeric input.
 * Resolves dynamic markers from the feature registry so disabled features
 * render with their status marker and route to the unavailable flow.
 */
export function resolveMenuOption(menuKey, input) {
  const menu = menus[menuKey];
  if (!menu) return null;
  if (input === '0') {
    return { number: '0', action: menu.backAction || 'back', back: true };
  }
  for (const opt of menu.options) {
    if (String(opt.number) === String(input)) {
      return { number: opt.number, action: opt.action, markerFromFeature: opt.markerFromFeature };
    }
  }
  return null;
}

/**
 * Central command permission registry.
 *
 * `adminOnly` flags for every menu command live here so an admin can flip
 * whether a command is admin-only (or not) in a single place, without editing
 * individual handler files. commandHandler.loadCommands() applies these values
 * to every registered command at load time.
 */
export const menuCommands = {
  start: { adminOnly: false },
  profile: { adminOnly: false },
  editprofile: { adminOnly: false },
  stats: { adminOnly: false },
  preferences: { adminOnly: false },
  language: { adminOnly: false },
  lang: { adminOnly: false },
  help: { adminOnly: false },
  id: { adminOnly: false },
  info: { adminOnly: false },
  feedback: { adminOnly: false },
  'feedback-ad': { adminOnly: true },
  feedbackad: { adminOnly: true },
  feedbackadmin: { adminOnly: true },
  admin: { adminOnly: true },
  manageusers: { adminOnly: true },
  blocked: { adminOnly: true },
  templates: { adminOnly: true },
  broadcast: { adminOnly: true },
  schedule: { adminOnly: true },
  systemsettings: { adminOnly: true },
  conversation: { adminOnly: true },
  analytics: { adminOnly: true },
  test: { adminOnly: true },
  try: { adminOnly: true },
  features: { adminOnly: false },
  backup: { adminOnly: true },
  restore: { adminOnly: true },
  errorlog: { adminOnly: true },
  health: { adminOnly: true },
  adminlog: { adminOnly: true },
  'test-new': { adminOnly: true },
  'test-spam': { adminOnly: true },
  'test-bug': { adminOnly: true },
  'test-security': { adminOnly: true },
  'test-summary': { adminOnly: true },
  addchat: { adminOnly: true },
  listchat: { adminOnly: true },
  editchat: { adminOnly: true },
  deletechat: { adminOnly: true },
  togglechat: { adminOnly: true },
  searchchat: { adminOnly: true },
  importchat: { adminOnly: true },
  exportchat: { adminOnly: true },
  addfaq: { adminOnly: true },
  listfaq: { adminOnly: true },
  editfaq: { adminOnly: true },
  deletefaq: { adminOnly: true },
  togglefaq: { adminOnly: true },
  searchfaq: { adminOnly: true },
  importfaq: { adminOnly: true },
  exportfaq: { adminOnly: true },
  uninstallchat: { adminOnly: true },
  trash: { adminOnly: true },
  restorechat: { adminOnly: true },
  chatfaq: { adminOnly: true },
  cf: { adminOnly: true },
  chatresponses: { adminOnly: true },
  cr: { adminOnly: true },
  snippets: { adminOnly: true },
  snips: { adminOnly: true },
  testpanel: { adminOnly: true },
  users: { adminOnly: true },
  um: { adminOnly: true },
  syssettings: { adminOnly: true },
  sysset: { adminOnly: true },
  broadcast: { adminOnly: true },
  bc: { adminOnly: true },
  backup: { adminOnly: true },
  backuprestore: { adminOnly: true },
  logs: { adminOnly: true },
  adminhelp: { adminOnly: true },
  scheduled: { adminOnly: true },
  tasks: { adminOnly: true },
  analytics: { adminOnly: true }
};

/**
 * Display order for commands shown in /help (and the paginated help menu).
 * Commands not listed here are placed after these, in registration order.
 * Admin-only commands always render after the regular commands.
 */
export const helpOrder = [
  'start',
  'profile',
  'editprofile',
  'stats',
  'preferences',
  'language',
  'help',
  'id',
  'admin',
  'manageusers',
  'blocked',
  'templates',
  'broadcast',
  'schedule',
  'systemsettings',
  'conversation',
  'analytics',
  'test',
  'features',
  'backup',
  'restore',
  'errorlog',
  'health',
  'adminlog',
  'test-new',
  'test-spam',
  'test-bug',
  'test-security',
  'test-summary',
  'addchat',
  'listchat',
  'editchat',
  'deletechat',
  'togglechat',
  'searchchat',
  'importchat',
  'exportchat',
  'addfaq',
  'listfaq',
  'editfaq',
  'deletefaq',
  'togglefaq',
  'searchfaq',
  'importfaq',
  'exportfaq'
];

/**
 * Render an option line. The dynamic feature marker is displayed AFTER the
 * label (e.g. `1. ✏️ ᴇᴅɪᴛ ᴘʀᴏғɪʟᴇ ✅`).
 *
 * @param {Object} data        - { language, ... } used for translation lookups
 * @param {Object} option      - option descriptor from the menus config
 * @returns {string} e.g. `1. ✏️ ᴇᴅɪᴛ ᴘʀᴏғɪʟᴇ ✅` (small caps, static prefix)
 */
export function renderOptionLabel(data, option) {
  const label = option.labelKey ? toSmallCaps(t(data.language, option.labelKey)) : toSmallCaps(option.label || '');
  const prefix = option.prefix ? toSmallCaps(option.prefix) : '';
  const base = option.number + '. ' + (prefix ? prefix + ' ' : '') + label;
  if (option.markerFromFeature) {
    const marker = getEffectiveMarker(option.markerFromFeature);
    return marker ? base + ' ' + marker : base;
  }
  return base;
}
