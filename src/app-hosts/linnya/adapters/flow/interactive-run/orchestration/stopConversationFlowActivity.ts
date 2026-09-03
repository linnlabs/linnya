import type { RunId } from '@linnlabs/linnkit/contracts';
import { runSupervisor } from '@linnlabs/linnkit/runtime-kernel';

import type { FlowExecutionCompletionRegistry } from './flowExecutionCompletionRegistry';

type FlowActivityStopStage =
  | 'cancel_run'
  | 'await_execution_completion'
  | 'missing_execution_completion'
  | 'missing_run_record'
  | 'discard_checkpoint'
  | 'release_cost'
  | 'active_child_after_root_settlement'
  | 'active_root_after_settlement';

export interface FlowActivityStopFailure {
  readonly runId: RunId;
  readonly stage: FlowActivityStopStage;
  readonly error: unknown;
}

export class FlowConversationActivityStopError extends Error {
  constructor(readonly failures: readonly FlowActivityStopFailure[]) {
    super(`Failed to settle ${failures.length} Flow conversation activity operation(s)`);
    this.name = 'FlowConversationActivityStopError';
  }
}

export interface FlowActivityRuntimePort {
  readonly supervisor: Pick<
    runSupervisor.RunSupervisor,
    'cancel' | 'findActiveByConversation' | 'findByConversation' | 'peek'
  >;
  readonly executionCompletions: FlowExecutionCompletionRegistry;
  readonly discardCheckpoint: (runId: RunId) => Promise<void>;
  readonly releaseCost: (runId: RunId) => void;
}

interface FlowRootActivity {
  readonly runId: RunId;
  readonly status: runSupervisor.RunSnapshot['status'];
  readonly completion?: Promise<void>;
}

type FlowRunTerminalStatus = Extract<
  runSupervisor.RunSnapshot['status'],
  'completed' | 'failed' | 'cancelled'
>;

export interface FlowRunCancellationSettlement {
  readonly outcome: 'cancelled' | 'already_terminal';
  readonly terminalStatus: FlowRunTerminalStatus;
}

function isTerminalStatus(
  status: runSupervisor.RunSnapshot['status']
): status is FlowRunTerminalStatus {
  return status === 'completed' || status === 'failed' || status === 'cancelled';
}

function mergePendingExecutions(
  target: Map<RunId, Promise<void>>,
  pending: ReturnType<FlowExecutionCompletionRegistry['snapshotPendingByConversation']>
): void {
  for (const execution of pending) {
    target.set(execution.runId, execution.completion);
  }
}

function isFlowRoot(
  run: runSupervisor.RunSnapshot,
  pendingRunIds: ReadonlySet<RunId>
): boolean {
  return (
    run.parentRunId === undefined &&
    (pendingRunIds.has(run.runId) || run.metadata?.originalSource === 'flow')
  );
}

function toFailure(
  runId: RunId,
  stage: FlowActivityStopStage,
  error: unknown
): FlowActivityStopFailure {
  return { runId, stage, error };
}

