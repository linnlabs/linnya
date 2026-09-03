/**
 * @file apps/renderer/domains/conversation/services/conversationService.ts
 * @description AI 助手会话 API 客户端
 * 
 * @brief 职责划分
 * 功能 (What): 封装对后端 `/api/v1/conversation/next` 接口的底层网络调用。
 * 输入 (Input): 符合后端契约的请求对象 (`ConversationNextRequest`)、一组回调函数和 AbortSignal。
 * 输出 (Output): 通过回调函数实时分发后端推送的 Server-Sent Events (SSE)。
 * 副作用 (Side-effects): 发起 fetch 网络请求。
 * 
 * @design 核心设计
 * 本文件是纯粹的“网络层”或“信使 (Messenger)”。它不包含任何业务逻辑，
 * 比如如何构建请求、如何处理思考标签 (`<think>`) 等。
 * 它的唯一职责就是：
 * 1. 发送格式正确的请求到后端。
 * 2. 忠实地解析 SSE 数据流。
 * 3. 将解析出的事件分发给上层调用者（通常是 `assistantService`）。
 */

import { apiFetch, getApiBaseUrl } from '../../../shared/services/aiService/common';
import { normalizeHttpErrorPayload } from './errorNormalizer';
import { resolveCurrentConversationMessage } from '../functions/resolveCurrentConversationMessage';
import { isRecord } from '../utils/typeGuards';
import type {
  ConversationTransportError,
  ConversationTransportOutcome,
} from '../definitions/conversationTransport';
import type { 
  ConversationUserInputCommittedEvent,
  ConversationInteractionResponseRequest,
  ConversationNextRequest, 
  IncrementalEvent
} from '@app/schemas';
import { ConversationUserInputCommittedEventSchema } from '@app/schemas';
import {
  createServerSentEventFrameParser,
  validateSSEEvent,
  type ServerSentEventFrame,
} from '@linnlabs/linnkit/contracts';
import type {
  SSEErrorEvent,
  SSEContextUsageSnapshotEvent,
  SSEFinalAnswerChunkEvent,
  SSEFinalAnswerEvent,
  SSEFinalAnswerResetEvent,
  SSERequiresUserInteractionEvent,
  SSERunExecutionMetricsEvent,
  SSERunStatusEvent,
  SSESubRunTraceEvent,
  SSESummarizationEndEvent,
  SSESummarizationErrorEvent,
  SSESummarizationStartEvent,
  SSEThoughtEvent,
  SSEToolCallDecisionEvent,
  SSEToolOutputEvent,
  SSEToolProcessEvent,
  SSETransportEndEvent,
} from '@linnlabs/linnkit/contracts';

// 已移除模块加载时的 console.log：避免在控制台产生常驻噪音日志

export type { IncrementalEvent, ConversationNextRequest };

type StreamCallbackResult = void | Promise<void>;

export type { ConversationTransportError, ConversationTransportOutcome };

/**
 * @interface ConversationStreamCallbacks
 * @description 定义了一组回调函数，用于处理从后端 SSE 流接收到的各种实时事件。
 * 使用 @app/schemas 中的强类型事件定义，确保类型安全。
 */
