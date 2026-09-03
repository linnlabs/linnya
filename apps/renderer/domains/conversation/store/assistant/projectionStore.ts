/**
 * @file projectionStore.ts
 * @description 投影状态管理模块
 */
import { defineStore } from 'pinia';
import type { MessageProjectionState } from '../../services/messageProjection';
import { reduceEvent, createInitialProjectionState } from '../../services/messageProjection';
import {
  appendMessage as appendProjectionMessage,
  getMessageById as getProjectionMessageById,
  getMessageIndexById as getProjectionMessageIndexById,
  replaceMessageById,
  updateMessage as updateProjectionMessage,
} from '../../services/messageProjection/helpers/messageAccess';
import type { BaseMessage, Conversation } from '../../types';
import type { EventDispatchResult } from '../../definitions/eventDispatch';
import { useConversationState } from '../conversationState';
import { createProjectionCommitPipeline } from '../../services/orchestration/projectionCommitPipeline';
import { SSEEvent as SSEEventSchema, type SSEEvent, type SSEEventInput } from '@linnlabs/linnkit/contracts';
import type { ConversationUserInputCommittedEvent } from '@app/schemas';
import { mapCommittedUserInputToMessage } from '../../functions/committedUserInput';
import { useInteractiveRunStore } from '../../features/interactive-run';
import {
  findWindowLiveMessageConflict,
  formatWindowLiveMessageConflict,
} from '../../message-window/functions/windowLiveMessageAdmission';
import type { WindowLiveMessageConflict } from '../../message-window/definitions/messageWindow';
import { useMessageWindowStore } from '../../message-window/store/messageWindowStore';

const HISTORY_LOADING_SSE_BUFFER_COUNT_WARNING = 500;
const HISTORY_LOADING_SSE_BUFFER_BYTES_WARNING = 5 * 1024 * 1024;
const HISTORY_LOADING_SSE_BUFFER_AGE_WARNING_MS = 10_000;

interface HistoryLoadingSseBuffer {
  readonly requestToken: number;
  readonly events: SSEEvent[];
  readonly startedAt: number;
  estimatedBytes: number;
  countWarningEmitted: boolean;
  bytesWarningEmitted: boolean;
}

export type { MessageProjectionState };

