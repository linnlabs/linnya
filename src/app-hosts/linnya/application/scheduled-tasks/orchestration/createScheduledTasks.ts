import { randomUUID } from 'node:crypto';
import { compareCommandPermissionLevels, type CommandPermissionLevel } from '@app/schemas';
import type {
  ConversationRunScheduledTasks, ConversationRunScheduledTasksRequest, ScheduledTaskCreateRequest,
  ScheduledTaskDeleteRequest, ScheduledTaskDeleteResult, ScheduledTaskMutationResult, ScheduledTaskRunsResult,
  ScheduledTaskSchedule, ScheduledTaskSettings, ScheduledTaskSettingsSetRequest, ScheduledTasksListResult, ScheduledTaskUpdateRequest,
} from '@app/schemas/scheduled-tasks';
import { ScheduledTaskPermissionError } from '../definitions/scheduledTaskPermissionError';
import type { ScheduledTaskPorts } from '../definitions/scheduledTaskRuntime';
import type { ScheduledTaskRecord, TaskChangeActor } from '../definitions/scheduledTaskStore';
import { projectScheduledRun, projectScheduledTask } from '../functions/projectScheduledTask';
import { compileSchedule, createScheduleTimeZone, MINUTE_MS, previewSchedule } from '../functions/scheduleTime';
import { readScheduledClock } from '../functions/scheduledClock';
import { createScheduledRun, skipReasonForActiveRun } from '../functions/scheduledRunRules';
import { createScheduledTaskScheduler } from './createScheduledTaskScheduler';

const MISSING = { ok: false, code: 'task_not_found', message: 'Scheduled task not found.' } as const;
const INVALID_MODEL = { ok: false, code: 'model_unavailable', message: 'The selected model is unavailable.' } as const;

function checkCliPermission(level: CommandPermissionLevel, actor: TaskChangeActor | undefined): void {
  if (actor && compareCommandPermissionLevels(level, actor.permission) > 0) throw new ScheduledTaskPermissionError();
}