async function stopFlowRoot(
  activity: FlowRootActivity,
  runtime: FlowActivityRuntimePort,
  reason: string
): Promise<readonly FlowActivityStopFailure[]> {
  const isActive = !isTerminalStatus(activity.status);
  if (isActive && !activity.completion && activity.status !== 'awaiting_user') {
    return [
      toFailure(
        activity.runId,
        'missing_execution_completion',
        new Error(`Active Flow run ${activity.runId} has no Host execution completion`)
      ),
    ];
  }

  let cancellationError: unknown;
  if (isActive) {
    try {
      await runtime.supervisor.cancel(activity.runId, {
        reason,
        forceCleanup: true,
      });
    } catch (error: unknown) {
      cancellationError = error;
    }
  }

  if (activity.completion) {
    try {
      await activity.completion;
      // cancel 与自然完成竞争时，只允许忽略 Supervisor 明确报告的“目标已不存在”。
      // 持久化或控制锁等未知错误即使 Host 已收尾，也仍需交给调用方处理。
      if (cancellationError instanceof runSupervisor.RunNotFoundError) {
        cancellationError = undefined;
      }
    } catch (completionError: unknown) {
      const failures = [
        toFailure(activity.runId, 'await_execution_completion', completionError),
      ];
      if (cancellationError !== undefined) {
        failures.unshift(toFailure(activity.runId, 'cancel_run', cancellationError));
      }
      return failures;
    }
  }

  if (cancellationError !== undefined) {
    return [toFailure(activity.runId, 'cancel_run', cancellationError)];
  }

  const settledRun = await runtime.supervisor.peek(activity.runId);
  if (!settledRun) {
    return [
      toFailure(
        activity.runId,
        'missing_run_record',
        new Error(`Settled Flow run ${activity.runId} has no persistent run record`)
      ),
    ];
  }
  if (!isTerminalStatus(settledRun.status)) {
    return [
      toFailure(
        activity.runId,
        'active_root_after_settlement',
        new Error(`Flow root run ${activity.runId} remained active after settlement`)
      ),
    ];
  }

  // activity.status 是取消前快照，cancel 与自然完成竞争后必须重新读取持久终态。
  // completed 已证明 checkpoint 清理成功；若继续依据旧 active 快照清理，会把自然完成
  // 错当成取消完成，并重复释放已经结算的资源。
  if (settledRun.status === 'completed') {
    return [];
  }

  try {
    await runtime.discardCheckpoint(activity.runId);
  } catch (error: unknown) {
    return [toFailure(activity.runId, 'discard_checkpoint', error)];
  }

  try {
    runtime.releaseCost(activity.runId);
  } catch (error: unknown) {
    return [toFailure(activity.runId, 'release_cost', error)];
  }
  return [];
}

/** 单 run cancel 与 conversation cleanup 共用同一 Host completion 收尾规则。 */
export async function stopFlowRunAndWait(input: {
  readonly runId: RunId;
  readonly conversationId: string;
  readonly reason: string;
  readonly runtime: FlowActivityRuntimePort;
}): Promise<FlowRunCancellationSettlement> {
  const completionBeforeSnapshot = input.runtime.executionCompletions.findPending(input.runId);
  const snapshot = await input.runtime.supervisor.peek(input.runId);
  if (!snapshot) {
    throw new Error(`Run not found for cancellation: ${input.runId}`);
  }
  if (snapshot.conversationId !== input.conversationId) {
    throw new Error(
      `Run ${input.runId} belongs to conversation ${snapshot.conversationId}, not ${input.conversationId}`
    );
  }
  if (snapshot.parentRunId !== undefined) {
    throw new Error(`Run ${input.runId} is not a Flow root`);
  }
  const wasAlreadyTerminal = isTerminalStatus(snapshot.status);
  const completion =
    completionBeforeSnapshot ?? input.runtime.executionCompletions.findPending(input.runId);
  if (!wasAlreadyTerminal && !completion && snapshot.status !== 'awaiting_user') {
    throw new Error(`Active run ${input.runId} has no registered Flow execution completion`);
  }

  const failures = await stopFlowRoot(
    {
      runId: input.runId,
      status: snapshot.status,
      ...(completion ? { completion } : {}),
    },
    input.runtime,
    input.reason
  );
  if (failures.length === 1) {
    throw failures[0].error;
  }
  if (failures.length > 1) {
    throw new FlowConversationActivityStopError(failures);
  }

  const settledRun = await input.runtime.supervisor.peek(input.runId);
  if (!settledRun || !isTerminalStatus(settledRun.status)) {
    throw new Error(`Flow run ${input.runId} did not reach a persistent terminal status`);
  }
  return {
    outcome:
      wasAlreadyTerminal || settledRun.status !== 'cancelled'
        ? 'already_terminal'
        : 'cancelled',
    terminalStatus: settledRun.status,
  };
}

