import {
  SCHEDULED_TASK_FAILURE_PAUSE_COUNT,
  type ScheduledTask,
  type ScheduledTaskRun,
  type ScheduledTaskRunReason,
} from '@app/schemas/scheduled-tasks';
import type { ScheduledTaskMessageKey, ScheduledTaskMessageResolver } from '../definitions/scheduledTaskMessages';

export type ScheduledTaskTone = 'neutral' | 'progress' | 'success' | 'warning' | 'error' | 'muted';

export interface ScheduledTaskPresentation {
  readonly text: string;
  readonly tone: ScheduledTaskTone;
}

/** 列表和详情里的一句状态。下次运行时间由调用方按当前语言格式化后传入。 */
export function presentTaskState(
  task: Pick<ScheduledTask, 'state'>,
  message: ScheduledTaskMessageResolver,
  nextRunText: string | null,
): ScheduledTaskPresentation {
  switch (task.state) {
    case 'scheduled':
      return nextRunText === null
        ? { text: message('scheduledTasks.detail.enabled'), tone: 'neutral' }
        : { text: message('scheduledTasks.state.scheduled', { time: nextRunText }), tone: 'neutral' };
    case 'running':
      return { text: message('scheduledTasks.state.running'), tone: 'progress' };
    case 'queued':
      return { text: message('scheduledTasks.state.queued'), tone: 'muted' };
    case 'awaiting_approval':
      return { text: message('scheduledTasks.state.awaitingApproval'), tone: 'warning' };
    case 'paused':
      return { text: message('scheduledTasks.state.paused'), tone: 'muted' };
    case 'paused_after_failures':
      return { text: message('scheduledTasks.state.pausedAfterFailures'), tone: 'error' };
    case 'paused_unviewed':
      return { text: message('scheduledTasks.state.pausedUnviewed'), tone: 'warning' };
    case 'finished':
      return { text: message('scheduledTasks.state.finished'), tone: 'muted' };
  }
}

/** 启用开关的状态：暂停（含自动暂停）为关，已结束的一次性任务不能再开。 */
export function isTaskEnabled(task: Pick<ScheduledTask, 'state'>): boolean {
  return task.state !== 'paused'
    && task.state !== 'paused_after_failures'
    && task.state !== 'paused_unviewed'
    && task.state !== 'finished';
}

export type ScheduledTaskBannerAction = 'open_approval' | 'resume' | 'edit';

export interface ScheduledTaskBanner {
  readonly text: string;
  readonly tone: ScheduledTaskTone;
  readonly action: { readonly kind: ScheduledTaskBannerAction; readonly label: string };
}

/** 详情顶部的提示：需要用户处理的情况才有，同一时间只给最要紧的一条。 */
export function resolveTaskBanner(
  task: Pick<ScheduledTask, 'state' | 'model_unavailable' | 'model_config_id' | 'consecutive_failures'>,
  message: ScheduledTaskMessageResolver,
): ScheduledTaskBanner | null {
  if (task.state === 'awaiting_approval') {
    return {
      text: message('scheduledTasks.banner.awaitingApproval'),
      tone: 'warning',
      action: { kind: 'open_approval', label: message('scheduledTasks.banner.awaitingApprovalAction') },
    };
  }
  if (task.state === 'paused_after_failures') {
    return {
      text: message('scheduledTasks.banner.pausedAfterFailures', {
        count: Math.max(task.consecutive_failures, SCHEDULED_TASK_FAILURE_PAUSE_COUNT),
      }),
      tone: 'error',
      action: { kind: 'resume', label: message('scheduledTasks.banner.resumeAction') },
    };
  }
  if (task.state === 'paused_unviewed') {
    return {
      text: message('scheduledTasks.banner.pausedUnviewed'),
      tone: 'warning',
      action: { kind: 'resume', label: message('scheduledTasks.banner.resumeAction') },
    };
  }
  if (task.model_unavailable && task.state !== 'finished') {
    return {
      text: message(task.model_config_id === null
        ? 'scheduledTasks.banner.defaultModelUnavailable'
        : 'scheduledTasks.banner.modelUnavailable'),
      tone: 'error',
      action: { kind: 'edit', label: message('scheduledTasks.banner.modelUnavailableAction') },
    };
  }
  return null;
}

const RUN_STATUS: Readonly<Record<ScheduledTaskRun['status'], { key: ScheduledTaskMessageKey; tone: ScheduledTaskTone }>> = {
  queued: { key: 'scheduledTasks.runStatus.queued', tone: 'muted' },
  running: { key: 'scheduledTasks.runStatus.running', tone: 'progress' },
  awaiting_approval: { key: 'scheduledTasks.runStatus.awaitingApproval', tone: 'warning' },
  completed: { key: 'scheduledTasks.runStatus.completed', tone: 'success' },
  failed: { key: 'scheduledTasks.runStatus.failed', tone: 'error' },
  skipped: { key: 'scheduledTasks.runStatus.skipped', tone: 'muted' },
  interrupted: { key: 'scheduledTasks.runStatus.interrupted', tone: 'warning' },
  superseded: { key: 'scheduledTasks.runStatus.superseded', tone: 'muted' },
};

