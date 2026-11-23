import {
  SCHEDULED_TASK_FAILURE_PAUSE_COUNT, SCHEDULED_TASK_MISSED_TOLERANCE_MS, SCHEDULED_TASK_UNVIEWED_PAUSE_MS,
  type ScheduledTaskNotification, type ScheduledTaskRunReason,
} from '@app/schemas/scheduled-tasks';
import type { ScheduledExecutionFact, ScheduledTaskPorts, ScheduledTaskSchedulerLifecycle } from '../definitions/scheduledTaskRuntime';
import type { ScheduledRunRecord, ScheduledTaskRecord } from '../definitions/scheduledTaskStore';
import { MINUTE_MS, nextScheduledTime } from '../functions/scheduleTime';
import { planScheduledOccurrences } from '../functions/scheduledRunRules';

export function createScheduledTaskScheduler(ports: ScheduledTaskPorts) {
  const { store, execution } = ports;
  let accepting = false;
  let alarm: ReturnType<typeof setTimeout> | undefined;
  let previousCheck: number | undefined;
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

  function finish(run: ScheduledRunRecord, status: 'completed' | 'failed' | 'interrupted', reason: ScheduledTaskRunReason | null): void {
    const now = ports.now();
    approvalsWaitingForSlot.delete(run.id);
    const task = store.read(run.task_id);
    if (!task) return;
    if (task.deleted_at !== null) {
      store.removeRun(run.id);
      ports.publish();
      return;
    }
    const failures = status === 'failed' ? task.consecutive_failures + 1 : status === 'completed' ? 0 : task.consecutive_failures;
    const oneShot = task.schedule.kind === 'once' && run.schedule_generation === task.schedule_generation;
    const autoPause = status === 'failed' && failures >= SCHEDULED_TASK_FAILURE_PAUSE_COUNT && task.enabled && !oneShot;
    store.transaction(() => {
      store.writeRun({ ...run, status, reason, ended_at: now });
      store.write({ ...task, consecutive_failures: failures,
        ...(oneShot || autoPause ? { enabled: false, paused_reason: oneShot ? 'one_shot_done' : 'failures', revision: task.revision + 1, updated_at: now } : {}) });
    });
    if (run.conversation_id && status !== 'interrupted' && ports.measureStorage) {
      void ports.measureStorage(task.project_id, run.conversation_id).then(ports.publish)
        .catch(error => ports.logError(`Failed to measure scheduled conversation ${run.conversation_id}`, error));
    }
    if (status === 'completed' && run.conversation_id) notify({ kind: 'completed', task_id: task.id, task_name: task.name, conversation_id: run.conversation_id });
    if (status === 'failed' && reason) notify({ kind: 'failed', task_id: task.id, task_name: task.name, conversation_id: run.conversation_id, reason });
    if (autoPause) notify({ kind: 'auto_paused', task_id: task.id, task_name: task.name, cause: 'failures' });
    ports.publish();
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
      if (fact?.state === 'completed') finish(run, 'completed', null);
      else if (fact?.state === 'failed') finish(run, 'failed', 'run_failed');
      else if (fact?.state === 'missing') finish(run, 'interrupted', 'app_quit');
      else if (fact?.state === 'interrupted') finish(run, 'interrupted', 'stopped_by_user');
      else if (fact?.state === 'awaiting_approval' && run.approval_notified_at === null && run.conversation_id) {
        const task = store.read(run.task_id);
        if (!task || task.deleted_at !== null) continue;
        store.writeRun({ ...run, approval_notified_at: ports.now() });
        notify({ kind: 'awaiting_approval', task_id: task.id, task_name: task.name, conversation_id: run.conversation_id });
      }
    }
    return facts;
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
      const running = [...facts.values()].filter(fact => fact.state === 'running').length;
      if (!accepting || running >= ports.settings.read().max_concurrent_runs) return;
      const pending = store.pendingRuns();
      const waiting = pending.find(run => approvalsWaitingForSlot.has(run.id) && facts.get(run.id)?.state === 'awaiting_approval');
      if (waiting) {
        const deliver = approvalsWaitingForSlot.get(waiting.id) ?? [];
        approvalsWaitingForSlot.delete(waiting.id);
        for (const resume of deliver) resume();
        continue;
      }
      const queued = pending.find(run => run.status === 'queued' && (ports.schedulerEnabled || run.trigger === 'manual')
        && !pending.some(other => other.status === 'admitted' && other.task_id === run.task_id));
      if (!queued) return;
      const task = store.read(queued.task_id);
      if (!task || task.deleted_at !== null) throw new Error(`Queued run ${queued.id} has no active task`);
      const modelId = task.model_config_id ?? ports.defaultModel();
      let admitted = { ...queued, status: 'admitted' as const, permission_level: task.permission_level,
        model_config_id: modelId, started_at: ports.now() };
      if (modelId === null || !ports.modelAvailable(modelId)) {
        finish({ ...admitted, started_at: null }, 'failed', 'model_unavailable');
        continue;
      }
      store.writeRun(admitted);
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

  function checkSchedule(now: number, facts: ReadonlyMap<string, ScheduledExecutionFact>, startup: boolean, wake: boolean): void {
    const timezone = ports.timezone();
    const pending = store.pendingRuns();
    const notifications: ScheduledTaskNotification[] = [];
    let catchUpCount = 0;
    let changed = false;
    store.transaction(() => {
      for (const task of store.list()) {
        if (!task.enabled) continue;
        const firstUnread = store.firstUnreadAt(task.id);
        if (firstUnread !== null && now - Math.max(firstUnread, task.last_viewed_at ?? 0, task.unviewed_since_at) >= SCHEDULED_TASK_UNVIEWED_PAUSE_MS) {
          store.write({ ...task, enabled: false, paused_reason: 'unviewed', revision: task.revision + 1, updated_at: now });
          discardAutomaticQueue(task.id);
          notifications.push({ kind: 'auto_paused', task_id: task.id, task_name: task.name, cause: 'unviewed' });
          changed = true;
          continue;
        }
        const active = pending.find(run => run.task_id === task.id && run.status === 'admitted');
        const queuedAtStartup = startup ? pending.find(run => run.task_id === task.id && run.status === 'queued' && run.trigger !== 'manual') : undefined;
        const candidates = planScheduledOccurrences({ task, now, timezone, queuedAtStartup, wake,
          activeState: active && facts.get(active.id)?.state, existing: time => store.readRunAt(task.id, time) });
        for (const candidate of candidates) {
          if (enqueue(task, candidate)) {
            changed = true;
            if (candidate.status === 'queued' && candidate.trigger === 'catch_up') catchUpCount++;
          }
        }
        if (now > task.checked_through_at) {
          const exhausted = task.schedule.kind === 'once' && !active
            && !store.pendingRuns().some(run => run.task_id === task.id)
            && nextScheduledTime(task.clock, now, timezone) === null;
          if (exhausted) {
            store.write({ ...task, checked_through_at: now, enabled: false,
              paused_reason: 'one_shot_done', revision: task.revision + 1, updated_at: now });
            changed = true;
          } else {
            store.advanceCheck(task.id, now);
          }
        }
      }
    });
    for (const event of notifications) notify(event);
    if (catchUpCount > 1) notify({ kind: 'catch_up', task_count: catchUpCount });
    if (changed) ports.publish();
  }

  function discardAutomaticQueue(taskId: string): void {
    for (const run of store.pendingRuns()) {
      if (run.task_id === taskId && run.status === 'queued' && run.trigger !== 'manual') {
        store.writeRun({ ...run, status: 'skipped', reason: null, ended_at: ports.now() });
      }
    }
  }

  function scheduleNextCheck(): void {
    if (!accepting || !ports.schedulerEnabled) return;
    alarm = setTimeout(() => { void tick().catch(error => ports.logError('Scheduled task minute check failed', error)).finally(scheduleNextCheck); },
      MINUTE_MS - (ports.now() % MINUTE_MS));
    alarm.unref();
  }

  function tick(): Promise<void> {
    return serialize(async () => {
      if (!accepting) return;
      const now = ports.now();
      const startup = previousCheck === undefined;
      const wake = startup || (previousCheck !== undefined && now - previousCheck > SCHEDULED_TASK_MISSED_TOLERANCE_MS);
      const facts = await reconcile();
      if (!accepting) return;
      if (ports.schedulerEnabled) checkSchedule(now, facts, startup, wake);
      previousCheck = now;
      await drain();
    });
  }

  async function stopRuns(taskId: string | undefined, reason: 'app_quit' | 'task_deleted' | 'project_deleted'): Promise<number> {
    const candidates = store.pendingRuns().filter(run => run.status === 'admitted' && (taskId === undefined || run.task_id === taskId));
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
