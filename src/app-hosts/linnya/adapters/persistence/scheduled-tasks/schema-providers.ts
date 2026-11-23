import type { ISchemaProvider } from 'src/shared/database/schema-provider';

export function getScheduledTaskSchemaProviders(): ISchemaProvider[] {
  return [{ name: 'scheduled-tasks', getSchema: () => [
    `CREATE TABLE IF NOT EXISTS scheduled_tasks (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      prompt TEXT NOT NULL,
      agent TEXT NOT NULL CHECK(agent IN ('default', 'research')),
      model_config_id TEXT,
      schedule_kind TEXT NOT NULL,
      cron_expr TEXT,
      one_shot_at TEXT,
      schedule_json TEXT NOT NULL,
      missed_policy TEXT NOT NULL CHECK(missed_policy IN ('run_latest', 'skip')),
      permission_level TEXT NOT NULL CHECK(permission_level IN ('read_only', 'standard', 'full_access')),
      enabled INTEGER NOT NULL CHECK(enabled IN (0, 1)),
      paused_reason TEXT CHECK(paused_reason IN ('user', 'failures', 'unviewed', 'one_shot_done')),
      consecutive_failures INTEGER NOT NULL DEFAULT 0,
      last_viewed_at INTEGER,
      unviewed_since_at INTEGER NOT NULL,
      checked_through_at INTEGER NOT NULL,
      schedule_generation INTEGER NOT NULL DEFAULT 0,
      created_by_kind TEXT NOT NULL CHECK(created_by_kind IN ('user', 'agent')),
      created_conversation_id TEXT,
      created_run_id TEXT,
      updated_run_id TEXT,
      changes_json TEXT NOT NULL DEFAULT '[]',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      revision INTEGER NOT NULL DEFAULT 0,
      deleted_at INTEGER
    )`,
    'CREATE INDEX IF NOT EXISTS idx_scheduled_tasks_project ON scheduled_tasks(project_id, deleted_at)',
    `CREATE TABLE IF NOT EXISTS scheduled_task_runs (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL REFERENCES scheduled_tasks(id) ON DELETE CASCADE,
      planned_at INTEGER NOT NULL,
      trigger TEXT NOT NULL CHECK(trigger IN ('schedule', 'catch_up', 'manual')),
      status TEXT NOT NULL CHECK(status IN ('queued', 'admitted', 'completed', 'failed', 'skipped', 'interrupted', 'superseded')),
      reason TEXT,
      skipped_count INTEGER NOT NULL DEFAULT 1,
      conversation_id TEXT REFERENCES conversations(conversation_id) ON DELETE SET NULL,
      run_id TEXT,
      permission_level TEXT NOT NULL CHECK(permission_level IN ('read_only', 'standard', 'full_access')),
      model_config_id TEXT,
      schedule_generation INTEGER NOT NULL,
      started_at INTEGER,
      ended_at INTEGER,
      viewed_at INTEGER,
      approval_notified_at INTEGER,
      UNIQUE(task_id, planned_at)
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_scheduled_task_runs_conversation
      ON scheduled_task_runs(conversation_id) WHERE conversation_id IS NOT NULL`,
    `CREATE INDEX IF NOT EXISTS idx_scheduled_task_runs_pending
      ON scheduled_task_runs(status, planned_at) WHERE status IN ('queued', 'admitted')`,
  ] }];
}
