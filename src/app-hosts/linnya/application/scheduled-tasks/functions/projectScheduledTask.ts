import type { ScheduledTask, ScheduledTaskRun, ScheduledTaskState } from '@app/schemas/scheduled-tasks';
import type { ScheduledExecutionFact, ScheduledTaskPorts } from '../definitions/scheduledTaskRuntime';
import type { ScheduledRunRecord, ScheduledTaskRecord } from '../definitions/scheduledTaskStore';
import { nextScheduledTime } from './scheduleTime';

export function projectScheduledRun(run: ScheduledRunRecord, fact: ScheduledExecutionFact | undefined, totalTokens: number | null): ScheduledTaskRun {
  return {
    id: run.id, task_id: run.task_id, planned_at: run.planned_at, trigger: run.trigger,
    status: run.status === 'admitted' ? fact?.state === 'awaiting_approval' ? 'awaiting_approval' : 'running' : run.status,
    reason: run.reason, skipped_count: run.skipped_count, started_at: run.started_at, ended_at: run.ended_at,
    conversation_id: run.conversation_id, run_id: run.run_id, permission_level: run.permission_level,
    model_config_id: run.model_config_id, total_tokens: totalTokens,
    unread: run.status === 'completed' && run.conversation_id !== null && run.viewed_at === null,
  };
}

function taskState(task: ScheduledTaskRecord, active: ScheduledRunRecord | undefined, fact: ScheduledExecutionFact | undefined): ScheduledTaskState {
  if (active?.status === 'admitted') return fact?.state === 'awaiting_approval' ? 'awaiting_approval' : 'running';
  if (active?.status === 'queued') return 'queued';
  if (task.enabled) return 'scheduled';
  if (task.paused_reason === 'failures') return 'paused_after_failures';
  if (task.paused_reason === 'unviewed') return 'paused_unviewed';
  if (task.paused_reason === 'one_shot_done') return 'finished';
  return 'paused';
}

export function projectScheduledTask(
  ports: ScheduledTaskPorts,
  task: ScheduledTaskRecord,
  pending: readonly ScheduledRunRecord[],
  facts: ReadonlyMap<string, ScheduledExecutionFact>,
): ScheduledTask {
  const active = pending.find(run => run.task_id === task.id);
  const lastRun = ports.store.readRuns(task.id, 1)[0];
  const { run_count, unread_count } = ports.store.runFacts(task.id);
  const { id, project_id, name, prompt, agent, model_config_id, schedule, missed_policy, permission_level,
    consecutive_failures, revision, created_at, updated_at } = task;
  const model = model_config_id ?? ports.defaultModel();
  return {
    id, project_id, name, prompt, agent, model_config_id, schedule, missed_policy, permission_level,
    consecutive_failures, revision, created_at, updated_at, run_count, unread_count,
    state: taskState(task, active, active && facts.get(active.id)),
    model_unavailable: model === null || !ports.modelAvailable(model),
    next_run_at: task.enabled ? nextScheduledTime(task.clock, Math.max(ports.now(), task.checked_through_at), ports.timezone()) : null,
    last_run: lastRun ? projectScheduledRun(lastRun, facts.get(lastRun.id), ports.usage(lastRun)) : null,
    storage_bytes: ports.storage(task.id),
    source: task.created_by_kind === 'agent' && task.created_conversation_id && task.created_run_id
      ? { kind: 'agent', conversation_id: task.created_conversation_id,
          conversation_title: ports.store.conversationTitle(task.created_conversation_id), run_id: task.created_run_id }
      : { kind: 'user' },
  };
}
