// Scheduled Tasks overview (Phase 6). Dynamic task list + pagination live
// in the scheduledTasksBody resolver (verbatim); cancel flows stay legacy.
export default {
  id: 'scheduled_tasks',
  headingKey: 'menu.scheduled_tasks.heading',
  headingEmoji: '📅',
  standaloneCommand: '/scheduled',
  aliases: ['/tasks'],
  parent: 'adminPanel',
  backTo: 'adminPanel',
  transitionKey: 'admin_scheduled_tasks',
  footerKey: null,
  fallbackHeadingKey: 'admin.scheduled.title',
  transitionKey: 'admin_scheduled_tasks',
  sessionMenu: 'admin_scheduled_tasks',
  adminOnly: true,
  bodyResolver: 'scheduledTasksBody',
  options: []
};
