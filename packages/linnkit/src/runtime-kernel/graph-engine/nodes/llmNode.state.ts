import type { ExecutorLocalPatch, ExecutorLocalState, StandardToolCall } from '../types';
import type {
  RoutedRuntimeEvent,
  RuntimeEvent,
  SerializableJsonRecord,
  ContextUsageSnapshot,
} from '../../../contracts';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

/**
 * LlmNode 在单次 run() 执行期内管理的最小可变状态集。
 *
 * 中文备注：
 * - answerId / chunkSeq：流式答案分段与序列号，前端按 answer_id 归并。
 * - streamRuntimeEvents / seenRuntimeIds：运行时事件缓冲与去重。
 * - pendingToolCalls / finalAnswer / pendingInteractionSpec / lastToolResult：
 *   决策输出，最终回写到 EngineLocalState 供下游节点消费。
 */
export interface LlmNodeLocalState {
  /** 当前活动的答案段 ID（流式 chunk 归并用） */
  answerId: string | undefined;
  /** 当前答案段内已发出的 chunk 序号（下一个 chunk 使用的值） */
  chunkSeq: number;
  /** 已缓冲的 RuntimeEvent（含 sink 回灌事件），最终并入历史 */
  streamRuntimeEvents: RoutedRuntimeEvent[];
  /** 已缓冲的 RuntimeEvent ID 去重集合 */
  seenRuntimeIds: Set<string>;

