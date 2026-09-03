import { parseRoutedRuntimeEvent } from '../../contracts';
import type { RoutedRuntimeEvent, RuntimeEvent } from '../../contracts';

/**
 * 中文备注：
 * - 本文件是事件生命周期治理的唯一入口；
 * - 目标是把“是否持久化 / 是否进入上下文 / 是否属于工具决策”这些规则从散落判断收敛到单点；
 * - 后续新增事件时，优先修改这里，而不是去 bridge / orchestrator / converter / projector 各补一份条件。
 */

type TypedEvent = {
  type: string;
  metadata?: Record<string, unknown>;
  content?: string;
};

export type RuntimeEventUiProjectionKind =
  | 'hidden'
  | 'user_input'
  | 'thought'
  | 'final_answer'
  | 'final_answer_chunk'
  | 'final_answer_reset'
  | 'tool_call_decision'
  | 'tool_process'
  | 'tool_output'
  | 'requires_user_interaction'
  | 'audit_envelope'
  | 'subrun_trace'
  | 'error'
  | 'context_usage_snapshot'
  | 'run_execution_metrics'
  | 'history_summary'
  | 'unsupported';

export type RuntimeEventRealtimeChannel = 'event_bus_sse' | 'none';

export interface RuntimeEventLifecycleDecision {
  uiProjectionKind: RuntimeEventUiProjectionKind;
  persist: boolean;
  replayToUi: boolean;
  enterAgentContext: boolean;
  realtimeChannel: RuntimeEventRealtimeChannel;
}

/**
 * 类型级永不回放到 UI 的 RuntimeEvent。
 *
 * 中文备注：
 * - 这里只能放“仅凭 type 就能确定永不进入 UI 历史回放”的事件；
 * - `hidden user_input` 这类需要看 payload / metadata 的逐事件规则不能放进来；
 * - UI 历史分页会把这份清单下推到 SQL 层，避免巨型隐藏事件被 JSON.parse / 序列化。
 */
export const RUNTIME_EVENT_TYPES_NEVER_REPLAYED_TO_UI = [
  'audit_envelope',
  'final_answer_chunk',
  'final_answer_reset',
  'subrun_trace',
  'context_usage_snapshot',
] as const satisfies readonly RuntimeEvent['type'][];

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

export function isToolCallDecisionEvent<T extends { type: string }>(
  event: T,
): event is T & { type: 'tool_call_decision' } {
  return event.type === 'tool_call_decision';
}

export function isToolProcessEvent<T extends { type: string }>(
  event: T,
): event is T & { type: 'tool_process' } {
  return event.type === 'tool_process';
}

export function isSubRunTraceRuntimeEvent(
  event: RuntimeEvent,
): event is Extract<RuntimeEvent, { type: 'subrun_trace' }> {
  return event.type === 'subrun_trace';
}

export function isRunExecutionMetricsRuntimeEvent(
  event: RuntimeEvent,
): event is Extract<RuntimeEvent, { type: 'run_execution_metrics' }> {
  return event.type === 'run_execution_metrics';
}

export function isContextUsageSnapshotRuntimeEvent(
  event: RuntimeEvent,
): event is Extract<RuntimeEvent, { type: 'context_usage_snapshot' }> {
  return event.type === 'context_usage_snapshot';
}

export function isRequiresUserInteractionRuntimeEvent(
  event: RuntimeEvent,
): event is Extract<RuntimeEvent, { type: 'requires_user_interaction' }> {
  return event.type === 'requires_user_interaction';
}

export function isAuditEnvelopeRuntimeEvent(
  event: RuntimeEvent,
): event is Extract<RuntimeEvent, { type: 'audit_envelope' }> {
  return event.type === 'audit_envelope';
}

export function isControlRuntimeEvent(
  event: RuntimeEvent,
): event is Extract<RuntimeEvent, { type: 'control' }> {
  return event.type === 'control';
}

export function isHiddenUserInputEvent(event: RuntimeEvent): boolean {
  if (event.type !== 'user_input') {
    return false;
  }

  const metadata = isRecord(event.metadata) ? event.metadata : undefined;
  const ui = metadata && isRecord(metadata.ui) ? metadata.ui : undefined;
  return ui?.presentation === 'hidden';
}

export function isEmptyTerminalAssistantRuntimeEvent(event: RuntimeEvent): boolean {
  if (event.type !== 'thought' && event.type !== 'final_answer') {
    return false;
  }

  return event.content.trim().length === 0;
}

/**
 * Conversation 主时间线只接纳 foreground run 明确声明为 conversation 可见的事实。
 *
 * child / auxiliary facts 仍可持久化并进入各自的消费链，但不能因为共用
 * conversation_id 就被 durable UI read model 当作正文恢复。
 */
export function isConversationUiRuntimeEvent(event: RuntimeEvent): boolean {
  return event.lane === 'foreground' && event.visibility === 'conversation';
}

export function shouldPersistRuntimeEvent(event: RuntimeEvent): boolean {
  return describeRuntimeEventLifecycle(event).persist;
}

/**
 * EventStore 是 durable fact 边界。调用方若把实时进度直接写入存储，必须立即失败，
 * 不能静默忽略，否则真实发布链的旁路会被掩盖。
 */
