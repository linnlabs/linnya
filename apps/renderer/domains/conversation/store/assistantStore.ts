/**
 * @file apps/renderer/domains/conversation/store/assistantStore.ts
 * @description AI 助手的 Pinia 状态管理聚合根
 * @brief
 *  此 Store 作为聚合入口，负责组合所有拆分出去的子模块 (projection, scope, task)。
 *  它自身不包含核心业务逻辑，仅作为依赖注入容器和对外的统一接口。
 */

import { defineStore, storeToRefs } from 'pinia';
import { ref, computed, watch } from 'vue';
import { useWorkspaceScopeStore } from '../../../shared/stores/workspaceScopeStore';
import { useExecutionState } from './executionState';
import { useConversationState } from './conversationState';
import { useConversationSelectors } from './selectors';
import {
  cancelInteractiveRun,
  isInteractiveRunBusy,
  useInteractiveRunStore,
} from '../features/interactive-run';

import type { BaseMessage, InteractiveToolSubmissionMetadata } from '../types';
import type { ConversationUserInputCommittedEvent } from '@app/schemas';

import { useToolingFlowOrchestrator } from '../services/orchestration/toolingFlowOrchestrator';

// 阶段性拆分导入
import { useProjectionStore } from './assistant';
import type { AnnotationRunParams } from '../definitions/annotationRun';
import type { SSEEventInput } from '@linnlabs/linnkit/contracts';
import { useAnnotationRunExecutionStore } from '../features/annotation-run/store/annotationRunExecutionStore';
import { useAnnotationRunOrchestrator } from '../services/orchestration/annotationRunOrchestrator';
import { cancelContributedAssistantRuns } from '../ports/contributedAssistantRunCancellationPort';