export interface ConversationStreamCallbacks {
  /** host 已将 user input 与附件原子提交后的 app-level确认。 */
  onUserInputCommitted?: (e: ConversationUserInputCommittedEvent) => StreamCallbackResult;
  /** 接收到思考过程事件 (`thought`) */
  onThought?: (e: SSEThoughtEvent) => StreamCallbackResult;
  /** 接收到模型工具决策事件 (`tool_call_decision`) */
  onToolCallDecision?: (e: SSEToolCallDecisionEvent) => StreamCallbackResult;
  /** 接收到工具执行过程事件 (`tool_process`) */
  onToolProcess?: (e: SSEToolProcessEvent) => StreamCallbackResult;
  /** 接收到工具执行输出事件 (`tool_output`) */
  onToolOutput?: (e: SSEToolOutputEvent) => StreamCallbackResult;
  /**
   * ✅ SubRun Trace Channel：子 run 过程事件（`subrun_trace`）
   *
   * @description
   * - 该事件不会投影为主时间轴消息，而是挂载到父 tool_calls message.metadata.subrunTrace 中；
   * - 因此前端必须把该事件交给统一投影系统（projectionStore/messageProjection）处理。
   */
  onSubRunTrace?: (e: SSESubRunTraceEvent) => StreamCallbackResult;
  /** 接收到完整的最终答案事件 (`final_answer`) */
  onFinalAnswer?: (e: SSEFinalAnswerEvent) => StreamCallbackResult;
  /** 接收到流式的最终答案片段事件 (`final_answer_chunk`) */
  onFinalAnswerChunk?: (e: SSEFinalAnswerChunkEvent) => StreamCallbackResult;
  /** 丢弃失败 attempt 的在途答案与思考 (`final_answer_reset`) */
  onFinalAnswerReset?: (e: SSEFinalAnswerResetEvent) => StreamCallbackResult;
  /** 接收到需要用户交互的事件 (`requires_user_interaction`) */
  onRequiresUserInteraction?: (e: SSERequiresUserInteractionEvent) => StreamCallbackResult;
  /** 接收到错误事件 (`error`) */
  onError?: (e: SSEErrorEvent) => StreamCallbackResult;
  /** run 接纳前或客户端网络层发生的 transport error。 */
  onTransportError?: (e: ConversationTransportError) => StreamCallbackResult;
  /** 本 execution 的 durable 统计事实。 */
  onRunExecutionMetrics?: (e: SSERunExecutionMetricsEvent) => StreamCallbackResult;
  /** 最近一次成功 LLM Prompt 的实时上下文占用快照。 */
  onContextUsageSnapshot?: (e: SSEContextUsageSnapshotEvent) => StreamCallbackResult;
  /** RunRegistry 权威状态的实时投影。 */
  onRunStatus?: (e: SSERunStatusEvent) => StreamCallbackResult;
  /** 接收到摘要开始事件 (`summarization_start`) */
  onSummarizationStart?: (e: SSESummarizationStartEvent) => StreamCallbackResult;
  /** 接收到摘要结束事件 (`summarization_end`) */
  onSummarizationEnd?: (e: SSESummarizationEndEvent) => StreamCallbackResult;
  /** 接收到摘要失败事件 (`summarization_error`) */
  onSummarizationError?: (e: SSESummarizationErrorEvent) => StreamCallbackResult;
  /** 当前请求 reader 的 transport completion；本地失败时没有服务端 event。 */
  onTransportEnd?: (e?: SSETransportEndEvent) => StreamCallbackResult;
}

class SseCallbackDispatchError extends Error {
  readonly cause: unknown;

  constructor(eventType: string, data: unknown, error: unknown) {
    const eventId = isRecord(data) && typeof data.id === 'string' ? data.id : 'unknown';
    const reason = error instanceof Error ? error.message : String(error);
    super(`SSE callback failed: type=${eventType}, id=${eventId}, reason=${reason}`);
    this.name = 'SseCallbackDispatchError';
    this.cause = error;
  }
}

class SseProtocolError extends Error {
  readonly cause: unknown;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'SseProtocolError';
    this.cause = cause;
  }
}

