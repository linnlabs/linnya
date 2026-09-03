import type { TaskState } from '@app/schemas';
import type { TaskStateStepRow } from '../functions/buildTaskStateStepRows';

export type TaskStatePresentationOperation = 'read' | 'write';

export type TaskStatePresentationData =
  | {
      readonly kind: 'lifecycle';
      readonly operation: TaskStatePresentationOperation;
    }
  | {
      readonly kind: 'missing';
      readonly operation: 'read';
    }
  | {
      readonly kind: 'snapshot';
      readonly operation: TaskStatePresentationOperation;
      readonly version: number;
      readonly taskstate: TaskState;
      readonly nextStepRows: readonly TaskStateStepRow[];
    };
