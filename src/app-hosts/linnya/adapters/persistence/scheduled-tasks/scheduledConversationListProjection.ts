/** SQL 片段只消费定时任务 owner 的运行关系。先折叠，外层才能正确使用 keyset 分页。 */
export const scheduledConversationListProjection = {
  select: `, t.id AS scheduled_task_id, t.name AS scheduled_task_name,
    (SELECT COUNT(*) FROM scheduled_task_runs r WHERE r.task_id = t.id) AS scheduled_run_count,
    (SELECT COUNT(*) FROM scheduled_task_runs r WHERE r.task_id = t.id
      AND r.status = 'completed' AND r.conversation_id IS NOT NULL AND r.viewed_at IS NULL) AS scheduled_unread_count`,
  join: `LEFT JOIN scheduled_task_runs sr ON sr.conversation_id = c.conversation_id AND sr.conversation_id IS NOT NULL
    LEFT JOIN scheduled_tasks t ON t.id = sr.task_id AND t.deleted_at IS NULL`,
  filter: `AND (t.id IS NULL OR c.conversation_id = (
    SELECT r.conversation_id FROM scheduled_task_runs r WHERE r.task_id = t.id AND r.conversation_id IS NOT NULL
    ORDER BY r.started_at DESC, r.planned_at DESC LIMIT 1
  ))`,
};
