import {
  parseSSEExecutionScope,
  type BaseSSEEvent,
  type SSEExecutionScope,
} from '@linnlabs/linnkit/contracts';

import type {
  ExecutionProjectionState,
  MessageProjectionState,
  RunProjectionState,
} from '../state';

export interface ExecutionProjectionContext {
  readonly runState: RunProjectionState;
  readonly executionState: ExecutionProjectionState;
}

/**
 * 取得事件所属 execution 的在途状态。
 *
 * 同一个 execution_id 不得在运行中改绑 run；出现冲突说明上游身份串线，必须立即失败。
 */
export function ensureExecutionProjectionState(
  state: MessageProjectionState,
  event: Pick<BaseSSEEvent, 'run_id' | 'execution_id'>,
): ExecutionProjectionContext {
  const scope = parseSSEExecutionScope(event);
  const owningRunId = state.executionRunOwners.get(scope.execution_id);
  if (owningRunId && owningRunId !== scope.run_id) {
    throw new Error(
      `Execution ${scope.execution_id} changed run ownership: ${owningRunId} !== ${scope.run_id}`,
    );
  }

  let runState = state.runStates.get(scope.run_id);
  if (!runState) {
    runState = {
      runId: scope.run_id,
      toolState: new Map(),
      executionStates: new Map(),
    };
    state.runStates.set(scope.run_id, runState);
  }

  const existing = runState.executionStates.get(scope.execution_id);
  if (existing) {
    if (existing.runId !== scope.run_id) {
      throw new Error(
        `Execution ${scope.execution_id} changed run ownership: ${existing.runId} !== ${scope.run_id}`,
      );
    }
    return { runState, executionState: existing };
  }

  const created: ExecutionProjectionState = {
    runId: scope.run_id,
    executionId: scope.execution_id,
    turnState: new Map(),
    answerState: new Map(),
    thoughtBuffers: new Map(),
  };
  runState.executionStates.set(scope.execution_id, created);
  state.executionRunOwners.set(scope.execution_id, scope.run_id);
  return { runState, executionState: created };
}

/** transport 结束只释放本次 execution，不影响同 run 的工具实体或其它 execution。 */
export function releaseExecutionProjectionState(
  state: MessageProjectionState,
  scope: SSEExecutionScope,
): void {
  const owningRunId = state.executionRunOwners.get(scope.execution_id);
  if (owningRunId && owningRunId !== scope.run_id) {
    throw new Error(
      `Execution ${scope.execution_id} changed run ownership during release: ${owningRunId} !== ${scope.run_id}`,
    );
  }

  state.runStates.get(scope.run_id)?.executionStates.delete(scope.execution_id);
  state.executionRunOwners.delete(scope.execution_id);
}

/** terminal run 状态释放该 run 的全部在途 execution 与 run 级工具索引。 */
export function releaseRunProjectionState(
  state: MessageProjectionState,
  runId: string,
): void {
  const runState = state.runStates.get(runId);
  if (!runState) return;
  for (const executionId of runState.executionStates.keys()) {
    state.executionRunOwners.delete(executionId);
  }
  state.runStates.delete(runId);
}