/**
 * 停止一个对话内全部 Flow root，并等待原 transport 的事实持久化与 Host finalize。
 *
 * cleanup job 已在调用前阻止新 admission；这里仍在异步 Supervisor 查询前后各捕获一次
 * completion，避免 run 状态先变终态、Host 收尾仍在进行时把对话目录提前删除。
 */
export async function stopConversationFlowActivity(input: {
  readonly conversationId: string;
  readonly runtime: FlowActivityRuntimePort;
}): Promise<void> {
  const pendingByRunId = new Map<RunId, Promise<void>>();
  mergePendingExecutions(
    pendingByRunId,
    input.runtime.executionCompletions.snapshotPendingByConversation(input.conversationId)
  );
  // completed 的结算顺序已经证明 checkpoint 清理成功，不应扫描和重复清理全部成功历史。
  // failed/cancelled 可能在终态后清理失败，因此继续作为 cleanup job 的持久发现事实。
  const conversationRuns = await input.runtime.supervisor.findByConversation(
    input.conversationId,
    { status: ['pending', 'running', 'awaiting_user', 'paused', 'failed', 'cancelled'] }
  );
  mergePendingExecutions(
    pendingByRunId,
    input.runtime.executionCompletions.snapshotPendingByConversation(input.conversationId)
  );
  const pendingRunIds = new Set(pendingByRunId.keys());

  const flowRootsByRunId = new Map(
    conversationRuns
    .filter(run => isFlowRoot(run, pendingRunIds))
    .map(run => [
      run.runId,
      {
        runId: run.runId,
        status: run.status,
        ...(pendingByRunId.has(run.runId)
          ? { completion: pendingByRunId.get(run.runId) }
          : {}),
      } satisfies FlowRootActivity,
    ] as const)
  );

  // execution 可能在持久查询期间先写 completed、后做 Host finalize。它不在上面的恢复
  // 状态集合里，但查询前后捕获的 completion 证明它仍是必须等待的当前 Flow root。
  for (const [runId, completion] of pendingByRunId) {
    if (flowRootsByRunId.has(runId)) continue;
    const run = await input.runtime.supervisor.peek(runId);
    if (run?.conversationId === input.conversationId && run.parentRunId === undefined) {
      flowRootsByRunId.set(runId, { runId, status: run.status, completion });
    }
  }

  const flowRoots = Array.from(flowRootsByRunId.values());
  const persistentRootIds = new Set(flowRoots.map(run => run.runId));

  const rootResults = await Promise.all(
    flowRoots.map(run =>
      stopFlowRoot(run, input.runtime, 'conversation deletion requested')
    )
  );
  const failures = rootResults.flat();
  const failedRootIds = new Set(failures.map(failure => failure.runId));

  for (const runId of pendingByRunId.keys()) {
    if (!persistentRootIds.has(runId)) {
      failures.push(
        toFailure(
          runId,
          'missing_run_record',
          new Error(`Pending Flow execution ${runId} has no persistent root run record`)
        )
      );
    }
  }

  const remaining = await input.runtime.supervisor.findActiveByConversation(
    input.conversationId,
    { includeChildren: true }
  );
  for (const run of remaining) {
    if (run.parentRunId !== undefined && run.metadata?.source === 'registered-child-run') {
      failures.push(
        toFailure(
          run.runId,
          'active_child_after_root_settlement',
          new Error(`Registered child run ${run.runId} remained active after Flow root settlement`)
        )
      );
    } else if (isFlowRoot(run, pendingRunIds) && !failedRootIds.has(run.runId)) {
      failures.push(
        toFailure(
          run.runId,
          'active_root_after_settlement',
          new Error(`Flow root run ${run.runId} remained active after settlement`)
        )
      );
    }
  }

  if (failures.length > 0) {
    throw new FlowConversationActivityStopError(failures);
  }
}