export const useProjectionStore = defineStore('projection', () => {
  const conversationState = useConversationState();
  const interactiveRunStore = useInteractiveRunStore();
  const messageWindowStore = useMessageWindowStore();

  /**
   * Reducer 的运行时工作区，不是 UI 状态。
   *
   * UI 唯一订阅面是 commitPipeline 写入的 conversationState；这里使用普通 Map，禁止组件
   * 直接订阅，也避免 Vue 深代理递归 JSON payload 和高频 Map 更新。
   */
  const messageProjectionStates = new Map<string, MessageProjectionState>();
  /**
   * 历史加载 SSE 缓冲是运行期队列，不参与 UI 响应式渲染。
   * 用普通 Map 可以避免 Vue 对 SSEEvent 联合类型做深层解包，保持类型边界清晰。
   */
  const historyLoadingSseBuffers = new Map<string, HistoryLoadingSseBuffer>();
  const commitPipeline = createProjectionCommitPipeline({ conversationState });

  const readProjectionConflict = (
    conversationId: string,
    projectionState: MessageProjectionState
  ): WindowLiveMessageConflict | null => {
    if (messageWindowStore.conversationId !== conversationId) return null;
    return findWindowLiveMessageConflict(
      messageWindowStore.rows,
      projectionState.conversation.messages
    );
  };

  /**
   * reducer 为高频流采用就地更新。交叉 admission 失败时必须撤销尚未提交的 runtime，
   * 不能只返回失败后继续保留脏 Map；Vue 已提交状态是恢复基底，durable window 仍保持原样。
   */
  const rollbackRejectedProjectionRuntime = (
    conversationId: string,
    committedConversation: Conversation,
    committedCitationWorkspace?: MessageProjectionState['citationWorkspace'],
  ): void => {
    commitPipeline.discard(conversationId);
    const rebuilt = createInitialProjectionState(committedConversation);
    if (committedCitationWorkspace) {
      // Citation registration 使用 detached Map；保留 reduce 前引用即可恢复尚未被正文消费的 tool facts。
      rebuilt.citationWorkspace = committedCitationWorkspace;
    }
    messageProjectionStates.set(conversationId, rebuilt);
  };

  const admitProjectionStateOrThrow = (
    conversationId: string,
    projectionState: MessageProjectionState,
    committedConversation: Conversation
  ): void => {
    const conflict = readProjectionConflict(conversationId, projectionState);
    if (!conflict) return;
    rollbackRejectedProjectionRuntime(conversationId, committedConversation);
    throw new Error(formatWindowLiveMessageConflict(conflict));
  };

  const beginHistoryLoadingSseBuffer = (conversationId: string, requestToken: number): void => {
    const existing = historyLoadingSseBuffers.get(conversationId);
    if (existing) {
      discardHistoryLoadingSseBuffer(conversationId, existing.requestToken, 'superseded');
    }
    historyLoadingSseBuffers.set(conversationId, {
      requestToken,
      events: [],
      startedAt: Date.now(),
      estimatedBytes: 0,
      countWarningEmitted: false,
      bytesWarningEmitted: false,
    });
  };

  const enqueueHistoryLoadingSseEvent = (conversationId: string, event: SSEEvent): void => {
    const buffer = historyLoadingSseBuffers.get(conversationId);
    if (!buffer) return;

    buffer.events.push(event);
    buffer.estimatedBytes += new TextEncoder().encode(JSON.stringify(event)).byteLength;

    if (
      !buffer.countWarningEmitted &&
      buffer.events.length >= HISTORY_LOADING_SSE_BUFFER_COUNT_WARNING
    ) {
      buffer.countWarningEmitted = true;
      console.warn('[ProjectionStore] history loading SSE buffer count is high', {
        conversationId,
        requestToken: buffer.requestToken,
        eventCount: buffer.events.length,
      });
    }
    if (
      !buffer.bytesWarningEmitted &&
      buffer.estimatedBytes >= HISTORY_LOADING_SSE_BUFFER_BYTES_WARNING
    ) {
      buffer.bytesWarningEmitted = true;
      console.warn('[ProjectionStore] history loading SSE buffer bytes are high', {
        conversationId,
        requestToken: buffer.requestToken,
        estimatedBytes: buffer.estimatedBytes,
      });
    }
  };

  function discardHistoryLoadingSseBuffer(
    conversationId: string,
    requestToken: number,
    reason: string
  ): void {
    const buffer = historyLoadingSseBuffers.get(conversationId);
    if (!buffer || buffer.requestToken !== requestToken) return;

    const ageMs = Date.now() - buffer.startedAt;
    if (ageMs >= HISTORY_LOADING_SSE_BUFFER_AGE_WARNING_MS) {
      console.warn('[ProjectionStore] history loading SSE buffer lived too long', {
        conversationId,
        requestToken,
        eventCount: buffer.events.length,
        estimatedBytes: buffer.estimatedBytes,
        ageMs,
        reason,
      });
    }
    historyLoadingSseBuffers.delete(conversationId);
  }

  const processSseEvent = async (
    conversationId: string | undefined,
    event: SSEEvent,
    options: { bufferDuringHistoryLoading: boolean }
  ): Promise<EventDispatchResult> => {
    /**
     * event.conversation_id 是唯一所有权；上层参数只用于校验请求捕获的目标，不参与兜底。
     */
    const targetConversationId = event.conversation_id;
    if (conversationId && conversationId !== targetConversationId) {
      return {
        success: false,
        reason: `Conversation ownership mismatch: request=${conversationId}, event=${targetConversationId}`,
      };
    }
    interactiveRunStore.observeEvent(event);
    const targetConversation = conversationState.conversations.find(
      conv => conv.id === targetConversationId
    );
    if (!targetConversation) {
      return { success: false, reason: 'Conversation not found: ' + targetConversationId };
    }
    if (options.bufferDuringHistoryLoading && historyLoadingSseBuffers.has(targetConversationId)) {
      /**
       * 历史窗口加载期间，目标会话的 live 投影基底仍由 HistoryLoader 切换壳管理。
       * 不能直接 reduce，也不能丢事件；窗口 ready 后按原序回放，保证 running 会话切回时不丢 SSE。
       */
      enqueueHistoryLoadingSseEvent(targetConversationId, event);
      return { success: true, reason: 'History window is loading; event buffered' };
    }
    let projectionState = messageProjectionStates.get(targetConversationId);
    if (!projectionState) {
      projectionState = createInitialProjectionState(targetConversation);
      messageProjectionStates.set(targetConversationId, projectionState);
    }
    const committedCitationWorkspace = projectionState.citationWorkspace;
    const projectionResult = reduceEvent(projectionState, event);
    if (projectionResult.success && projectionResult.newState) {
      const conflict = readProjectionConflict(targetConversationId, projectionResult.newState);
      if (conflict) {
        rollbackRejectedProjectionRuntime(
          targetConversationId,
          targetConversation,
          committedCitationWorkspace,
        );
        return {
          success: false,
          reason: formatWindowLiveMessageConflict(conflict),
        };
      }
      messageProjectionStates.set(targetConversationId, projectionResult.newState);
      /**
       * 性能约束：高频事件必须批量提交
       *
       * 根因：
       * - commitPipeline.flush 会复制 messages 数组并替换会话对象，属于“强制刷新”，代价很高；
       * - subrun_trace / final_answer_chunk / thought 往往在极短时间内到达大量增量事件，
       *   如果每个事件都 flush，会在子 agent 收尾阶段触发明显卡顿（UI 重算 + GC）。
       *
       * 约定：
       * - 高频增量事件：用 commitPipeline.schedule（50ms 合并），保证“看起来实时”但不抖；
       * - 边界/终结事件：立即 flush，确保状态及时落到 UI（例如 tool_output、metrics、transport_end）。
       */
      const shouldScheduleCommit =
        event.type === 'subrun_trace' ||
        event.type === 'final_answer_chunk' ||
        event.type === 'thought';
      if (shouldScheduleCommit) {
        commitPipeline.schedule(targetConversationId, projectionResult.newState);
      } else {
        commitPipeline.flush(targetConversationId, projectionResult.newState);
      }
      if (event.type === 'error' && projectionResult.error) {
        // Runtime error 的用户文案由唯一投影器归一化；interactive run 只持有会话级展示状态。
        interactiveRunStore.recordCommandError(targetConversationId, projectionResult.error);
      }
    }
    return {
      success: projectionResult.success,
      messageId: projectionResult.messageId,
      reason: projectionResult.reason,
      eventSummary: {
        type: event.type,
        conversationId: targetConversationId,
        eventId: event.id,
        turnId: event.turn_id,
        // 注意：SSEEvent 是按 type 区分的联合类型，必须先收窄后才能访问分支字段。
        // - answer_id 仅存在于 final_answer / final_answer_chunk
        // - tool_call_id 仅存在于 tool_call_decision / tool_process / tool_output
        answerId:
          event.type === 'final_answer' || event.type === 'final_answer_chunk'
            ? event.answer_id
            : undefined,
        toolCallId:
          event.type === 'tool_call_decision' ||
          event.type === 'tool_process' ||
          event.type === 'tool_output'
            ? event.tool_call_id
            : undefined,
      },
    };
  };

  const handleSseEvent = async (
    conversationId: string | undefined,
    event: SSEEventInput
  ): Promise<EventDispatchResult> => {
    const admittedEvent = SSEEventSchema.parse(event);
    return processSseEvent(conversationId, admittedEvent, { bufferDuringHistoryLoading: true });
  };

  const replayBufferedHistoryLoadingEvents = async (
    conversationId: string,
    requestToken: number,
    shouldContinue: () => boolean
  ): Promise<'replayed' | 'stale'> => {
    const buffer = historyLoadingSseBuffers.get(conversationId);
    if (!buffer || buffer.requestToken !== requestToken) return 'stale';

    let cursor = 0;
    while (cursor < buffer.events.length) {
      if (!shouldContinue() || historyLoadingSseBuffers.get(conversationId) !== buffer) {
        return 'stale';
      }
      const event = buffer.events[cursor];
      if (!event) {
        throw new Error(`History loading SSE buffer invariant failed at index ${cursor}`);
      }
      cursor += 1;
      const result = await processSseEvent(conversationId, event, {
        bufferDuringHistoryLoading: false,
      });
      if (!result.success) {
        throw new Error(
          `Buffered conversation event projection failed: type=${event.type}, id=${event.id}, reason=${result.reason ?? 'unknown'}`
        );
      }
    }
    discardHistoryLoadingSseBuffer(conversationId, requestToken, 'replayed');
    return 'replayed';
  };

  const commitUserInput = (event: ConversationUserInputCommittedEvent): BaseMessage => {
    const conversationId = event.conversation_id;
    const conversation = conversationState.conversations.find(item => item.id === conversationId);
    if (!conversation) throw new Error(`Conversation not found: ${conversationId}`);
    let projectionState =
      messageProjectionStates.get(conversationId) ?? createInitialProjectionState(conversation);
    const message = mapCommittedUserInputToMessage(event);

    if (event.operation === 'replace') {
      const targetIndex = getProjectionMessageIndexById(projectionState, event.id);
      const retainedMessages =
        targetIndex === null ? [] : projectionState.conversation.messages.slice(0, targetIndex);
      projectionState = createInitialProjectionState({
        ...projectionState.conversation,
        messages: retainedMessages,
      });
      appendProjectionMessage(projectionState, message);
    } else if (!replaceMessageById(projectionState, event.id, message)) {
      appendProjectionMessage(projectionState, message);
    }

    admitProjectionStateOrThrow(conversationId, projectionState, conversation);
    messageProjectionStates.set(conversationId, projectionState);
    commitPipeline.flush(conversationId, projectionState);
    return message;
  };

  const cleanupConversationProjection = (conversationId: string): void => {
    if (!conversationId) return;
    /**
     * 这是 conversation 真正离开生命周期时的破坏性清理，不是页面导航操作。
     * reducer 与延迟 commit 必须一同释放，否则已删除 runtime 的旧快照仍会迟到写回。
     * 调用方还必须先确认该 conversation 不会再收到事件；仅删除历史事实并不等于 run 已终止。
     */
    commitPipeline.discard(conversationId);
    messageProjectionStates.delete(conversationId);
    historyLoadingSseBuffers.delete(conversationId);
  };

  const resetAllProjectionStates = (): void => {
    commitPipeline.discardAll();
    messageProjectionStates.clear();
    historyLoadingSseBuffers.clear();
  };

  const truncateProjectionStateAfterMessage = (conversationId: string, messageId: string): void => {
    const projectionState = messageProjectionStates.get(conversationId);
    if (!projectionState) return;
    const messageIndex = getProjectionMessageIndexById(projectionState, messageId);
    let truncatedMessages: BaseMessage[];
    if (messageIndex === null) {
      /**
       * 窗口化后编辑入口可能来自历史窗口，而不是 live 投影。
       * 目标不在 live ⇒ 目标在 window ⇒ live 中所有消息都晚于目标，必须全清，
       * 否则 liveOnly 会继续拼在合成视图尾部，旧回答看起来“删不掉”。
       */
      truncatedMessages = [];
    } else {
      truncatedMessages = projectionState.conversation.messages.slice(0, messageIndex + 1);
    }
    const newProjectionState: MessageProjectionState = {
      ...createInitialProjectionState({
        ...projectionState.conversation,
        messages: truncatedMessages,
      }),
    };
    const committedConversation = conversationState.conversations.find(
      item => item.id === conversationId
    );
    if (!committedConversation) return;
    admitProjectionStateOrThrow(conversationId, newProjectionState, committedConversation);
    messageProjectionStates.set(conversationId, newProjectionState);
    commitPipeline.flush(conversationId, newProjectionState);
  };

  /**
   * 追加一条消息到会话（方案B：统一 message 流）
   *
   * 说明：该方法只做“追加消息”这一件事，与 task 概念无关。
   */
  const appendMessage = (message: BaseMessage, conversationId?: string): void => {
    const targetId = conversationId || conversationState.activeConversationId;
    if (!targetId) return;
    const convIndex = conversationState.conversations.findIndex(c => c.id === targetId);
    if (convIndex === -1) return;
    let projectionState = messageProjectionStates.get(targetId);
    if (!projectionState) {
      const conversation = conversationState.conversations[convIndex];
      projectionState = createInitialProjectionState(conversation);
      messageProjectionStates.set(targetId, projectionState);
    }
    appendProjectionMessage(projectionState, message);
    const committedConversation = conversationState.conversations[convIndex];
    if (!committedConversation) return;
    admitProjectionStateOrThrow(targetId, projectionState, committedConversation);
    commitPipeline.flush(targetId, projectionState);
  };

  /**
   * 就地更新正式 timeline 消息。客户端本地卡片头不进入 projection store。
   *
   * 说明：
   * - 只更新内存投影状态与 Vue 状态，不涉及后端事件写入；
   * - 仅用于 UI 层辅助信息（例如卡片头文案从“处理中”变为“已完成”）。
   */
  const updateMessageById = (
    messageId: string,
    updater: (message: BaseMessage) => void,
    conversationId?: string
  ): boolean => {
    const targetId = conversationId || conversationState.activeConversationId;
    if (!targetId) return false;
    const projectionState = messageProjectionStates.get(targetId);
    if (!projectionState) return false;

    const didUpdate = updateProjectionMessage(projectionState, messageId, message => {
      updater(message);
      message.timestamp = Date.now();
    });
    if (!didUpdate) return false;

    const committedConversation = conversationState.conversations.find(
      item => item.id === targetId
    );
    if (!committedConversation) return false;
    admitProjectionStateOrThrow(targetId, projectionState, committedConversation);
    commitPipeline.flush(targetId, projectionState);
    return true;
  };

  const updateTaskProgressMessage = (
    messageId: string,
    newContent: string,
    isStreaming: boolean,
    conversationId?: string
  ): boolean => {
    const targetId = conversationId || conversationState.activeConversationId;
    if (!targetId) return false;
    let projectionState = messageProjectionStates.get(targetId);
    if (!projectionState) return false;
    const existingMessage = getProjectionMessageById(projectionState, messageId);
    if (!existingMessage) return false;

    updateProjectionMessage(projectionState, messageId, message => {
      message.content = isStreaming ? existingMessage.content + newContent : newContent;
      message.timestamp = Date.now();
    });
    const committedConversation = conversationState.conversations.find(
      item => item.id === targetId
    );
    if (!committedConversation) return false;
    admitProjectionStateOrThrow(targetId, projectionState, committedConversation);
    commitPipeline.flush(targetId, projectionState);
    return true;
  };

  const mergeConversationMetadata = (
    conversationId: string,
    metadata: Record<string, unknown>
  ): void => {
    if (!conversationId || !metadata) return;

    let projectionState = messageProjectionStates.get(conversationId);
    if (!projectionState) {
      const baseConversation = conversationState.conversations.find(
        conversation => conversation.id === conversationId
      );
      if (!baseConversation) {
        return;
      }
      projectionState = createInitialProjectionState(baseConversation);
    }

    const updatedState: MessageProjectionState = {
      ...projectionState,
      conversation: {
        ...projectionState.conversation,
        metadata: {
          ...(projectionState.conversation.metadata ?? {}),
          ...metadata,
        },
      },
    };

    messageProjectionStates.set(conversationId, updatedState);
    /**
     * metadata 变更必须接管尚未执行的高频事件提交。
     * 否则旧的 50ms 投影快照会在稍后覆盖刚写入的 workflow/workspace metadata。
     */
    commitPipeline.flush(conversationId, updatedState);
  };

  return {
    messageProjectionStates,
    handleSseEvent,
    commitUserInput,
    cleanupConversationProjection,
    beginHistoryLoadingSseBuffer,
    discardHistoryLoadingSseBuffer,
    resetAllProjectionStates,
    truncateProjectionStateAfterMessage,
    appendMessage,
    updateMessageById,
    updateTaskProgressMessage,
    replayBufferedHistoryLoadingEvents,
    mergeConversationMetadata,
  };
});
