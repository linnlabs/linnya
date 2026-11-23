import type Database from 'better-sqlite3';
import type { CommandPermissionLevel } from '@app/schemas';
import { ScheduledTaskScheduleSchema, type ScheduledTaskSchedule } from '@app/schemas/scheduled-tasks';
import type { ScheduledTaskRecord, ScheduledRunRecord, ScheduledTaskStore, TaskChangeActor } from 'src/app-hosts/linnya/application/scheduled-tasks/definitions/scheduledTaskStore';

interface TaskRow extends Omit<ScheduledTaskRecord, 'schedule' | 'enabled' | 'clock'> {
  schedule_json: string;
  cron_expr: string | null;
  one_shot_at: string | null;
  enabled: 0 | 1;
}

function toTaskRecord({ schedule_json, cron_expr, one_shot_at, enabled, ...row }: TaskRow): ScheduledTaskRecord {
  const schedule: ScheduledTaskSchedule = ScheduledTaskScheduleSchema.parse(JSON.parse(schedule_json));
  if (cron_expr !== null) return { ...row, schedule, enabled: enabled === 1, clock: { cron: cron_expr, localDateTime: null } };
  if (one_shot_at === null) throw new Error(`Missing schedule for task ${row.id}`);
  return { ...row, schedule, enabled: enabled === 1, clock: { cron: null, localDateTime: one_shot_at } };
}

