import type { TaskState } from '@app/schemas';

export interface TaskStateHistorySnapshot {
  readonly taskstate: TaskState;
  readonly version: number;
}

export interface NextTaskStateSnapshot {
  readonly taskstate: TaskState;
  readonly version: number;
  readonly operation: 'create' | 'update';
}
