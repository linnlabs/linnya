import type { CommandPermissionLevel } from '@app/schemas';
import type {
  ScheduledTaskCreateRequest, ScheduledTaskRunReason, ScheduledTaskRunStatus, ScheduledTaskRunTrigger,
} from '@app/schemas/scheduled-tasks';
import type { CompiledSchedule } from '../functions/scheduleTime';

export type SchedulePause = 'user' | 'failures' | 'unviewed' | 'one_shot_done';
export type ScheduledRunStage = Exclude<ScheduledTaskRunStatus, 'running' | 'awaiting_approval'> | 'admitted';

export interface TaskChangeActor {
  readonly conversationId: string;
  readonly rootRunId: string;
  readonly permission: CommandPermissionLevel;
}

export interface ScheduledTaskRecord extends ScheduledTaskCreateRequest {
  id: string;
  clock: CompiledSchedule;
  enabled: boolean;
  paused_reason: SchedulePause | null;
  consecutive_failures: number;
  last_viewed_at: number | null;
  unviewed_since_at: number;
  checked_through_at: number;
  checked_timezone: string | null;
  checked_timezone_offset: number | null;
  latest_checked_at: number;
  schedule_generation: number;
  created_by_kind: 'user' | 'agent';
  created_conversation_id: string | null;
  created_run_id: string | null;
  updated_run_id: string | null;
  created_at: number;
  updated_at: number;
  revision: number;
  deleted_at: number | null;
}

export interface ScheduledRunRecord {
  id: string;
  task_id: string;
  planned_at: number;
  planned_local: string | null;
  time_zone: string | null;
  trigger: ScheduledTaskRunTrigger;
  status: ScheduledRunStage;
  reason: ScheduledTaskRunReason | null;
  skipped_count: number;
  conversation_id: string | null;
  run_id: string | null;
  permission_level: CommandPermissionLevel;
  model_config_id: string | null;
  schedule_generation: number;
  started_at: number | null;
  ended_at: number | null;
  unread_since_at: number | null;
  viewed_at: number | null;
  approval_notified_at: number | null;
  approval_pending: 0 | 1;
}

export interface ScheduledTaskStore {
  transaction<T>(work: () => T): T;
  list(projectId?: string): ScheduledTaskRecord[];
  read(id: string): ScheduledTaskRecord | undefined;
  write(task: ScheduledTaskRecord): void;
  writeCheck(taskId: string, through: number, timezone: string, offset: number): void;
  latestClockEvidence(): number | null;
  recordChange(task: ScheduledTaskRecord, actor: TaskChangeActor, action: 'created' | 'updated'): void;
  listChanges(conversation: string, rootRunIds: readonly string[]): Array<{
    task_id: string; task_name: string; action: 'created' | 'updated'; permission: CommandPermissionLevel;
  }>;
  conversationTitle(id: string): string | null;
  writeRun(run: ScheduledRunRecord): boolean;
  claimRun(run: ScheduledRunRecord): boolean;
  readRuns(taskId: string, limit: number, before?: number): ScheduledRunRecord[];
  pendingRuns(): ScheduledRunRecord[];
  readRunAt(taskId: string, plannedAt: number): ScheduledRunRecord | undefined;
  hasLocalOccurrence(taskId: string, plannedLocal: string): boolean;
  hasCompletedRun(taskId: string, generation: number): boolean;
  readRunForConversation(conversationId: string): ScheduledRunRecord | undefined;
  runFacts(taskId: string): { run_count: number; unread_count: number };
  firstUnreadAt(taskId: string): number | null;
  /** 时钟曾跑到未来时写下的未读起点、查看时刻压回现在，14 天未看计时从现在算。 */
  clampFutureClockMarks(now: number): boolean;
  anchorUnreadCompletions(now: number): boolean;
  clearHistory(taskId: string): void;
  removeRun(id: string): void;
}