function createSseCallbackDispatchError(
  eventType: string,
  data: unknown,
  error: unknown,
): SseCallbackDispatchError {
  return new SseCallbackDispatchError(eventType, data, error);
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error
    ? error.name === 'AbortError'
    : isRecord(error) && error.name === 'AbortError';
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

async function publishTransportOutcome(
  callbacks: ConversationStreamCallbacks,
  outcome: ConversationTransportOutcome,
): Promise<ConversationTransportOutcome> {
  if (outcome.kind === 'failed') {
    await callbacks.onTransportError?.(outcome.failure);
  }
  if (outcome.event) {
    await callbacks.onTransportEnd?.(outcome.event);
  } else {
    await callbacks.onTransportEnd?.();
  }
  return outcome;
}

/**
 * @function streamConversation
 * @description 核心函数，用于向后端发送会话请求并发起一个长连接来接收流式事件。
 * 
 * @param req {ConversationNextRequest} - 发送给后端的请求对象，包含新事件和各种选项。
 * @param callbacks {ConversationStreamCallbacks} - 用于处理流式事件的回调函数集合。
 * @param signal {AbortSignal | undefined} - 用于中断 fetch 请求的 AbortSignal。
 * 
 * @returns {Promise<void>} - 该函数本身不返回数据，所有数据都通过回调函数进行处理。
 */
export async function streamConversation(
  req: ConversationNextRequest | ConversationInteractionResponseRequest,
  callbacks: ConversationStreamCallbacks,
  signal?: AbortSignal,
  endpoint = '/api/v1/conversation/next',
): Promise<ConversationTransportOutcome> {
  let response: Response;
  try {
    const baseUrl = await getApiBaseUrl();
    response = await apiFetch(`${baseUrl}${endpoint}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'text/event-stream',
        'Cache-Control': 'no-cache',
      },
      body: JSON.stringify(req),
      signal,
    });
  } catch (error) {
    if (isAbortError(error)) {
      return publishTransportOutcome(callbacks, { kind: 'interrupted' });
    }
    return publishTransportOutcome(callbacks, {
      kind: 'failed',
      failure: {
        source: 'client',
        kind: 'network',
        error: toError(error),
      },
    });
  }

  // 处理请求失败的情况
  if (!response.ok) {
    const bodyText = await readResponseBodyText(response);
    const normalized = normalizeHttpErrorPayload({
      status: response.status,
      statusText: response.statusText,
      bodyText,
    }, {
      resolveMessage: resolveCurrentConversationMessage,
    });
    return publishTransportOutcome(callbacks, {
      kind: 'failed',
      failure: {
        source: 'client',
        kind: 'http',
        error: new Error(normalized.userMessage),
        ...(normalized.errorCode ? { errorCode: normalized.errorCode } : {}),
        ...(normalized.retryable === undefined ? {} : { retryable: normalized.retryable }),
        details: {
          ...normalized.details,
          ...(normalized.rawMessage === undefined ? {} : { rawMessage: normalized.rawMessage }),
        },
      },
    });
  }
  if (!response.body) {
    return publishTransportOutcome(callbacks, {
      kind: 'failed',
      failure: {
        source: 'client',
        kind: 'protocol',
        error: new Error('SSE response is missing a readable body'),
        errorCode: 'SSE_BODY_MISSING',
      },
    });
  }
  
  const reader = response.body.getReader();
  const frameParser = createServerSentEventFrameParser();
  let transportEndEvent: SSETransportEndEvent | undefined;
  let transportFailure: ConversationTransportError | undefined;
  let reachedReaderEnd = false;
  let wasInterrupted = false;

  const dispatchFrame = async (frame: ServerSentEventFrame): Promise<void> => {
    // fetch 取消后 reader 仍可能吐出已缓冲 frame；这些事件仍属于旧请求。
    signal?.throwIfAborted();
    const eventType = frame.event ?? 'message';
    let data: unknown;
    try {
      data = JSON.parse(frame.data) as unknown;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new SseProtocolError(
        `Invalid SSE JSON payload: event=${eventType}, reason=${reason}`,
        error,
      );
    }

    if (eventType === 'user_input_committed') {
      let event: ConversationUserInputCommittedEvent;
      try {
        event = ConversationUserInputCommittedEventSchema.parse(data);
      } catch (error) {
        throw new SseProtocolError(
          `Invalid SSE payload for event=${eventType}: ${toError(error).message}`,
          error,
        );
      }
      try {
        await callbacks.onUserInputCommitted?.(event);
      } catch (error) {
        throw createSseCallbackDispatchError(eventType, data, error);
      }
      return;
    }

    const validation = validateSSEEvent(data);
    if (!validation.success) {
      throw new SseProtocolError(
        `Invalid SSE payload for event=${eventType}: ${validation.error.message}`,
      );
    }
    const event = validation.data;
    if (event.type !== eventType) {
      throw new SseProtocolError(
        `SSE event name/payload mismatch: event=${eventType}, payload=${event.type}`,
      );
    }

    try {
      // 回调必须严格串行，父工具事件要先于它的 subrun trace 完成投影。
      switch (event.type) {
        case 'thought':
          await callbacks.onThought?.(event);
          break;
        case 'tool_call_decision':
          await callbacks.onToolCallDecision?.(event);
          break;
        case 'tool_process':
          await callbacks.onToolProcess?.(event);
          break;
        case 'tool_output':
          await callbacks.onToolOutput?.(event);
          break;
        case 'subrun_trace':
          await callbacks.onSubRunTrace?.(event);
          break;
        case 'final_answer':
          await callbacks.onFinalAnswer?.(event);
          break;
        case 'final_answer_chunk':
          await callbacks.onFinalAnswerChunk?.(event);
          break;
        case 'final_answer_reset':
          await callbacks.onFinalAnswerReset?.(event);
          break;
        case 'requires_user_interaction':
          await callbacks.onRequiresUserInteraction?.(event);
          break;
        case 'error':
          await callbacks.onError?.(event);
          break;
        case 'transport_error':
          transportFailure = { source: 'server', event };
          break;
        case 'run_execution_metrics':
          await callbacks.onRunExecutionMetrics?.(event);
          break;
        case 'context_usage_snapshot':
          await callbacks.onContextUsageSnapshot?.(event);
          break;
        case 'run_status':
          await callbacks.onRunStatus?.(event);
          break;
        case 'summarization_start':
          await callbacks.onSummarizationStart?.(event);
          break;
        case 'summarization_end':
          await callbacks.onSummarizationEnd?.(event);
          break;
        case 'summarization_error':
          await callbacks.onSummarizationError?.(event);
          break;
        case 'transport_end':
          transportEndEvent = event;
          break;
        default:
          break;
      }
    } catch (error) {
      throw createSseCallbackDispatchError(eventType, data, error);
    }
  };

  // 循环读取和解析 SSE 数据流
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        for (const frame of frameParser.finish()) {
          await dispatchFrame(frame);
        }
        reachedReaderEnd = true;
        if (!transportEndEvent && !transportFailure) {
          transportFailure = {
            source: 'client',
            kind: 'protocol',
            error: new Error('SSE connection closed before transport_end'),
            errorCode: 'SSE_UNEXPECTED_EOF',
            retryable: true,
          };
        }
        break;
      }

      for (const frame of frameParser.feed(value)) {
        await dispatchFrame(frame);
      }
    }
  } catch (e: unknown) {
    // 捕获由 AbortController 或网络问题等原因引起的中断
    /**
     * 如果已经收到 transport_end，则本次 reader 已由服务端明确收尾。
     *
     * 某些运行时/浏览器实现会在流已自然结束后，reader.read() 抛出非 AbortError 的异常
     * （例如底层连接被动关闭、管道状态异常等）。
     *
     * 如果我们在这种情况下仍然向上层抛出 error 事件，就会出现：
     * - UI 显示“发生错误，请稍后重试”
     * - 但实际上 final_answer 已经完整到达
     *
     * 此后的底层连接异常不再转化为新的用户可见错误。
     */
    if (transportEndEvent) {
      console.warn('[ConversationService] 流读取异常发生在 transport_end 之后（忽略为非致命噪声）:', e);
    } else if (!isAbortError(e)) {
      console.error('[ConversationService] 流读取异常:', e);
      transportFailure = {
        source: 'client',
        kind: e instanceof SseCallbackDispatchError
          ? 'projection'
          : e instanceof SseProtocolError
            ? 'protocol'
            : 'network',
        error: toError(e),
      };
    } else {
      wasInterrupted = true;
    }
  } finally {
    if (!reachedReaderEnd) {
      try {
        await reader.cancel();
      } catch (cleanupError) {
        console.warn('[ConversationService] 取消未完成的 SSE reader 失败:', cleanupError);
      }
    }
    try {
      reader.releaseLock();
    } catch (cleanupError) {
      console.warn('[ConversationService] 释放 SSE reader 锁失败:', cleanupError);
    }
  }

  if (transportFailure) {
    return publishTransportOutcome(callbacks, {
      kind: 'failed',
      failure: transportFailure,
      ...(transportEndEvent ? { event: transportEndEvent } : {}),
    });
  }
  if (transportEndEvent) {
    return publishTransportOutcome(callbacks, { kind: 'ended', event: transportEndEvent });
  }
  if (!wasInterrupted) {
    throw new Error('Conversation transport finished without an outcome');
  }
  return publishTransportOutcome(callbacks, { kind: 'interrupted' });
}

/**
 * @function fetchConversationEvents
 * @description 拉取指定会话的事件快照，主要用于 DevTools 或调试。
 * 
 * @param conversationId {string} - 要查询的会话 ID。
 * @param from {number | undefined} - 从哪个事件版本号开始拉取（增量更新）。
 * @returns 会话事件快照，包含当前 revision、查询起点与事件列表。
 */
export async function fetchConversationEvents(
  conversationId: string,
  from?: number
): Promise<{ conversation_id: string; revision: number; from: number; events: unknown[] }> {
  const baseUrl = await getApiBaseUrl();
  const qs = typeof from === 'number' && from > 0 ? `?from=${from}` : '';
  const url = `${baseUrl}/api/v1/conversation/events/${encodeURIComponent(conversationId)}${qs}`;
  const res = await apiFetch(url, { method: 'GET', headers: { 'Accept': 'application/json' } });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(text || `Failed to fetch events (${res.status})`);
  }
  return await res.json();
}

async function readResponseBodyText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return '';
  }
}
