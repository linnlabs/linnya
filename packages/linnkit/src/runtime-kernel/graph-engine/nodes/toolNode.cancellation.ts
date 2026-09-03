import type { RoutedRuntimeEvent } from '../../../contracts';
import type { ToolCatalogPort } from '../../tools/ports';
import type { EngineState, StandardToolCall } from '../types';
import { prepareToolExecution, prepareToolNodeContext } from './toolNode.executionSetup';
import type { UnknownRecord } from './toolNode.helpers';
import type { ToolNodeEventBridge } from './toolNode.eventBridge';
import { stripAnswerState } from './toolNode.stateTransitions';

const CANCELLED_BEFORE_EXECUTION = 'Tool call was cancelled before execution because the run was aborted.';
const CANCELLED_DURING_EXECUTION = 'Tool call was cancelled during execution because the run was aborted.';

export function isToolExecutionAbort(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

/**
 * 执行中取消必须先补全当前调用与同 batch 未启动调用的 tool_output，再允许 AbortError 离开 ToolNode。
 * 事实由通用 ToolNode 创建；Host 和 UI 只能消费，不能扫描 loading 状态后补造结果。
 */
export function settleToolCallsAfterExecutionAbort(params: {
  readonly state: EngineState;
  readonly remainingCalls: readonly StandardToolCall[];
  readonly currentBridge: ToolNodeEventBridge;
  readonly toolCatalog: Pick<ToolCatalogPort, 'getToolDefinition'>;
}): RoutedRuntimeEvent[] {
  params.currentBridge.emitToolOutput({
    status: 'error',
    observation: CANCELLED_DURING_EXECUTION,
    error: CANCELLED_DURING_EXECUTION,
  });

  const prepared = prepareToolNodeContext(params.state);
  const events = params.currentBridge.getRuntimeEvents();
  events.push(...createPendingToolCancellationEvents({
    prepared,
    calls: params.remainingCalls,
    toolCatalog: params.toolCatalog,
  }));
  params.state.local = buildCancelledToolBatchLocalState(prepared.local, events);
  return events;
}

/**
 * 一个 assistant tool_calls batch 进入上下文后，每个调用都必须拥有配对的 tool_output。
 * 串行执行被取消时，尚未启动的调用由 ToolNode 在同一事实出口结算，不能留给 Host 或 UI 补造。
 */
export function settlePendingToolCallsAfterAbort(params: {
  readonly state: EngineState;
  readonly calls: readonly StandardToolCall[];
  readonly toolCatalog: Pick<ToolCatalogPort, 'getToolDefinition'>;
}): RoutedRuntimeEvent[] {
  if (params.calls.length === 0) {
    return [];
  }

  const prepared = prepareToolNodeContext(params.state);
  const events = createPendingToolCancellationEvents({
    prepared,
    calls: params.calls,
    toolCatalog: params.toolCatalog,
  });

  params.state.local = buildCancelledToolBatchLocalState(prepared.local, events);
  return events;
}

function createPendingToolCancellationEvents(params: {
  readonly prepared: ReturnType<typeof prepareToolNodeContext>;
  readonly calls: readonly StandardToolCall[];
  readonly toolCatalog: Pick<ToolCatalogPort, 'getToolDefinition'>;
}): RoutedRuntimeEvent[] {
  const events: RoutedRuntimeEvent[] = [];
  for (const call of params.calls) {
    const execution = prepareToolExecution({
      prepared: params.prepared,
      call,
      toolCatalog: params.toolCatalog,
    });
    if (!execution) {
      throw new Error(`Pending tool call ${call.id} has no tool name and cannot be settled.`);
    }
    execution.bridge.emitToolOutput({
      status: 'error',
      observation: CANCELLED_BEFORE_EXECUTION,
      error: CANCELLED_BEFORE_EXECUTION,
    });
    events.push(...execution.bridge.getRuntimeEvents());
  }
  return events;
}

function buildCancelledToolBatchLocalState(
  local: UnknownRecord,
  runtimeEvents: readonly RoutedRuntimeEvent[],
): UnknownRecord {
  const history = Array.isArray(local.history) ? local.history : [];
  return {
    ...stripAnswerState(local),
    pendingToolCalls: [],
    history: [...history, ...runtimeEvents],
  };
}