const RUN_REASON: Readonly<Record<ScheduledTaskRunReason, ScheduledTaskMessageKey>> = {
  app_not_running: 'scheduledTasks.runReason.appNotRunning',
  previous_still_running: 'scheduledTasks.runReason.previousStillRunning',
  previous_awaiting_approval: 'scheduledTasks.runReason.previousAwaitingApproval',
  missed_policy_skip: 'scheduledTasks.runReason.missedPolicySkip',
  outside_catch_up_window: 'scheduledTasks.runReason.outsideCatchUpWindow',
  model_unavailable: 'scheduledTasks.runReason.modelUnavailable',
  run_failed: 'scheduledTasks.runReason.runFailed',
  app_quit: 'scheduledTasks.runReason.appQuit',
  stopped_by_user: 'scheduledTasks.runReason.stoppedByUser',
  task_deleted: 'scheduledTasks.runReason.taskDeleted',
  project_deleted: 'scheduledTasks.runReason.projectDeleted',
};

export function runReasonText(reason: ScheduledTaskRunReason, message: ScheduledTaskMessageResolver): string {
  return message(RUN_REASON[reason]);
}

export interface ScheduledTaskRunPresentation {
  /** 这次的结果：完成写用时，其余写状态和原因。 */
  readonly resultText: string;
  readonly tone: ScheduledTaskTone;
  /** 手动 / 补跑的小标记。 */
  readonly triggerText: string | null;
  /** 比计划晚了一分钟以上才开始、结果里又没写排队多久时，另写开始时刻；否则为 null。 */
  readonly lateStartAt: number | null;
}

const MINUTE_MS = 60_000;

/** 运行记录一行的结果。计划时刻与开始时刻由视图按时间格式另行显示。 */
export function presentRun(run: ScheduledTaskRun, message: ScheduledTaskMessageResolver): ScheduledTaskRunPresentation {
  const status = RUN_STATUS[run.status];
  const triggerText = run.trigger === 'manual'
    ? message('scheduledTasks.runs.manual')
    : run.trigger === 'catch_up' ? message('scheduledTasks.runs.catchUp') : null;
  const waited = run.started_at === null ? 0 : run.started_at - run.planned_at;
  let lateStartAt = waited >= MINUTE_MS ? run.started_at : null;
  let detail = '';
  if (run.reason) {
    const reason = runReasonText(run.reason, message);
    detail = run.skipped_count > 1
      ? message('scheduledTasks.runs.skippedTimes', { reason, count: run.skipped_count })
      : reason;
  } else if (run.status === 'completed' && run.started_at !== null && run.ended_at !== null) {
    if (run.trigger === 'schedule' && waited >= MINUTE_MS) {
      lateStartAt = null;
      detail = message('scheduledTasks.runs.queuedWait', { minutes: Math.round(waited / MINUTE_MS) });
    } else {
      const took = run.ended_at - run.started_at;
      detail = took < MINUTE_MS
        ? message('scheduledTasks.runs.durationUnderMinute')
        : message('scheduledTasks.runs.duration', { minutes: Math.round(took / MINUTE_MS) });
    }
  }
  const statusText = message(status.key);
  const resultText = detail === '' ? statusText
    : run.status === 'completed' ? detail
      : message('scheduledTasks.runs.statusWithDetail', { status: statusText, detail });
  return { resultText, tone: status.tone, triggerText, lateStartAt };
}

export interface ScheduledTaskProjectGroup {
  readonly projectId: string;
  readonly projectName: string | null;
  readonly tasks: readonly ScheduledTask[];
}

/** 列表分组：有任务的当前项目在前，其余按项目名排；项目内保持 App Server 给的顺序。 */
export function groupTasksByProject(
  tasks: readonly ScheduledTask[],
  currentProjectId: string | null,
  projectName: (projectId: string) => string | null,
  locale: string,
): readonly ScheduledTaskProjectGroup[] {
  const byProject = new Map<string, ScheduledTask[]>();
  for (const task of tasks) {
    const list = byProject.get(task.project_id) ?? [];
    list.push(task);
    byProject.set(task.project_id, list);
  }
  const collator = new Intl.Collator(locale);
  return [...byProject.entries()]
    .map(([projectId, list]) => ({ projectId, projectName: projectName(projectId), tasks: list }))
    .sort((a, b) => {
      if (a.projectId === currentProjectId) return -1;
      if (b.projectId === currentProjectId) return 1;
      if (a.projectName === null) return 1;
      if (b.projectName === null) return -1;
      return collator.compare(a.projectName, b.projectName);
    });
}
