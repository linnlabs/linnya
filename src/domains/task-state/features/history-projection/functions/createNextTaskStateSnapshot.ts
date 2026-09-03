import type { TaskState } from '@app/schemas';
import type { RuntimeEvent } from '@linnlabs/linnkit/contracts';

import type { NextTaskStateSnapshot } from '../definitions/taskStateHistorySnapshot';
import { readLatestTaskStateSnapshot } from './readLatestTaskStateSnapshot';

export function createNextTaskStateSnapshot(params: {
  readonly history: ReadonlyArray<RuntimeEvent>;
  readonly taskstate: TaskState;
}): NextTaskStateSnapshot {
  const previous = readLatestTaskStateSnapshot(params.history);
  return {
    taskstate: params.taskstate,
    version: (previous?.version ?? 0) + 1,
    operation: previous ? 'update' : 'create',
  };
}
