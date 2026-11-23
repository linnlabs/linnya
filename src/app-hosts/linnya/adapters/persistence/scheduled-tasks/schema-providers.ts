import type { ISchemaProvider } from 'src/shared/database/schema-provider';
import type Database from 'better-sqlite3';

/** 早期开发库已有任务表，当前版本号下的发行库没有这两张表。旧计划的时区无法从 UTC 反推。 */
export function completeScheduledTaskSchema(db: Database.Database): void {
  db.transaction(() => {
    const tasks = new Set(db.prepare<[], { name: string }>('PRAGMA table_info(scheduled_tasks)').all().map(column => column.name));
    if (!tasks.has('checked_timezone')) {
      db.exec('ALTER TABLE scheduled_tasks ADD COLUMN checked_timezone TEXT; ALTER TABLE scheduled_tasks ADD COLUMN checked_timezone_offset INTEGER');
    }
    if (!tasks.has('latest_checked_at')) {
      db.exec(`ALTER TABLE scheduled_tasks ADD COLUMN latest_checked_at INTEGER NOT NULL DEFAULT 0;
        UPDATE scheduled_tasks SET latest_checked_at = checked_through_at`);
    }
    const runs = new Set(db.prepare<[], { name: string }>('PRAGMA table_info(scheduled_task_runs)').all().map(column => column.name));
    if (!runs.has('planned_local')) {
      db.exec('ALTER TABLE scheduled_task_runs ADD COLUMN planned_local TEXT; ALTER TABLE scheduled_task_runs ADD COLUMN time_zone TEXT');
    }
    if (!runs.has('unread_since_at')) {
      db.exec(`ALTER TABLE scheduled_task_runs ADD COLUMN unread_since_at INTEGER;
        UPDATE scheduled_task_runs SET unread_since_at = ended_at WHERE status = 'completed'`);
    }
    if (!runs.has('approval_pending')) {
      db.exec(`ALTER TABLE scheduled_task_runs ADD COLUMN approval_pending INTEGER NOT NULL DEFAULT 0;
        UPDATE scheduled_task_runs SET approval_pending = 1 WHERE status = 'admitted' AND approval_notified_at IS NOT NULL`);
    }
  }).immediate();
}

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
      checked_timezone TEXT,
      checked_timezone_offset INTEGER,
      latest_checked_at INTEGER NOT NULL DEFAULT 0,
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
      planned_local TEXT,
      time_zone TEXT,
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
      unread_since_at INTEGER,
      viewed_at INTEGER,
      approval_notified_at INTEGER,
      approval_pending INTEGER NOT NULL DEFAULT 0,
      UNIQUE(task_id, planned_at)
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_scheduled_task_runs_local
      ON scheduled_task_runs(task_id, planned_local) WHERE planned_local IS NOT NULL`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_scheduled_task_runs_conversation
      ON scheduled_task_runs(conversation_id) WHERE conversation_id IS NOT NULL`,
    `CREATE INDEX IF NOT EXISTS idx_scheduled_task_runs_unread
      ON scheduled_task_runs(task_id, ended_at)
      WHERE status = 'completed' AND conversation_id IS NOT NULL AND viewed_at IS NULL`,
    `CREATE INDEX IF NOT EXISTS idx_scheduled_task_runs_pending
      ON scheduled_task_runs(status, planned_at) WHERE status IN ('queued', 'admitted')`,
  ] }];
}
