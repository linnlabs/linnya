import { randomUUID } from 'node:crypto';
import type { ScheduledTaskRunReason, ScheduledTaskRunTrigger } from '@app/schemas/scheduled-tasks';
import { SCHEDULED_TASK_CATCH_UP_WINDOW_MS, SCHEDULED_TASK_MISSED_TOLERANCE_MS } from '@app/schemas/scheduled-tasks';
import type { ScheduledExecutionState } from '../definitions/scheduledTaskRuntime';
import type { ScheduledRunRecord, ScheduledTaskRecord } from '../definitions/scheduledTaskStore';
import { elapsedScheduledTimes } from './scheduleTime';

export function createScheduledRun(task: ScheduledTaskRecord, plannedAt: number, trigger: ScheduledTaskRunTrigger): ScheduledRunRecord {
  return {
    id: randomUUID(), task_id: task.id, planned_at: plannedAt, trigger, status: 'queued', reason: null,
    conversation_id: null, run_id: null, skipped_count: 1, started_at: null, ended_at: null, viewed_at: null,
    approval_notified_at: null, model_config_id: task.model_config_id, permission_level: task.permission_level,
    schedule_generation: task.schedule_generation,
  };
}

export function skipReasonForActiveRun(state: ScheduledExecutionState | undefined): ScheduledTaskRunReason | null {
  if (state === 'awaiting_approval') return 'previous_awaiting_approval';
  if (state === 'running' || state === 'awaiting_answer') return 'previous_still_running';
  return null;
}

export function planScheduledOccurrences(input: {
  task: ScheduledTaskRecord; now: number; timezone: string; wake: boolean;
  queuedAtStartup?: ScheduledRunRecord; existing: (time: number) => ScheduledRunRecord | undefined;
  activeState?: ScheduledExecutionState;
}): ScheduledRunRecord[] {
  const { task, now, queuedAtStartup } = input;
  const elapsed = elapsedScheduledTimes(task.clock, task.checked_through_at, now, input.timezone);
  if (!elapsed && !queuedAtStartup) return [];
  const latest = elapsed?.latest ?? queuedAtStartup?.planned_at;
  if (latest === undefined) return [];
  const rows: ScheduledRunRecord[] = [];
  const skip = (run: ScheduledRunRecord, reason: ScheduledTaskRunReason, count = 1): ScheduledRunRecord => ({
    ...run, status: 'skipped', reason, skipped_count: count, ended_at: now,
  });
  const active = skipReasonForActiveRun(input.activeState);
  const missed = (input.wake && now - latest > SCHEDULED_TASK_MISSED_TOLERANCE_MS) || (queuedAtStartup !== undefined && elapsed === null);
  const reason = active ?? (missed && task.missed_policy === 'skip' ? 'missed_policy_skip'
    : missed && now - latest > SCHEDULED_TASK_CATCH_UP_WINDOW_MS ? 'outside_catch_up_window' : null);
  const trigger: ScheduledTaskRunTrigger = missed ? 'catch_up' : 'schedule';
  const earlier = (elapsed?.count ?? 0) + Number(Boolean(queuedAtStartup)) - 1;
  const groupAll = reason === 'missed_policy_skip' || reason === 'outside_catch_up_window';
  if (earlier > 0 && !groupAll) {
    const representative = queuedAtStartup?.planned_at ?? elapsed?.preceding;
    if (representative !== null && representative !== undefined) {
      const prior = input.existing(representative) ?? createScheduledRun(task, representative, 'catch_up');
      if (prior.status === 'queued') rows.push(skip(prior, active ?? (task.missed_policy === 'skip'
        ? 'missed_policy_skip' : 'outside_catch_up_window'), earlier));
    }
  }
  const existing = input.existing(latest);
  if (!existing || (queuedAtStartup?.id === existing.id)) {
    const candidate = { ...(existing ?? createScheduledRun(task, latest, trigger)), trigger };
    rows.push(reason ? skip(candidate, reason, groupAll ? earlier + 1 : 1) : candidate);
    if (groupAll && queuedAtStartup && queuedAtStartup.id !== candidate.id) rows.unshift({ ...queuedAtStartup, status: 'superseded', ended_at: now });
  }
  return rows;
}