  // ── 决策输出（由 tick 完成后的 decision 分支设置） ──
  pendingToolCalls: StandardToolCall[] | undefined;
  finalAnswer: string | undefined;
  pendingInteractionSpec: Record<string, unknown> | undefined;
  lastToolResult: Record<string, unknown> | undefined;
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

/**
 * LlmNode reducer 接受的动作类型。
 *
 * 命名规则：
 * - STREAM_* / FINAL_ANSWER_*：handleAgentEvent 内的事件驱动动作
 * - RUNTIME_EVENT_BUFFERED：运行时事件入缓冲
 * - TOOL_CALLS_* / FINAL_ANSWER_DECISION / WAIT_USER_DECISION：tick 决策后的状态写入
 */
export type LlmNodeAction =
  | {
      type: 'STREAM_CHUNK_RECEIVED';
      answerId: string;
      seq: number;
    }
  | { type: 'FINAL_ANSWER_IGNORED' }
  | { type: 'FINAL_ANSWER_RECEIVED' }
  | { type: 'STREAM_RESET' }
  | { type: 'RUNTIME_EVENT_BUFFERED'; event: RoutedRuntimeEvent }
  | { type: 'TOOL_CALLS_ACCEPTED'; toolCalls: StandardToolCall[] }
  | { type: 'TOOL_CALLS_REJECTED_BY_FORCE_FINAL' }
  | { type: 'FINAL_ANSWER_DECISION'; answer: string }
  | {
      type: 'WAIT_USER_DECISION';
      spec: Record<string, unknown>;
      lastToolResult: Record<string, unknown>;
    };

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

/**
 * LlmNode 状态 reducer（纯函数）。
 *
 * 中文备注：
 * - 每次返回一个新的状态对象（或在无变更时返回原引用）。
 * - STREAM_CHUNK_RECEIVED 后调用方应使用 `state.chunkSeq - 1` 作为本次 chunk 的 seq。
 */
export function llmNodeReducer(
  state: LlmNodeLocalState,
  action: LlmNodeAction,
): LlmNodeLocalState {
  switch (action.type) {
    case 'STREAM_CHUNK_RECEIVED': {
      const answerChanged = state.answerId !== action.answerId;
      const expectedSeq = answerChanged ? 0 : state.chunkSeq;
      if (action.seq !== expectedSeq) {
        throw new Error(
          `final_answer_chunk sequence mismatch: answer=${action.answerId}, expected=${expectedSeq}, actual=${action.seq}`,
        );
      }
      return {
        ...state,
        answerId: action.answerId,
        chunkSeq: expectedSeq + 1,
      };
    }

    case 'FINAL_ANSWER_IGNORED':
    case 'FINAL_ANSWER_RECEIVED':
    case 'STREAM_RESET': {
      return {
        ...state,
        answerId: undefined,
        chunkSeq: 0,
      };
    }

    case 'RUNTIME_EVENT_BUFFERED': {
      if (state.seenRuntimeIds.has(action.event.id)) {
        return state;
      }
      const newSeen = new Set(state.seenRuntimeIds);
      newSeen.add(action.event.id);
      return {
        ...state,
        streamRuntimeEvents: [...state.streamRuntimeEvents, action.event],
        seenRuntimeIds: newSeen,
      };
    }

    case 'TOOL_CALLS_ACCEPTED': {
      return {
        ...state,
        pendingToolCalls: action.toolCalls,
        answerId: undefined,
        chunkSeq: 0,
      };
    }

    case 'TOOL_CALLS_REJECTED_BY_FORCE_FINAL': {
      return state;
    }

    case 'FINAL_ANSWER_DECISION': {
      return {
        ...state,
        finalAnswer: action.answer,
      };
    }

    case 'WAIT_USER_DECISION': {
      return {
        ...state,
        pendingInteractionSpec: action.spec,
        lastToolResult: action.lastToolResult,
        answerId: undefined,
        chunkSeq: 0,
      };
    }
  }
}

// ---------------------------------------------------------------------------
// Init / WriteBack
// ---------------------------------------------------------------------------

export interface LlmNodeStateInit {
  answerId: string | undefined;
  chunkSeq: number;
}

/**
 * 从 graphLocal 读取值初始化 reducer 状态。
 */
export function initLlmNodeState(init: LlmNodeStateInit): LlmNodeLocalState {
  return {
    answerId: init.answerId,
    chunkSeq: init.chunkSeq,
    streamRuntimeEvents: [],
    seenRuntimeIds: new Set(),
    pendingToolCalls: undefined,
    finalAnswer: undefined,
    pendingInteractionSpec: undefined,
    lastToolResult: undefined,
  };
}

export interface WriteBackContext {
  conversationId: string;
  turnId: string;
  /** tick 前的初始历史 */
  history: RuntimeEvent[];
  executorLocal?: ExecutorLocalState;
  executorLocalPatch?: ExecutorLocalPatch;
  contextTrace?: SerializableJsonRecord;
  contextUsage?: ContextUsageSnapshot;
}

/**
 * 把 reducer 状态回写为 EngineLocalState 补丁。
 *
 * 中文备注：
 * - 返回的对象应以 `{ ...existingLocal, ...patch }` 形式合并回 state.local，
 *   保留 request / toolContext / runtimeEventSink / signal 等非 reducer 管辖字段。
 * - 只有被决策 action 显式设置的字段才出现在补丁中（pendingToolCalls 等），
 *   避免意外覆盖其他节点写入的同名字段。
 */
export function buildLocalPatch(
  nodeState: LlmNodeLocalState,
  ctx: WriteBackContext,
): Record<string, unknown> {
  const updatedHistory = [...ctx.history, ...nodeState.streamRuntimeEvents];

  const patch: Record<string, unknown> = {
    answerId: nodeState.answerId,
    chunkSeq: nodeState.chunkSeq,
    conversationId: ctx.conversationId,
    turnId: ctx.turnId,
    history: updatedHistory,
  };

  if (nodeState.pendingToolCalls !== undefined) {
    patch.pendingToolCalls = nodeState.pendingToolCalls;
  }
  if (nodeState.finalAnswer !== undefined) {
    patch.finalAnswer = nodeState.finalAnswer;
  }
  if (nodeState.pendingInteractionSpec !== undefined) {
    patch.pendingInteractionSpec = nodeState.pendingInteractionSpec;
  }
  if (nodeState.lastToolResult !== undefined) {
    patch.lastToolResult = nodeState.lastToolResult;
  }
  if (ctx.executorLocalPatch) {
    patch.executorLocal = {
      ...(ctx.executorLocal ?? {}),
      ...ctx.executorLocalPatch,
    };
  }
  if (ctx.contextTrace !== undefined) {
    patch.contextTrace = ctx.contextTrace;
  }
  if (ctx.contextUsage !== undefined) {
    patch.contextUsage = ctx.contextUsage;
  }

  return patch;
}
