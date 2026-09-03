import type { BaseMessage, Conversation } from '../../types';
import type { MessageProjectionState, ProjectionResult } from './state';
import { appendMessage, buildMessageIndex } from './helpers/messageAccess';

import { projectUserInputEvent } from './projectors/userInput';
import { projectThoughtEvent } from './projectors/thought';
import { projectFinalAnswerChunkEvent, projectFinalAnswerEvent } from './projectors/finalAnswer';
import { projectFinalAnswerResetEvent } from './projectors/finalAnswerReset';
import {
  projectToolCallDecisionEvent,
  projectToolProcessEvent,
  projectToolOutputEvent,
} from './projectors/tool';
import { projectSubRunTraceEvent } from './projectors/subrunTrace';
import { projectRunExecutionMetricsEvent } from './projectors/runExecutionMetrics';
import { projectContextUsageSnapshotEvent } from './projectors/contextUsageSnapshot';
import { projectTransportEndEvent } from './projectors/transportEnd';
import { projectRequiresUserInteractionEvent } from './projectors/requiresUserInteraction';
import { projectErrorEvent } from './projectors/error';
import {
  projectHistorySummaryEvent,
  projectSummarizationEndEvent,
  projectSummarizationErrorEvent,
  projectSummarizationStartEvent,
} from './projectors/summary';
import type { SSEEvent, UserInputEvent } from 'linnkit/contracts';
import {
  ensureExecutionProjectionState,
  releaseRunProjectionState,
} from './functions/executionProjectionState';
import { rebuildConversationCitationWorkspace } from './functions/rebuildCitationWorkspace';

export * from './state';
/**
 * Conversation projector 的正式输入。
 *
 * live 事件只接受 Linnkit SSEEvent；durable user_input 是唯一不进入 SSE、但需要生成
 * timeline message 的 Runtime fact。禁止为 replay 手抄最小事件接口或按 shape 猜类型。
 */
export type ProjectionEvent = SSEEvent | UserInputEvent;

export function createInitialProjectionState(conversation: Conversation): MessageProjectionState {
  const messages = [...conversation.messages];
  return {
    /**
     * 关键：必须与 Pinia/Vue 的 Conversation 引用彻底解耦
     *
     * 根因（性能 & 正确性）：
     * - projectionState 是“事件溯源的可回放内存态”，它必须是独立的数据源；
     * - 若复用外部 conversation.messages 的同一数组引用，投影阶段对 messages 的 push/patch
     *   会直接污染 Vue 状态，导致难以解释的渲染抖动、重复提交与性能雪崩；
     * - 因此这里显式拷贝 messages 数组（但消息对象本身允许被投影器就地更新）。
     */
    conversation: { ...conversation, messages },
    messageIndex: buildMessageIndex(messages),
    citationWorkspace: rebuildConversationCitationWorkspace(messages),
    runStates: new Map(),
    executionRunOwners: new Map(),
    processedEvents: new Set(),
  };
}

export function reduceEvent(state: MessageProjectionState, event: ProjectionEvent): ProjectionResult {
  if (!event) {
    return { success: false, reason: 'Event is null or undefined' };
  }

  const eventId = event.id;

  if (eventId && state.processedEvents.has(eventId)) {
    return {
      success: true,
      reason: 'Event already processed',
      newState: state,
    };
  }

  let result: ProjectionResult;

  try {
    switch (event.type) {
      case 'user_input':
        result = projectUserInputEvent(state, event);
        break;
      case 'thought':
        result = projectThoughtEvent(
          state,
          ensureExecutionProjectionState(state, event).executionState,
          event,
        );
        break;
      case 'final_answer_chunk':
        result = projectFinalAnswerChunkEvent(
          state,
          ensureExecutionProjectionState(state, event).executionState,
          event,
        );
        break;
      case 'final_answer':
        result = projectFinalAnswerEvent(
          state,
          ensureExecutionProjectionState(state, event).executionState,
          event,
        );
        break;
      case 'final_answer_reset':
        result = projectFinalAnswerResetEvent(
          state,
          ensureExecutionProjectionState(state, event).executionState,
          event,
        );
        break;
      case 'tool_call_decision': {
        const context = ensureExecutionProjectionState(state, event);
        result = projectToolCallDecisionEvent(
          state,
          context.runState,
          context.executionState,
          event,
        );
        break;
      }
      case 'tool_process': {
        const context = ensureExecutionProjectionState(state, event);
        result = projectToolProcessEvent(
          state,
          context.runState,
          context.executionState,
          event,
        );
        break;
      }
      case 'tool_output': {
        const context = ensureExecutionProjectionState(state, event);
        result = projectToolOutputEvent(
          state,
          context.runState,
          context.executionState,
          event,
        );
        break;
      }
      case 'subrun_trace': {
        const context = ensureExecutionProjectionState(state, event);
        result = projectSubRunTraceEvent(
          state,
          context.runState,
          event,
        );
        break;
      }
      case 'run_execution_metrics':
        result = projectRunExecutionMetricsEvent(state, event);
        break;
      case 'context_usage_snapshot':
        result = projectContextUsageSnapshotEvent(state, event);
        break;
      case 'transport_end':
        result = projectTransportEndEvent(state, event);
        break;
      case 'run_status':
        if (event.status === 'completed' || event.status === 'failed' || event.status === 'cancelled') {
          releaseRunProjectionState(state, event.run_id);
        }
        result = { success: true, newState: state };
        break;
      case 'transport_error':
        result = { success: true, newState: state };
        break;
      case 'requires_user_interaction': {
        const executionState = ensureExecutionProjectionState(state, event);
        result = projectRequiresUserInteractionEvent(
          state,
          executionState.runState,
          executionState.executionState,
          event,
        );
        break;
      }
      case 'history_summary':
        result = projectHistorySummaryEvent(state, event);
        break;
      case 'error':
        result = projectErrorEvent(state, event);
        break;
      case 'summarization_start':
        result = projectSummarizationStartEvent(state, event);
        break;
      case 'summarization_end':
        result = projectSummarizationEndEvent(state, event);
        break;
      case 'summarization_error':
        result = projectSummarizationErrorEvent(state, event);
        break;
      case 'markdown_chunk':
        // markdown_chunk 属于专用流式消费者，不生成 Conversation timeline message。
        result = { success: true, newState: state };
        break;
    }

    /**
     * 幂等去重：只在投影成功时登记 processedEvents
     *
     * 注意：reduceEvent 采用“就地投影（mutable state）”
     * - 根因：高频 SSE（final_answer_chunk / subrun_trace）下，全量拷贝 messages/Map/Set 会导致 O(n*m) 性能雪崩；
     * - 现有实现本就会就地更新 message 对象（并非真正不可变），因此保持“单一内存态”更一致更高性能。
     */
    if (result.success && eventId) {
      state.processedEvents.add(eventId);
    }

    return result;
  } catch (error) {
    return {
      success: false,
      reason: error instanceof Error ? error.message : 'Unknown error',
      newState: state,
    };
  }
}