export const useAssistantStore = defineStore('aiAssistant', () => {
  // ===============================
  // 组合状态模块
  // ===============================
  const executionState = useExecutionState();
  const conversationState = useConversationState();
  const interactiveRunStore = useInteractiveRunStore();
  const annotationRunExecutionStore = useAnnotationRunExecutionStore();

  // ===============================
  // 组合选择器模块
  // ===============================
  const conversationSelectors = useConversationSelectors(conversationState);

  // ===============================
  // 状态聚合
  // ===============================
  // ExecutionState 是 Pinia Store，内部 state 使用 ref，但对外已由 Pinia 自动解包
  const globalIsLoading = computed(() => {
    const conversationId = conversationState.activeConversationId;
    const run = interactiveRunStore.snapshotFor(conversationId);
    return (
      run?.status === 'starting' ||
      run?.status === 'submitting' ||
      executionState.isLoading ||
      annotationRunExecutionStore.isLoadingFor(conversationId)
    );
  });
  const activeConversationInteractiveRun = computed(() =>
    interactiveRunStore.snapshotFor(conversationState.activeConversationId)
  );
  const activeConversationIsStreaming = computed(
    () =>
      isInteractiveRunBusy(activeConversationInteractiveRun.value) ||
      annotationRunExecutionStore.isStreamingFor(conversationState.activeConversationId)
  );
  const activeConversationRunIds = computed(() => {
    const runIds: string[] = [];
    const interactiveRun = activeConversationInteractiveRun.value;
    if (isInteractiveRunBusy(interactiveRun) && interactiveRun?.runId) {
      runIds.push(interactiveRun.runId);
    }
    if (
      annotationRunExecutionStore.isStreamingFor(conversationState.activeConversationId) &&
      annotationRunExecutionStore.runId
    ) {
      runIds.push(annotationRunExecutionStore.runId);
    }
    return runIds;
  });
  const globalIsStreaming = computed(
    () => activeConversationIsStreaming.value || executionState.isStreaming
  );
  /**
   * 🔥 关键修复：跨 Store 暴露状态时必须通过 computed 建立响应式“管道”，避免返回快照值。
   *
   * 根因：
   * - executionState / annotationRunExecutionStore 是独立 Pinia store；
   * - 直接返回它们的 error 等字段，在聚合 store 中会退化为“创建时的快照”，
   *   导致 UI（例如 ErrorBanner）无法随 setError() 更新。
   *
   * 结论：
   * - 一律用 computed(() => executionState.xxx) 包一层再导出。
   */
  const globalError = computed(
    () =>
      interactiveRunStore.snapshotFor(conversationState.activeConversationId)?.error ??
      executionState.error ??
      annotationRunExecutionStore.errorFor(conversationState.activeConversationId)
  );

  /**
   * 关闭当前横幅时清理全部可能贡献该横幅的 owner。
   *
   * interactive run 的错误按会话持有，不能再只清旧 executionState；否则聚合选择器
   * 会立即读回同一个错误，让 Close 按钮看起来失效。其它会话的错误必须继续保留。
   */
  const clearActiveError = (): void => {
    const conversationId = conversationState.activeConversationId;
    if (conversationId) {
      interactiveRunStore.clearError(conversationId);
      annotationRunExecutionStore.clearErrorFor(conversationId);
    }
    executionState.clearError();
  };

  // ===============================
  // 统一的取消操作
  // ===============================
  const cancelCurrentStream = () => {
    const conversationId = conversationState.activeConversationId;
    if (conversationId) {
      void cancelInteractiveRun(conversationId).catch((error: unknown) => {
        console.error('[AssistantStore] foreground run cancellation workflow failed', error);
      });
    }
    executionState.cancelCurrentStream();
    useAnnotationRunOrchestrator().cancelAnnotationRun(conversationId ?? undefined);
    cancelContributedAssistantRuns();
  };

  const startConversationExecution = (controller: AbortController): void => {
    const conversationId = conversationState.activeConversationId;
    if (!conversationId) {
      throw new Error('Cannot start conversation run without an active conversation');
    }
    interactiveRunStore.beginStart(conversationId, controller);
  };

  // ===============================
  // 核心依赖
  // ===============================
  const workspaceScopeStore = useWorkspaceScopeStore();
  const selectedConversationId = ref<string | null>(null);
  const isTimelineCollapsed = ref(true);

  const setSelectedConversation = (conversationId: string | null): void => {
    selectedConversationId.value = conversationId;
  };

  const toggleTimelineCollapsed = (): void => {
    isTimelineCollapsed.value = !isTimelineCollapsed.value;
  };

  const resetTimelineCollapsed = (): void => {
    isTimelineCollapsed.value = true;
  };

  // 当前可见会话只影响 UI 偏好；projection runtime 按 conversation 生命周期持有。
  watch(
    () => conversationState.activeConversationId,
    newActiveConvId => {
      resetTimelineCollapsed();

      if (newActiveConvId) {
        workspaceScopeStore.rememberLastActiveConversation(
          workspaceScopeStore.currentScope,
          newActiveConvId
        );
      }
    }
  );

  // ===============================
  // 工具与任务流程 (转发)
  // ===============================
  const concludeAskQuestionsInteraction = async (options: {
    observation: string;
    isSkipped: boolean;
    toolCallId: string;
    toolName: string;
    answersPayload?: Record<string, unknown>;
  }) => {
    if (!options.toolCallId) {
      throw new Error(
        '[AssistantStore] concludeAskQuestionsInteraction 需要明确的 toolCallId 参数'
      );
    }

    const toolingOrchestrator = useToolingFlowOrchestrator();
    return toolingOrchestrator.concludeAskQuestionsInteraction({
      ...options,
      toolCallId: options.toolCallId,
    });
  };

  const concludeInteractiveToolInteraction = async (options: {
    observation: string;
    toolCallId: string;
    toolName: string;
    data: Record<string, unknown>;
    interactionResponse: InteractiveToolSubmissionMetadata;
  }) => {
    if (!options.toolCallId) {
      throw new Error(
        '[AssistantStore] concludeInteractiveToolInteraction 需要明确的 toolCallId 参数'
      );
    }

    const toolingOrchestrator = useToolingFlowOrchestrator();
    return toolingOrchestrator.concludeInteractiveToolInteraction({
      ...options,
      toolCallId: options.toolCallId,
    });
  };

  const executeAnnotationRun = (params: AnnotationRunParams) => {
    return useAnnotationRunOrchestrator().executeAnnotationRun(params);
  };

  // ===============================
  // 实例化子模块
  // ===============================
  const projectionStore = useProjectionStore();

  // ===============================
  // 从 sub-stores 提取响应式引用
  // ===============================
  const { inputText: conversationInputText } = storeToRefs(conversationState);

  const mergeConversationMetadata = (
    conversationId: string,
    metadata: Record<string, unknown>
  ): void => {
    conversationState.mergeConversationMetadata(conversationId, metadata);
    projectionStore.mergeConversationMetadata(conversationId, metadata);
  };

  // ===============================
  // 事件系统与投影 (转发到 ProjectionStore)
  // ===============================
  const handleSseEvent = (conversationId: string | undefined, event: SSEEventInput) => {
    return projectionStore.handleSseEvent(conversationId, event);
  };

  const commitUserInput = (event: ConversationUserInputCommittedEvent): BaseMessage =>
    projectionStore.commitUserInput(event);

  const cleanupConversationProjection = (conversationId: string): void => {
    projectionStore.cleanupConversationProjection(conversationId);
  };

  const beginHistoryLoadingSseBuffer = (conversationId: string, requestToken: number): void => {
    projectionStore.beginHistoryLoadingSseBuffer(conversationId, requestToken);
  };

  const discardHistoryLoadingSseBuffer = (
    conversationId: string,
    requestToken: number,
    reason: string
  ): void => {
    projectionStore.discardHistoryLoadingSseBuffer(conversationId, requestToken, reason);
  };

  const replayBufferedHistoryLoadingEvents = (
    conversationId: string,
    requestToken: number,
    shouldContinue: () => boolean
  ): Promise<'replayed' | 'stale'> => {
    return projectionStore.replayBufferedHistoryLoadingEvents(
      conversationId,
      requestToken,
      shouldContinue
    );
  };

  const resetAllProjectionStates = (): void => {
    projectionStore.resetAllProjectionStates();
  };

  const truncateProjectionStateAfterMessage = (conversationId: string, messageId: string): void => {
    projectionStore.truncateProjectionStateAfterMessage(conversationId, messageId);
  };

  const appendMessage = (message: BaseMessage, conversationId?: string): void => {
    projectionStore.appendMessage(message, conversationId);
  };

  const updateMessageById = (
    messageId: string,
    updater: (message: BaseMessage) => void,
    conversationId?: string
  ): boolean => {
    return projectionStore.updateMessageById(messageId, updater, conversationId);
  };

  const updateTaskProgressMessage = (
    messageId: string,
    newContent: string,
    isStreaming: boolean,
    conversationId?: string
  ): boolean => {
    return projectionStore.updateTaskProgressMessage(
      messageId,
      newContent,
      isStreaming,
      conversationId
    );
  };

  // ===============================
  // 导出 API
  // ===============================
  return {
    // 会话状态
    activeConversationId: computed(() => conversationState.activeConversationId),
    inputText: conversationInputText,

    // 聚合执行状态
    isLoading: globalIsLoading,
    isStreaming: globalIsStreaming,
    activeConversationIsStreaming,
    activeConversationRunIds,
    error: globalError,
    // 用户引用 / 通用引用

    // 选择器
    activeConversation: conversationSelectors.activeConversation,
    hasActiveConversation: conversationSelectors.hasActiveConversation,
    activeMessages: conversationSelectors.activeMessages,
    activeRenderableMessages: conversationSelectors.activeRenderableMessages,
    hasRenderableMessages: conversationSelectors.hasRenderableMessages,
    latestTodoToolMessageId: conversationSelectors.latestTodoToolMessageId,

    // 会话管理
    createNewConversation: conversationState.createNewConversation,
    setActiveConversation: conversationState.setActiveConversation,
    setInputText: conversationState.setInputText,
    setConversationSelectedAgent: conversationState.setConversationSelectedAgent,
    /** 合并展示/上下文 metadata；控制面字段必须使用显式 store action。 */
    mergeConversationMetadata,

    clearActiveConversation: () => {
      conversationState.setActiveConversation(null);
    },

    // 执行状态管理
    setLoading: executionState.setLoading,
    setStreaming: executionState.setStreaming,
    setError: executionState.setError,
    clearError: clearActiveError,
    cancelCurrentStream: cancelCurrentStream,
    setAbortController: executionState.setAbortController,
    clearAbortController: executionState.clearAbortController,
    clearAbortControllerIfCurrent: executionState.clearAbortControllerIfCurrent,
    startInteractiveRun: startConversationExecution,
    // application contributed use cases 尚未进入正文 interactive-run 协议，继续使用独立兼容执行态。
    startExecution: executionState.startExecution,

    // 工具交互
    concludeAskQuestionsInteraction,
    concludeInteractiveToolInteraction,

    // 编辑器任务
    executeAnnotationRun,

    // 统一事件投影
    handleSseEvent,
    commitUserInput,
    cleanupConversationProjection,
    beginHistoryLoadingSseBuffer,
    discardHistoryLoadingSseBuffer,
    replayBufferedHistoryLoadingEvents,
    resetAllProjectionStates,
    truncateProjectionStateAfterMessage,

    // 作用域
    selectedConversationId: computed(() => selectedConversationId.value),
    setSelectedConversation,
    isTimelineCollapsed: computed(() => isTimelineCollapsed.value),
    toggleTimelineCollapsed,
    resetTimelineCollapsed,

    // 统一消息追加
    appendMessage,
    updateMessageById,
    updateTaskProgressMessage,
  };
});