/** 任务的写入、补跑高水位和运行快照由同一个 SQLite owner 提交。 */
export function createSqliteScheduledTasks(db: Database.Database): ScheduledTaskStore {
  return {
    transaction<T>(work: () => T): T { return db.transaction(work).immediate(); },
    list(projectId?: string): ScheduledTaskRecord[] {
      if (projectId === undefined) {
        return db.prepare<[], TaskRow>('SELECT * FROM scheduled_tasks WHERE deleted_at IS NULL').all().map(toTaskRecord);
      }
      return db.prepare<[string], TaskRow>('SELECT * FROM scheduled_tasks WHERE project_id = ? AND deleted_at IS NULL')
        .all(projectId).map(toTaskRecord);
    },
    read(id: string): ScheduledTaskRecord | undefined {
      const row = db.prepare<[string], TaskRow>('SELECT * FROM scheduled_tasks WHERE id = ?').get(id);
      return row && toTaskRecord(row);
    },
    write(task: ScheduledTaskRecord): void {
      db.prepare(`INSERT INTO scheduled_tasks (
          id, project_id, name, prompt, agent, model_config_id, schedule_kind, cron_expr, one_shot_at,
          schedule_json, missed_policy, permission_level, enabled, paused_reason, consecutive_failures,
          last_viewed_at, unviewed_since_at, checked_through_at, checked_timezone, checked_timezone_offset, latest_checked_at,
          schedule_generation, created_by_kind, created_conversation_id,
          created_run_id, updated_run_id, created_at, updated_at, revision, deleted_at
        ) VALUES (
          @id, @project_id, @name, @prompt, @agent, @model_config_id, @schedule_kind, @cron_expr, @one_shot_at,
          @schedule_json, @missed_policy, @permission_level, @enabled, @paused_reason, @consecutive_failures,
          @last_viewed_at, @unviewed_since_at, @checked_through_at, @checked_timezone, @checked_timezone_offset, @latest_checked_at,
          @schedule_generation, @created_by_kind, @created_conversation_id,
          @created_run_id, @updated_run_id, @created_at, @updated_at, @revision, @deleted_at
        ) ON CONFLICT(id) DO UPDATE SET
          name = excluded.name, prompt = excluded.prompt, agent = excluded.agent,
          model_config_id = excluded.model_config_id, schedule_kind = excluded.schedule_kind,
          cron_expr = excluded.cron_expr, one_shot_at = excluded.one_shot_at, schedule_json = excluded.schedule_json,
          missed_policy = excluded.missed_policy, permission_level = excluded.permission_level,
          enabled = excluded.enabled, paused_reason = excluded.paused_reason, consecutive_failures = excluded.consecutive_failures,
          last_viewed_at = excluded.last_viewed_at, unviewed_since_at = excluded.unviewed_since_at,
          checked_through_at = excluded.checked_through_at,
          checked_timezone = excluded.checked_timezone, checked_timezone_offset = excluded.checked_timezone_offset,
          latest_checked_at = MAX(scheduled_tasks.latest_checked_at, excluded.latest_checked_at),
          schedule_generation = excluded.schedule_generation, updated_run_id = excluded.updated_run_id,
          updated_at = excluded.updated_at, revision = excluded.revision, deleted_at = excluded.deleted_at`)
        .run({ ...task, schedule_kind: task.schedule.kind, cron_expr: task.clock.cron, one_shot_at: task.clock.localDateTime,
          schedule_json: JSON.stringify(task.schedule), enabled: Number(task.enabled) });
    },
    writeCheck(taskId, through, timezone, offset): void {
      db.prepare(`UPDATE scheduled_tasks SET checked_through_at = ?, checked_timezone = ?, checked_timezone_offset = ?,
        latest_checked_at = MAX(latest_checked_at, ?) WHERE id = ?`)
        .run(through, timezone, offset, through, taskId);
    },
    latestClockEvidence(): number | null {
      return db.prepare<[], { latest: number | null }>(`SELECT MAX(timestamp) AS latest FROM (
        SELECT MAX(MAX(latest_checked_at, updated_at, COALESCE(last_viewed_at, 0))) AS timestamp FROM scheduled_tasks
        UNION ALL
        SELECT MAX(MAX(COALESCE(started_at, 0), COALESCE(ended_at, 0), COALESCE(viewed_at, 0))) FROM scheduled_task_runs
      )`).get()?.latest ?? null;
    },
    recordChange(task: ScheduledTaskRecord, actor: TaskChangeActor, action: 'created' | 'updated'): void {
      db.prepare(`UPDATE scheduled_tasks SET changes_json = json_insert(changes_json, '$[#]', json(?)) WHERE id = ?`)
        .run(JSON.stringify({ ...actor, action, name: task.name }), task.id);
    },
    listChanges(conversation: string, rootRunIds: readonly string[]): Array<{
      task_id: string; task_name: string; action: 'created' | 'updated'; permission: CommandPermissionLevel;
    }> {
      return db.prepare<[string, string], { task_id: string; task_name: string; action: 'created' | 'updated'; permission: CommandPermissionLevel }>(`
        WITH matching AS (
          SELECT t.id AS task_id, json_extract(c.value, '$.name') AS task_name,
            json_extract(c.value, '$.action') AS action, json_extract(c.value, '$.permission') AS permission,
            ROW_NUMBER() OVER(PARTITION BY t.id ORDER BY c.key DESC) AS most_recent,
            MIN(json_extract(c.value, '$.action')) OVER(PARTITION BY t.id) AS combined_action
          FROM scheduled_tasks t JOIN conversations source ON source.project_id = t.project_id,
            json_each(t.changes_json) c
          WHERE source.conversation_id = ? AND json_extract(c.value, '$.conversationId') = source.conversation_id
            AND json_extract(c.value, '$.rootRunId') IN (SELECT value FROM json_each(?))
        )
        SELECT task_id, task_name, combined_action AS action, permission FROM matching WHERE most_recent = 1 ORDER BY task_id
      `).all(conversation, JSON.stringify(rootRunIds));
    },
    conversationTitle(id: string): string | null {
      return db.prepare<[string], { title: string }>('SELECT title FROM conversations WHERE conversation_id = ?').get(id)?.title ?? null;
    },
    writeRun(run: ScheduledRunRecord): boolean {
      return db.prepare(`INSERT INTO scheduled_task_runs (
          id, task_id, planned_at, planned_local, time_zone, trigger, status, reason, skipped_count, conversation_id, run_id,
          permission_level, model_config_id, schedule_generation, started_at, ended_at, unread_since_at, viewed_at, approval_notified_at, approval_pending
        ) VALUES (
          @id, @task_id, @planned_at, @planned_local, @time_zone, @trigger, @status, @reason, @skipped_count, @conversation_id, @run_id,
          @permission_level, @model_config_id, @schedule_generation, @started_at, @ended_at, @unread_since_at, @viewed_at, @approval_notified_at, @approval_pending
        ) ON CONFLICT(task_id, planned_at) DO UPDATE SET
          trigger = excluded.trigger, status = excluded.status, reason = excluded.reason,
          skipped_count = excluded.skipped_count, conversation_id = excluded.conversation_id, run_id = excluded.run_id,
          permission_level = excluded.permission_level, model_config_id = excluded.model_config_id,
          schedule_generation = excluded.schedule_generation, started_at = excluded.started_at,
          ended_at = excluded.ended_at, unread_since_at = excluded.unread_since_at,
          viewed_at = excluded.viewed_at, approval_notified_at = excluded.approval_notified_at, approval_pending = excluded.approval_pending
        WHERE scheduled_task_runs.id = excluded.id
        ON CONFLICT DO NOTHING`).run(run).changes > 0;
    },
    claimRun(run): boolean {
      return db.prepare(`UPDATE scheduled_task_runs SET status = 'admitted', started_at = @started_at,
        permission_level = @permission_level, model_config_id = @model_config_id
        WHERE id = @id AND status = 'queued' AND NOT EXISTS (
          SELECT 1 FROM scheduled_task_runs WHERE task_id = @task_id AND status = 'admitted'
        )`).run(run).changes === 1;
    },
    readRuns(taskId: string, limit: number, before?: number): ScheduledRunRecord[] {
      return db.prepare<[string, number, number], ScheduledRunRecord>(`SELECT * FROM scheduled_task_runs
        WHERE task_id = ? AND planned_at < ? ORDER BY planned_at DESC LIMIT ?`).all(taskId, before ?? Number.MAX_SAFE_INTEGER, limit);
    },
    pendingRuns(): ScheduledRunRecord[] {
      return db.prepare<[], ScheduledRunRecord>(`SELECT * FROM scheduled_task_runs WHERE status IN ('queued', 'admitted')
        ORDER BY CASE WHEN trigger = 'manual' THEN 0 ELSE 1 END,
          CASE WHEN trigger = 'manual' THEN -planned_at ELSE planned_at END, id`).all();
    },
    readRunAt(taskId: string, plannedAt: number): ScheduledRunRecord | undefined {
      return db.prepare<[string, number], ScheduledRunRecord>('SELECT * FROM scheduled_task_runs WHERE task_id = ? AND planned_at = ?')
        .get(taskId, plannedAt);
    },
    hasLocalOccurrence(taskId, plannedLocal): boolean {
      return db.prepare('SELECT 1 FROM scheduled_task_runs WHERE task_id = ? AND planned_local = ?').get(taskId, plannedLocal) !== undefined;
    },
    hasCompletedRun(taskId, generation): boolean {
      return db.prepare(`SELECT 1 FROM scheduled_task_runs WHERE task_id = ? AND schedule_generation = ? AND status = 'completed' LIMIT 1`)
        .get(taskId, generation) !== undefined;
    },
    readRunForConversation(conversationId: string): ScheduledRunRecord | undefined {
      return db.prepare<[string], ScheduledRunRecord>('SELECT * FROM scheduled_task_runs WHERE conversation_id = ?').get(conversationId);
    },
    runFacts(taskId: string): { run_count: number; unread_count: number } {
      const facts = db.prepare<[{ taskId: string }], { run_count: number; unread_count: number }>(`
        SELECT COUNT(*) AS run_count,
          (SELECT COUNT(*) FROM scheduled_task_runs WHERE task_id = @taskId
            AND status = 'completed' AND conversation_id IS NOT NULL AND viewed_at IS NULL) AS unread_count
        FROM scheduled_task_runs WHERE task_id = @taskId`).get({ taskId });
      if (!facts) throw new Error(`Missing aggregate for scheduled task ${taskId}`);
      return facts;
    },
    firstUnreadAt(taskId): number | null {
      return db.prepare<[string], { since: number | null }>(`SELECT MIN(unread_since_at) AS since FROM scheduled_task_runs
        WHERE task_id = ? AND status = 'completed' AND conversation_id IS NOT NULL AND viewed_at IS NULL
      `).get(taskId)?.since ?? null;
    },
    anchorUnreadCompletions(now): boolean {
      return db.prepare(`UPDATE scheduled_task_runs SET unread_since_at = ? WHERE status = 'completed'
        AND conversation_id IS NOT NULL AND viewed_at IS NULL AND unread_since_at IS NULL`).run(now).changes > 0;
    },
    clearHistory(taskId: string): void {
      db.prepare(`DELETE FROM scheduled_task_runs WHERE task_id = ? AND status != 'admitted'`).run(taskId);
    },
    removeRun(id: string): void {
      db.prepare('DELETE FROM scheduled_task_runs WHERE id = ?').run(id);
    },
  };
}
