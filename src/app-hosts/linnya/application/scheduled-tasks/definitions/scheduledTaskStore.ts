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
  viewed_at: number | null;
  approval_notified_at: number | null;
}

export interface ScheduledTaskStore {
  transaction<T>(work: () => T): T;
  list(projectId?: string): ScheduledTaskRecord[];
  read(id: string): ScheduledTaskRecord | undefined;
  write(task: ScheduledTaskRecord): void;
  advanceCheck(taskId: string, through: number): void;
  recordChange(task: ScheduledTaskRecord, actor: TaskChangeActor, action: 'created' | 'updated'): void;
  listChanges(conversation: string, rootRunIds: readonly string[]): Array<{
    task_id: string; task_name: string; action: 'created' | 'updated'; permission: CommandPermissionLevel;
  }>;
  conversationTitle(id: string): string | null;
  writeRun(run: ScheduledRunRecord): boolean;
  readRuns(taskId: string, limit: number, before?: number): ScheduledRunRecord[];
  pendingRuns(): ScheduledRunRecord[];
  readRunAt(taskId: string, plannedAt: number): ScheduledRunRecord | undefined;
  readRunForConversation(conversationId: string): ScheduledRunRecord | undefined;
  runFacts(taskId: string): { run_count: number; unread_count: number };
  firstUnreadAt(taskId: string): number | null;
  clearHistory(taskId: string): void;
  removeRun(id: string): void;
}