export function createScheduledTasks(ports: ScheduledTaskPorts) {
  const { store } = ports;
  const scheduler = createScheduledTaskScheduler(ports);
  const calendar = () => {
    const clock = readScheduledClock(ports);
    return { ...clock, clockAnomalous: Boolean(clock.anomaly), timezone: createScheduleTimeZone(ports.timezone()) };
  };
  const checkPoint = () => {
    const { now, anomaly, trustedReference, timezone } = calendar();
    const reference = anomaly ? trustedReference : now;
    return { checked_through_at: reference, latest_checked_at: reference, checked_timezone: timezone.name, checked_timezone_offset: timezone.offsetAt(reference) };
  };
  const visible = (id: string, projectId?: string): ScheduledTaskRecord | undefined => {
    const task = store.read(id);
    return task && task.deleted_at === null && (projectId === undefined || task.project_id === projectId) ? task : undefined;
  };
  const live = async () => {
    const pending = store.pendingRuns();
    const facts = await scheduler.readFacts(pending.filter(run => run.status === 'admitted'));
    return { pending, facts };
  };
  const mutation = async (id: string): Promise<ScheduledTaskMutationResult> => {
    const { pending, facts } = await live();
    const task = visible(id);
    return task ? { ok: true, task: projectScheduledTask(ports, task, pending, facts, calendar()) } : MISSING;
  };
  const preview = (schedule: ScheduledTaskSchedule) => {
    const { now, timezone, clockAnomalous } = calendar();
    return previewSchedule(schedule, now, timezone.name, clockAnomalous);
  };

  function save(task: ScheduledTaskRecord, actor?: TaskChangeActor, action: 'created' | 'updated' = 'updated'): void {
    store.transaction(() => {
      store.write(task);
      if (actor) store.recordChange(task, actor, action);
    });
    ports.publish();
  }

  return {
    lifecycle: scheduler.lifecycle,
    tick: scheduler.tick,
    recheck: scheduler.recheck,
    poke: scheduler.poke,
    deferApproval: scheduler.deferApproval,
    preview,
    async list(projectId?: string): Promise<ScheduledTasksListResult> {
      const { pending, facts } = await live();
      const current = calendar();
      const tasks = store.list(projectId).map(task => projectScheduledTask(ports, task, pending, facts, current));
      tasks.sort((a, b) => a.project_id.localeCompare(b.project_id)
        || (a.next_run_at ?? Infinity) - (b.next_run_at ?? Infinity) || a.id.localeCompare(b.id));
      return { tasks, settings: ports.settings.read(), scheduler_enabled: ports.schedulerEnabled,
        ...(current.anomaly ? { clock_anomaly: current.anomaly } : {}),
        running_count: [...facts.values()].filter(fact => fact.state === 'running').length };
    },
    show: async (id: string, projectId: string): Promise<ScheduledTaskMutationResult> => visible(id, projectId) ? mutation(id) : MISSING,
    async runs(taskId: string, limit: number, before?: number): Promise<ScheduledTaskRunsResult> {
      const { facts } = await live();
      const page = store.readRuns(taskId, limit + 1, before);
      if (!visible(taskId)) return { runs: [], has_more: false };
      return { runs: page.slice(0, limit).map(run => projectScheduledRun(run, facts.get(run.id), ports.usage(run))), has_more: page.length > limit };
    },
    create(input: ScheduledTaskCreateRequest, actor?: TaskChangeActor): Promise<ScheduledTaskMutationResult> {
      return scheduler.serialize(async () => {
        checkCliPermission(input.permission_level, actor);
        if (!ports.projectExists(input.project_id)) return { ok: false, code: 'project_not_found', message: 'Project not found.' };
        const validation = preview(input.schedule);
        if (!validation.ok) return { ok: false, code: 'invalid_schedule', message: validation.message };
        if (input.model_config_id !== null && !ports.modelAvailable(input.model_config_id)) return INVALID_MODEL;
        const now = ports.now();
        const id = randomUUID();
        save({ ...input, id, clock: compileSchedule(input.schedule), enabled: true, paused_reason: null,
          consecutive_failures: 0, last_viewed_at: null, unviewed_since_at: now, ...checkPoint(),
          schedule_generation: 0, created_by_kind: actor ? 'agent' : 'user', created_conversation_id: actor?.conversationId ?? null,
          created_run_id: actor?.rootRunId ?? null, updated_run_id: null, revision: 0, created_at: now, updated_at: now, deleted_at: null }, actor, 'created');
        return mutation(id);
      });
    },
    update({ task_id, expected_revision, ...fields }: ScheduledTaskUpdateRequest, actor?: TaskChangeActor, projectId?: string): Promise<ScheduledTaskMutationResult> {
      return scheduler.serialize(async () => {
        const task = visible(task_id, projectId);
        if (!task) return MISSING;
        checkCliPermission(fields.permission_level ?? task.permission_level, actor);
        if (task.revision !== expected_revision) return { ok: false, code: 'revision_conflict', message: 'Scheduled task changed. Refresh it and try again.' };
        const now = ports.now();
        if (fields.model_config_id != null && fields.model_config_id !== task.model_config_id && !ports.modelAvailable(fields.model_config_id)) return INVALID_MODEL;
        const changedSchedule = fields.schedule !== undefined && JSON.stringify(fields.schedule) !== JSON.stringify(task.schedule);
        const schedule = fields.schedule ?? task.schedule;
        if (changedSchedule) {
          const validation = preview(schedule);
          if (!validation.ok) return { ok: false, code: 'invalid_schedule', message: validation.message };
        }
        store.transaction(() => {
          if (changedSchedule) scheduler.discardAutomaticQueue(task.id, 'superseded');
          save({ ...task, ...fields, schedule, clock: changedSchedule ? compileSchedule(schedule) : task.clock,
            ...(changedSchedule ? checkPoint() : {}),
            paused_reason: changedSchedule && task.paused_reason === 'one_shot_done' ? 'user' : task.paused_reason,
            schedule_generation: task.schedule_generation + Number(changedSchedule),
            updated_at: now, revision: task.revision + 1, updated_run_id: actor?.rootRunId ?? task.updated_run_id }, actor);
        });
        return mutation(task.id);
      });
    },
    setEnabled(id: string, enabled: boolean, actor?: TaskChangeActor, projectId?: string): Promise<ScheduledTaskMutationResult> {
      return scheduler.serialize(async () => {
        const task = visible(id, projectId);
        if (!task) return MISSING;
        if (enabled) checkCliPermission(task.permission_level, actor);
        if (task.enabled === enabled) return mutation(id);
        if (enabled && task.schedule.kind === 'once') {
          if (task.paused_reason === 'one_shot_done') return { ok: false, code: 'invalid_schedule', message: 'Choose a new one-time schedule before enabling this task.' };
          const validation = preview(task.schedule);
          if (!validation.ok) return { ok: false, code: 'invalid_schedule', message: validation.message };
        }
        const now = ports.now();
        store.transaction(() => {
          if (!enabled) scheduler.discardAutomaticQueue(id);
          save({ ...task, enabled, paused_reason: enabled ? null : 'user',
            consecutive_failures: enabled ? 0 : task.consecutive_failures, unviewed_since_at: enabled ? now : task.unviewed_since_at,
            ...checkPoint(), updated_at: now, revision: task.revision + 1,
            updated_run_id: actor?.rootRunId ?? task.updated_run_id }, actor);
        });
        return mutation(id);
      });
    },
    runNow(id: string, projectId?: string, actor?: TaskChangeActor): Promise<ScheduledTaskMutationResult> {
      return scheduler.serialize(async () => {
        const task = visible(id, projectId);
        if (!task) return MISSING;
        checkCliPermission(task.permission_level, actor);
        const { pending, facts } = await live();
        const active = pending.find(run => run.task_id === id && run.status === 'admitted');
        const reason = skipReasonForActiveRun(active && facts.get(active.id)?.state);
        let plannedAt = ports.now();
        // 整分钟留给自动计划，手动触发不能占用同一任务的日历身份。
        while (plannedAt % MINUTE_MS === 0 || store.readRunAt(id, plannedAt)) plannedAt++;
        const candidate = createScheduledRun(task, plannedAt, 'manual', createScheduleTimeZone(ports.timezone()));
        scheduler.enqueue(task, reason ? { ...candidate, status: 'skipped', reason, ended_at: ports.now() } : candidate);
        await scheduler.drain();
        ports.publish();
        return mutation(id);
      });
    },
    delete({ task_id, stop_running }: ScheduledTaskDeleteRequest): Promise<ScheduledTaskDeleteResult> {
      return scheduler.serialize(async () => {
        const task = visible(task_id);
        if (!task) return MISSING;
        const stopped_runs = stop_running ? await scheduler.stopRuns(task_id, 'task_deleted') : 0;
        const now = ports.now();
        store.transaction(() => {
          // 历史卡片依赖任务名，保留墓碑；已发出的对话由 Conversation 自己持有。
          store.write({ ...task, prompt: '', deleted_at: now, enabled: false, updated_at: now, revision: task.revision + 1 });
          store.clearHistory(task_id);
        });
        ports.publish();
        return { ok: true, stopped_runs };
      });
    },
    withProjectDeletion(projectId: string, deleteProject: (stopScheduledRuns: () => Promise<void>) => Promise<void>): Promise<void> {
      return scheduler.serialize(async () => {
        await deleteProject(async () => {
          for (const task of store.list(projectId)) await scheduler.stopRuns(task.id, 'project_deleted');
        });
        ports.publish();
      });
    },
    markViewed(conversationId: string): Promise<void> {
      return scheduler.serialize(() => {
        const run = store.readRunForConversation(conversationId);
        const task = run && visible(run.task_id);
        if (!run || !task) return;
        const { now, anomaly, trustedReference } = readScheduledClock(ports);
      const viewedAt = Math.max(anomaly ? trustedReference : now, task.last_viewed_at ?? 0);
      store.transaction(() => {
        if (run.status === 'completed' && run.viewed_at === null) store.writeRun({ ...run, viewed_at: viewedAt });
        store.write({ ...task, last_viewed_at: viewedAt });
      });
      ports.publish();
      });
    },
    getSettings: ports.settings.read,
    setSettings(settings: ScheduledTaskSettingsSetRequest): Promise<ScheduledTaskSettings> {
      return scheduler.serialize(async () => {
        ports.settings.write(settings);
        await scheduler.drain();
        ports.publish();
        return ports.settings.read();
      });
    },
    async changes({ conversation_id, root_run_ids }: ConversationRunScheduledTasksRequest): Promise<ConversationRunScheduledTasks> {
      const { pending, facts } = await live();
      const current = calendar();
      return { tasks: store.listChanges(conversation_id, root_run_ids).map(({ permission, ...entry }) => {
        const record = visible(entry.task_id);
        const task = record ? projectScheduledTask(ports, record, pending, facts, current) : null;
        return { ...entry, task, above_conversation_permission: task !== null && compareCommandPermissionLevels(task.permission_level, permission) > 0 };
      }) };
    },
    countModels(ids: ReadonlySet<string>): number {
      const defaultModel = ports.defaultModel();
      return store.list().filter(task => {
        const modelId = task.model_config_id ?? defaultModel;
        return modelId !== null && ids.has(modelId);
      }).length;
    },
    permissionsAbove(level: CommandPermissionLevel) {
      return store.list().filter(task => compareCommandPermissionLevels(task.permission_level, level) > 0)
        .map(task => ({ id: `scheduled-task:${task.id}`, revision: task.revision, createdAt: task.created_at }));
    },
    reducePermissions(level: CommandPermissionLevel): void {
      const now = ports.now();
      store.transaction(() => {
        for (const task of store.list()) {
          if (compareCommandPermissionLevels(task.permission_level, level) > 0) {
            store.write({ ...task, permission_level: level, updated_at: now, revision: task.revision + 1 });
          }
        }
      });
    },
    publish: ports.publish,
  };
}

export type ScheduledTasks = ReturnType<typeof createScheduledTasks>;