export function requirePersistableRuntimeEvent<T extends RuntimeEvent>(event: T): T {
  if (!shouldPersistRuntimeEvent(event)) {
    throw new Error(`RuntimeEvent ${event.id} (${event.type}) is not eligible for persistence.`);
  }
  return event;
}

export function requirePersistableRoutedRuntimeEvent(event: RuntimeEvent): RoutedRuntimeEvent {
  requirePersistableRuntimeEvent(event);
  return parseRoutedRuntimeEvent(event);
}

export function shouldReplayRuntimeEventToUi(event: RuntimeEvent): boolean {
  return describeRuntimeEventLifecycle(event).replayToUi;
}

export function shouldEnterAgentContext(event: RuntimeEvent): boolean {
  return describeRuntimeEventLifecycle(event).enterAgentContext;
}

export function shouldCreateToolCallMessage(event: TypedEvent): boolean {
  return isToolCallDecisionEvent(event);
}

export function getRuntimeEventUiProjectionKind(
  event: RuntimeEvent,
): RuntimeEventUiProjectionKind {
  if (isHiddenUserInputEvent(event)) {
    return 'hidden';
  }

  switch (event.type) {
    case 'user_input':
      return 'user_input';
    case 'thought':
      return 'thought';
    case 'final_answer':
      return 'final_answer';
    case 'final_answer_chunk':
      return 'final_answer_chunk';
    case 'final_answer_reset':
      return 'final_answer_reset';
    case 'tool_call_decision':
      return 'tool_call_decision';
    case 'tool_process':
      return 'tool_process';
    case 'tool_output':
      return 'tool_output';
    case 'requires_user_interaction':
      return 'requires_user_interaction';
    case 'audit_envelope':
      return 'audit_envelope';
    case 'subrun_trace':
      return 'subrun_trace';
    case 'error':
      return 'error';
    case 'context_usage_snapshot':
      return 'context_usage_snapshot';
    case 'run_execution_metrics':
      return 'run_execution_metrics';
    case 'history_summary':
      return 'history_summary';
    default:
      return 'unsupported';
  }
}

export function describeRuntimeEventLifecycle(
  event: RuntimeEvent,
): RuntimeEventLifecycleDecision {
  const uiProjectionKind = getRuntimeEventUiProjectionKind(event);
  const persist = event.ephemeral !== true
    && !isToolProcessEvent(event)
    && !isSubRunTraceRuntimeEvent(event);

  const replayToUi = persist &&
    isConversationUiRuntimeEvent(event) &&
    uiProjectionKind !== 'hidden' &&
    uiProjectionKind !== 'audit_envelope' &&
    uiProjectionKind !== 'final_answer_chunk' &&
    uiProjectionKind !== 'final_answer_reset' &&
    uiProjectionKind !== 'unsupported';

  const enterAgentContext = (() => {
    if (uiProjectionKind === 'unsupported') {
      return false;
    }

    if (isSubRunTraceRuntimeEvent(event)) {
      return false;
    }

    if (isRunExecutionMetricsRuntimeEvent(event)) {
      return false;
    }

    if (isContextUsageSnapshotRuntimeEvent(event)) {
      return false;
    }

    if (event.type === 'error') {
      return false;
    }

    if (isRequiresUserInteractionRuntimeEvent(event)) {
      return false;
    }

    if (isAuditEnvelopeRuntimeEvent(event)) {
      return false;
    }

    if (isControlRuntimeEvent(event)) {
      return false;
    }

    if (isHiddenUserInputEvent(event)) {
      return false;
    }

    if (isToolProcessEvent(event)) {
      return false;
    }

    if (event.type === 'thought') {
      // thought 是供 UI / 审计消费的流式投影；模型侧 reasoning 的唯一事实源
      // 是同一次 Assistant 产出的 assistant_replay_parts，不能重复进入 Prompt。
      return false;
    }

    if (event.type === 'final_answer_chunk') {
      return false;
    }

    if (event.type === 'final_answer_reset') {
      return false;
    }

    if (isEmptyTerminalAssistantRuntimeEvent(event)) {
      return false;
    }

    return true;
  })();

  const realtimeChannel: RuntimeEventRealtimeChannel = (() => {
    switch (uiProjectionKind) {
      case 'thought':
      case 'final_answer':
      case 'final_answer_chunk':
      case 'final_answer_reset':
      case 'tool_call_decision':
      case 'tool_process':
      case 'tool_output':
      case 'requires_user_interaction':
      case 'subrun_trace':
      case 'error':
      case 'context_usage_snapshot':
      case 'run_execution_metrics':
      case 'history_summary':
        return 'event_bus_sse';
      case 'audit_envelope':
        return 'none';
      default:
        return 'none';
    }
  })();

  return {
    uiProjectionKind,
    persist,
    replayToUi,
    enterAgentContext,
    realtimeChannel,
  };
}

export function shouldEmitRuntimeEventToSse(event: RuntimeEvent): boolean {
  return describeRuntimeEventLifecycle(event).realtimeChannel === 'event_bus_sse';
}
