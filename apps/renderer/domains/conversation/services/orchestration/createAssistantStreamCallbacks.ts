import type { SSEEvent, SSEThoughtEvent } from 'linnkit/contracts';

import type { AssistantServiceCallbacks } from '../../types';
import type { ConversationStreamCallbacks } from '../conversationService';

interface CreateAssistantStreamCallbacksInput {
  readonly callbacks: AssistantServiceCallbacks;
  readonly routeEvent: (event: SSEEvent) => Promise<boolean>;
  readonly projectsConversationEvents: boolean;
  readonly signal: AbortSignal;
  readonly resolveExecutionFailureMessage: () => string;
}

/**
 * 统一两类 assistant 请求的 SSE 接线顺序。
 *
 * 统一路由负责会话投影；调用方回调只保留非统一模式的数据消费，以及工具副作用、编辑器
 * 流式写回和请求生命周期。这些职责不能因请求是首次发送还是 HITL 续跑而发生漂移。
 */
export function createAssistantStreamCallbacks(
  input: CreateAssistantStreamCallbacksInput,
): ConversationStreamCallbacks {
  const {
    callbacks,
    routeEvent,
    projectsConversationEvents,
    signal,
  } = input;

  return {
    onUserInputCommitted: event => callbacks.onUserInputCommitted?.(event),
    onThought: async (event) => {
      if (!await routeEvent(event)) return;
      if (projectsConversationEvents) return;
      const content = resolveThoughtContent(event);
      if (content !== undefined) await callbacks.onThought?.(content);
    },
    onToolCallDecision: async (event) => {
      if (!await routeEvent(event)) return;
      if (!projectsConversationEvents) await callbacks.onToolCall?.(event);
    },
    onToolProcess: async (event) => {
      if (!await routeEvent(event)) return;
      if (!projectsConversationEvents) await callbacks.onToolProcess?.(event);
    },
    onToolOutput: async (event) => {
      if (!await routeEvent(event)) return;
      // 工具副作用不属于消息投影，统一路由开启时仍必须交给调用方。
      await callbacks.onToolOutput?.(event);
    },
    onRequiresUserInteraction: async (event) => {
      await routeEvent(event);
    },
    onSubRunTrace: async (event) => {
      if (!await routeEvent(event)) return;
      // subrun trace 既参与统一投影，也可能承载调用方业务副作用；两条职责不能互相替代。
      await callbacks.onSubRunTrace?.(event);
    },
    onFinalAnswer: async (event) => {
      if (!await routeEvent(event)) return;
      await callbacks.onFinalAnswer?.(event);
    },
    onFinalAnswerChunk: async (event) => {
      if (!await routeEvent(event)) return;
      await callbacks.onFinalAnswerChunk?.(event);
    },
    onFinalAnswerReset: async (event) => {
      await routeEvent(event);
    },
    onError: async (event) => {
      if (!await routeEvent(event)) return;
      if (projectsConversationEvents) return;
      await callbacks.onError?.(new Error(
        event.error
        || (typeof event.details === 'string' ? event.details : '')
        || input.resolveExecutionFailureMessage(),
      ));
    },
    onRunExecutionMetrics: async (event) => {
      await routeEvent(event);
    },
    onContextUsageSnapshot: async (event) => {
      await routeEvent(event);
    },
    onRunStatus: async (event) => {
      await routeEvent(event);
    },
    onTransportEnd: async (event) => {
      // 取消后的本地 reader 收尾属于旧请求，不得触发投影或调用方收尾。
      if (signal.aborted) return;
      if (event) {
        // 会话投影可以因 lane/visibility 拒绝事件，但当前请求仍必须完成 transport 收尾。
        await routeEvent(event);
      }
      await callbacks.onTransportEnd?.(event);
    },
    onSummarizationStart: async (event) => {
      await routeEvent(event);
    },
    onSummarizationEnd: async (event) => {
      await routeEvent(event);
    },
    onSummarizationError: async (event) => {
      await routeEvent(event);
    },
  };
}

function resolveThoughtContent(event: SSEThoughtEvent): string | undefined {
  if (typeof event.delta === 'string') return event.delta;
  if (event.is_complete && typeof event.content === 'string') return event.content;
  return undefined;
}
