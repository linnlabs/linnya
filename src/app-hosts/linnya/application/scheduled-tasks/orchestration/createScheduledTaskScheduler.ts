import {
  SCHEDULED_TASK_FAILURE_PAUSE_COUNT, SCHEDULED_TASK_MISSED_TOLERANCE_MS, SCHEDULED_TASK_UNVIEWED_PAUSE_MS,
  type ScheduledTaskNotification, type ScheduledTaskRunReason,
} from '@app/schemas/scheduled-tasks';
import type { ScheduledExecutionFact, ScheduledTaskPorts, ScheduledTaskSchedulerLifecycle } from '../definitions/scheduledTaskRuntime';
import type { ScheduledRunRecord, ScheduledTaskRecord } from '../definitions/scheduledTaskStore';
import { MINUTE_MS, createScheduleTimeZone, type ScheduleTimeZone } from '../functions/scheduleTime';
import { elapsedSince, readScheduledClock } from '../functions/scheduledClock';
import { planScheduledOccurrences } from '../functions/scheduledRunRules';

export function createScheduledTaskScheduler(ports: ScheduledTaskPorts) {
  const { store, execution } = ports;
  let accepting = false;
  let alarm: ReturnType<typeof setTimeout> | undefined;
  let previousCheck: { now: number; timezone: string; offset: number; anomalous: boolean } | undefined;
  let startupAdmissions: ScheduledRunRecord[] | undefined;
  const ownedAdmissions = new Set<string>();
  let work: Promise<unknown> = Promise.resolve();
  let pendingPoke = false;
  const approvalsWaitingForSlot = new Map<string, Array<() => void>>();

  function serialize<T>(operation: () => T | Promise<T>): Promise<T> {
    const result = work.then(operation);
    // 失败交还具体请求或分钟检查；后续写入仍按原顺序继续。
    work = result.then(() => undefined, () => undefined);
    return result;
  }

  function notify(event: ScheduledTaskNotification): void {
    void ports.notify(event).catch(error => ports.logError(`Scheduled task notification unavailable (${event.kind})`, error));
  }

  function finish(run: ScheduledRunRecord, status: 'completed' | 'failed' | 'interrupted', reason: ScheduledTaskRunReason | null): boolean {
    const { now, anomaly } = readScheduledClock(ports);
    const outcome = anomaly && status === 'failed' ? 'interrupted' : status;
    ownedAdmissions.delete(run.id);
    approvalsWaitingForSlot.delete(run.id);
    const result = store.transaction(() => {
      if (store.readRunAt(run.task_id, run.planned_at)?.status !== 'admitted') return undefined;
      const task = store.read(run.task_id);
      if (!task) return undefined;
      if (task.deleted_at !== null) {
        store.removeRun(run.id);
        return { task, autoPause: false };
      }
      const failures = anomaly ? task.consecutive_failures : outcome === 'failed' ? task.consecutive_failures + 1
        : outcome === 'completed' ? 0 : task.consecutive_failures;
      const oneShot = !anomaly && task.enabled
        && task.schedule.kind === 'once' && run.schedule_generation === task.schedule_generation;
      const autoPause = outcome === 'failed' && failures >= SCHEDULED_TASK_FAILURE_PAUSE_COUNT && task.enabled && !oneShot;
      store.writeRun({ ...run, status: outcome, reason, ended_at: now, approval_pending: 0,
        unread_since_at: outcome === 'completed' && !anomaly ? now : null });
      store.write({ ...task, consecutive_failures: failures,
        ...(oneShot || autoPause ? { enabled: false, paused_reason: oneShot ? 'one_shot_done' : 'failures', revision: task.revision + 1, updated_at: now } : {}) });
      return { task, autoPause };
    });
    if (!result) return false;
    ports.publish();
    const { task, autoPause } = result;
    if (task.deleted_at !== null) return true;
    if (run.conversation_id && outcome !== 'interrupted' && ports.measureStorage) {
      void ports.measureStorage(task.project_id, run.conversation_id).then(ports.publish)
        .catch(error => ports.logError(`Failed to measure scheduled conversation ${run.conversation_id}`, error));
    }
    if (outcome === 'completed' && run.conversation_id) notify({ kind: 'completed', task_id: task.id, task_name: task.name, conversation_id: run.conversation_id });
    if (outcome === 'failed' && reason) notify({ kind: 'failed', task_id: task.id, task_name: task.name, conversation_id: run.conversation_id, reason });
    if (autoPause) notify({ kind: 'auto_paused', task_id: task.id, task_name: task.name, cause: 'failures' });
    return true;
  }

  async function readFacts(runs: readonly ScheduledRunRecord[]): Promise<ReadonlyMap<string, ScheduledExecutionFact>> {
    const live = await execution.read(runs);
    const facts = new Map(live);
    for (const [id, fact] of live) {
      if (fact.state === 'running' && approvalsWaitingForSlot.has(id)) facts.set(id, { ...fact, state: 'awaiting_approval' });
    }
    return facts;
  }

  async function reconcile(): Promise<ReadonlyMap<string, ScheduledExecutionFact>> {
    const runs = store.pendingRuns().filter(run => run.status === 'admitted');
    if (runs.length === 0) return new Map();
    const facts = await readFacts(runs);
    for (const run of runs) {
      const fact = facts.get(run.id);
      if (!ownedAdmissions.has(run.id)) continue;
      if (fact?.state === 'completed') finish(run, 'completed', null);
      else if (fact?.state === 'failed') finish(run, 'failed', 'run_failed');
      else if (fact?.state === 'missing') finish(run, 'interrupted', 'app_quit');
      else if (fact?.state === 'interrupted') finish(run, 'interrupted', 'stopped_by_user');
      else if (fact) {
        const waiting = fact.state === 'awaiting_approval';
        const approval_pending: ScheduledRunRecord['approval_pending'] = waiting ? 1 : 0;
        if (waiting && run.approval_notified_at === null && run.conversation_id) {
          const task = store.read(run.task_id);
          if (!task || task.deleted_at !== null) continue;
          store.writeRun({ ...run, approval_pending, approval_notified_at: ports.now() });
          notify({ kind: 'awaiting_approval', task_id: task.id, task_name: task.name, conversation_id: run.conversation_id });
        } else if (approval_pending !== run.approval_pending) {
          store.writeRun({ ...run, approval_pending });
        }
      }
    }
    return facts;
  }

  async function recoverAdmissions(runs: ScheduledRunRecord[]): Promise<void> {
    const facts = await readFacts(runs);
    for (const run of runs) {
      const fact = facts.get(run.id);
      if (fact?.state === 'completed') finish(run, 'completed', null);
      else if (fact?.state === 'failed') finish(run, 'failed', 'run_failed');
      else {
        // 启动时当前 Flow 尚未接纳定时运行。上个进程的工具调用和审批承诺无法继续。
        const interrupted = finish(run, 'interrupted', 'app_quit');
        const task = store.read(run.task_id);
        if (interrupted && (fact?.state === 'awaiting_approval' || run.approval_pending === 1)
          && run.conversation_id && task?.deleted_at === null) {
          notify({ kind: 'awaiting_approval', interrupted: true, task_id: task.id,
            task_name: task.name, conversation_id: run.conversation_id });
        }
      }
    }
  }

  function enqueue(task: ScheduledTaskRecord, candidate: ScheduledRunRecord): boolean {
    return store.transaction(() => {
      if (!store.writeRun(candidate)) return false;
      if (candidate.status === 'queued') {
        for (const queued of store.pendingRuns()) {
          if (queued.task_id === task.id && queued.id !== candidate.id && queued.status === 'queued') {
            store.writeRun({ ...queued, status: 'superseded', ended_at: ports.now() });
          }
        }
      }
      return true;
    });
  }

  async function drain(): Promise<void> {
    while (accepting) {
      const facts = await reconcile();
      const pending = store.pendingRuns();
      const running = pending.filter(run => run.status === 'admitted'
        && (facts.get(run.id)?.state === 'running' || facts.get(run.id)?.state === 'missing')).length;
      if (!accepting || running >= ports.settings.read().max_concurrent_runs) return;
      const waiting = pending.find(run => approvalsWaitingForSlot.has(run.id) && facts.get(run.id)?.state === 'awaiting_approval');
      if (waiting) {
        const deliver = approvalsWaitingForSlot.get(waiting.id) ?? [];
        approvalsWaitingForSlot.delete(waiting.id);
        for (const resume of deliver) resume();
        continue;
      }
      const calendarEnabled = ports.schedulerEnabled && !readScheduledClock(ports).anomaly;
      const queued = pending.find(run => run.status === 'queued' && (run.trigger === 'manual' || (calendarEnabled && run.planned_at <= ports.now()))
        && !pending.some(other => other.status === 'admitted' && other.task_id === run.task_id));
      if (!queued) return;
      const task = store.read(queued.task_id);
      if (!task || task.deleted_at !== null) throw new Error(`Queued run ${queued.id} has no active task`);
      const modelId = task.model_config_id ?? ports.defaultModel();
      let admitted = { ...queued, status: 'admitted' as const, permission_level: task.permission_level,
        model_config_id: modelId, started_at: ports.now() };
      if (!store.claimRun(admitted)) continue;
      ownedAdmissions.add(admitted.id);
      if (modelId === null || !ports.modelAvailable(modelId)) {
        finish({ ...admitted, started_at: null }, 'failed', 'model_unavailable');
        continue;
      }
      try {
        const runId = await execution.start(task, admitted, modelId, conversationId => {
          admitted = { ...admitted, conversation_id: conversationId };
          store.writeRun(admitted);
        });
        store.writeRun({ ...admitted, run_id: runId });
        ports.publish();
      } catch (error) {
        ports.logError(`Failed to start scheduled task ${task.id}`, error);
        finish(admitted, 'failed', 'run_failed');
      }
    }
  }

  function checkSchedule(now: number, timezone: ScheduleTimeZone, offset: number, facts: ReadonlyMap<string, ScheduledExecutionFact>,
    options: { startup: boolean; wake: boolean; rollback: boolean; publish: boolean }): void {
    const notifications: ScheduledTaskNotification[] = [];
    let catchUpCount = 0;
    let changed = options.publish;
    store.transaction(() => {
      changed = store.clampFutureClockMarks(now) || changed;
      changed = store.anchorUnreadCompletions(now) || changed;
      const pending = store.pendingRuns();
      for (const task of store.list()) {
        // 用旧检查时刻重读偏移。正常 DST 边界只触发刷新，时区或历史规则变化才重新定基准。
        const zoneChanged = task.checked_timezone !== timezone.name
          || task.checked_timezone_offset !== timezone.offsetAt(task.checked_through_at);
        const rebasing = options.rollback || zoneChanged || task.checked_through_at - now > SCHEDULED_TASK_MISSED_TOLERANCE_MS;
        if (rebasing) {
          if (zoneChanged) discardAutomaticQueue(task.id, 'superseded');
          store.writeCheck(task.id, now, timezone.name, offset);
          changed = true;
          continue;
        }
        if (!task.enabled) continue;
        // 异常期间手动完成的一次性任务等时钟可信后再停用。
        if (task.schedule.kind === 'once' && store.hasCompletedRun(task.id, task.schedule_generation)) {
          store.write({ ...task, enabled: false, paused_reason: 'one_shot_done', revision: task.revision + 1, updated_at: now });
          discardAutomaticQueue(task.id);
          changed = true;
          continue;
        }
        const firstUnread = store.firstUnreadAt(task.id);
        if (firstUnread !== null && elapsedSince(now, Math.max(firstUnread, task.last_viewed_at ?? 0, task.unviewed_since_at)) >= SCHEDULED_TASK_UNVIEWED_PAUSE_MS) {
          store.write({ ...task, enabled: false, paused_reason: 'unviewed', revision: task.revision + 1, updated_at: now });
          discardAutomaticQueue(task.id);
          notifications.push({ kind: 'auto_paused', task_id: task.id, task_name: task.name, cause: 'unviewed' });
          changed = true;
          continue;
        }
        const active = pending.find(run => run.task_id === task.id && run.status === 'admitted');
        const queuedAtStartup = options.startup ? pending.find(run => run.task_id === task.id && run.status === 'queued'
          && run.trigger !== 'manual' && run.planned_at <= now) : undefined;
        const activeState = active ? facts.get(active.id)?.state : undefined;
        const candidates = planScheduledOccurrences({ task, now, timezone, queuedAtStartup, wake: options.wake,
          activeState: active && (!activeState || activeState === 'missing') ? 'running' : activeState,
          existing: time => store.readRunAt(task.id, time), hasLocalOccurrence: local => store.hasLocalOccurrence(task.id, local) });
        for (const candidate of candidates) {
          if (enqueue(task, candidate)) {
            changed = true;
            if (candidate.status === 'queued' && candidate.trigger === 'catch_up') catchUpCount++;
          }
        }
        if (now > task.checked_through_at) {
          if (task.schedule.kind === 'once' && candidates.length > 0 && !active
            && !store.pendingRuns().some(run => run.task_id === task.id)) {
            store.write({ ...task, enabled: false, paused_reason: 'one_shot_done', revision: task.revision + 1, updated_at: now });
            changed = true;
          }
          store.writeCheck(task.id, now, timezone.name, offset);
        }
      }
    });
    for (const event of notifications) notify(event);
    if (catchUpCount > 1) notify({ kind: 'catch_up', task_count: catchUpCount });
    if (changed) ports.publish();
  }

  function discardAutomaticQueue(taskId: string, status: 'skipped' | 'superseded' = 'skipped'): void {
    for (const run of store.pendingRuns()) {
      if (run.task_id === taskId && run.status === 'queued' && run.trigger !== 'manual') {
        store.writeRun({ ...run, status, reason: null, ended_at: ports.now() });
      }
    }
  }

  function scheduleNextCheck(): void {
    clearTimeout(alarm);
    if (!accepting || !ports.schedulerEnabled) return;
    alarm = setTimeout(() => { void tick().catch(error => ports.logError('Scheduled task minute check failed', error)).finally(scheduleNextCheck); },
      MINUTE_MS - ((ports.now() % MINUTE_MS + MINUTE_MS) % MINUTE_MS));
    alarm.unref();
  }

  function tick(before?: () => void): Promise<void> {
    return serialize(async () => {
      if (!accepting) return;
      before?.();
      const { now, anomaly } = readScheduledClock(ports);
      const startup = previousCheck === undefined || previousCheck.anomalous;
      const wake = startup || (previousCheck !== undefined && elapsedSince(now, previousCheck.now) > SCHEDULED_TASK_MISSED_TOLERANCE_MS);
      const rollback = !startup && previousCheck !== undefined && previousCheck.now - now > SCHEDULED_TASK_MISSED_TOLERANCE_MS;
      if (startupAdmissions !== undefined) {
        await recoverAdmissions(startupAdmissions);
        startupAdmissions = undefined;
      }
      const facts = await reconcile();
      if (!accepting) return;
      await ports.refreshTimezone?.();
      if (!accepting) return;
      const timezone = createScheduleTimeZone(ports.timezone());
      const offset = timezone.offsetAt(now);
      const zoneChanged = previousCheck !== undefined && previousCheck.timezone !== timezone.name;
      const publish = previousCheck !== undefined && (zoneChanged || previousCheck.offset !== offset || previousCheck.anomalous !== Boolean(anomaly));
      if (ports.schedulerEnabled && !anomaly) {
        checkSchedule(now, timezone, offset, facts, { startup, wake, rollback, publish });
      } else if (publish || (startup && anomaly)) ports.publish();
      previousCheck = { now, timezone: timezone.name, offset, anomalous: Boolean(anomaly) };
      await drain();
    });
  }

  async function stopRuns(taskId: string | undefined, reason: 'app_quit' | 'task_deleted' | 'project_deleted'): Promise<number> {
    const candidates = store.pendingRuns().filter(run => run.status === 'admitted' && (taskId === undefined ? ownedAdmissions.has(run.id) : run.task_id === taskId));
    const facts = await execution.read(candidates);
    let count = 0;
    for (const run of candidates) {
      const fact = facts.get(run.id);
      if (fact?.state === 'completed' || fact?.state === 'failed') {
        finish(run, fact.state, fact.state === 'failed' ? 'run_failed' : null);
        continue;
      }
      if (run.conversation_id && fact?.runId && ['running', 'awaiting_approval', 'awaiting_answer'].includes(fact.state)) {
        await execution.stop(run.conversation_id, fact.runId, reason);
        count++;
      }
      finish(run, 'interrupted', reason);
    }
    return count;
  }

  const lifecycle: ScheduledTaskSchedulerLifecycle = {
    start() {
      if (accepting) return;
      accepting = true;
      previousCheck = undefined;
      startupAdmissions = store.pendingRuns().filter(run => run.status === 'admitted');
      void tick().catch(error => ports.logError('Scheduled task startup check failed', error)).finally(scheduleNextCheck);
    },
    stop() {
      accepting = false;
      clearTimeout(alarm);
      return serialize(async () => { await stopRuns(undefined, 'app_quit'); });
    },
    async activeCount() {
      const facts = await readFacts(store.pendingRuns().filter(run => run.status === 'admitted'));
      return [...facts.values()].filter(fact => ['running', 'awaiting_approval', 'awaiting_answer'].includes(fact.state)).length;
    },
  };
  function poke(): void {
    if (!accepting || pendingPoke) return;
    pendingPoke = true;
    void serialize(async () => {
      pendingPoke = false;
      if (!accepting || store.pendingRuns().length === 0) return;
      await drain();
      ports.publish();
    }).catch(error => ports.logError('Scheduled task activity refresh failed', error));
  }

  return {
    lifecycle, serialize, tick, stopRuns, discardAutomaticQueue, enqueue, drain, poke, readFacts,
    recheck: (before: () => void) => tick(before).finally(scheduleNextCheck),
    deferApproval(conversationId: string, deliver: () => void): boolean {
      const run = store.readRunForConversation(conversationId);
      if (!run || run.status !== 'admitted') return false;
      const waiting = approvalsWaitingForSlot.get(run.id);
      if (waiting) waiting.push(deliver);
      else approvalsWaitingForSlot.set(run.id, [deliver]);
      poke();
      return true;
    },
  };
}
