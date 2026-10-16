export const KANBAN_STATUSES = Object.freeze(['todo', 'in_progress', 'review', 'done']);
if (typeof window !== "undefined") {
  window.KANBAN_STATUSES = KANBAN_STATUSES;
}
