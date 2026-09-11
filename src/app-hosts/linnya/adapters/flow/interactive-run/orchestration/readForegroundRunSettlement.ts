import type { ConversationRunSettlementResponse } from '@app/schemas';
import type { RunId } from '@linnlabs/linnkit/contracts';
import type { runSupervisor } from '@linnlabs/linnkit/runtime-kernel';
import { projectActiveForegroundRun } from '../functions/projectActiveForegroundRun';
import type { FlowExecutionCompletionRegistry } from './flowExecutionCompletionRegistry';

type RunSnapshot = runSupervisor.RunSnapshot;

export interface ReadForegroundRunSettlementInput {
  readonly conversationId: string;
  readonly runId: RunId;
  readonly supervisor: Pick<runSupervisor.RunSupervisor, 'findByConversation'>;
  readonly executionCompletions: Pick<FlowExecutionCompletionRegistry, 'findPending'>;
}

function selectRequestedRootRun(
  conversationId: string,
  runId: RunId,
  runs: readonly RunSnapshot[]
): RunSnapshot | undefined {
  const run = runs.find(candidate => candidate.runId === runId);
  if (!run) return undefined;
  if (run.conversationId !== conversationId) {
    throw new Error(`Run ${runId} belongs to another conversation`);
  }
  if (run.parentRunId) {
    throw new Error(`Run ${runId} is not a root conversation run`);
  }
  if (run.metadata?.lane !== 'foreground') {
    throw new Error(`Run ${runId} is not a foreground run`);
  }
  return run;
}

async function readRequestedRun(
  input: ReadForegroundRunSettlementInput
): Promise<RunSnapshot | undefined> {
  const runs = await input.supervisor.findByConversation(input.conversationId);
  return selectRequestedRootRun(input.conversationId, input.runId, runs);
}

/**
 * 读取 transport 对应 run 的权威控制态。
 *
 * completion registry 表示 Graph 事实、Host persistence 与 transport terminal 尚未全部
 * finalize。必须先跨过这个屏障再读 durable registry，不能用 timer 猜取消何时完成。
 */
export async function readForegroundRunSettlement(
  input: ReadForegroundRunSettlementInput
): Promise<ConversationRunSettlementResponse> {
  const pendingCompletion = input.executionCompletions.findPending(input.runId);
  let run = await readRequestedRun(input);
  // 订阅断开不停止 Backend；仍在执行时查询必须立即返回，不能等整个任务结束。
  // 已进入结算的状态仍须跨过事实写入/资源收口屏障。
  if (pendingCompletion && run?.status !== 'running' && run?.status !== 'pending') {
    await pendingCompletion;
    run = await readRequestedRun(input);
  }
  if (!run) {
    return {
      conversation_id: input.conversationId,
      requested_run_id: input.runId,
      run: null,
    };
  }

  if (
    run.status === 'pending' ||
    run.status === 'running' ||
    run.status === 'awaiting_user' ||
    run.status === 'paused'
  ) {
    const active = projectActiveForegroundRun(input.conversationId, [run]);
    return {
      conversation_id: input.conversationId,
      requested_run_id: input.runId,
      run: active.run,
    };
  }

  if (run.status !== 'completed' && run.status !== 'failed' && run.status !== 'cancelled') {
    throw new Error(`Run ${input.runId} has unsupported settlement status ${run.status}`);
  }

  return {
    conversation_id: input.conversationId,
    requested_run_id: input.runId,
    run: {
      run_id: run.runId,
      status: run.status,
      lane: 'foreground',
      error: run.errorIfAny
        ? {
            error_code: run.errorIfAny.errorCode,
            message: run.errorIfAny.message,
            recoverable: run.errorIfAny.recoverable,
          }
        : undefined,
    },
  };
}
