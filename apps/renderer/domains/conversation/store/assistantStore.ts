/**
 * @file apps/renderer/domains/conversation/store/assistantStore.ts
 * @description AI 助手的 Pinia 状态管理聚合根
 * @brief
 *  此 Store 作为聚合入口，负责组合所有拆分出去的子模块 (projection, scope, task)。
 *  它自身不包含核心业务逻辑，仅只组合状态、同步 action 与选择器；异步用例从 assistantActions 公开入口调用。
 */

import { defineStore, storeToRefs } from 'pinia';
import { ref, computed, watch } from 'vue';
import { useNavigationScope } from '@/app/navigation';
import { resolveRunExecutionActivity } from '../shared/execution-presentation/functions/resolveExecutionActivity';
import { useExecutionState } from './executionState';
import { useConversationState } from './conversationState';
import { useConversationSelectors } from './selectors';
import { isInteractiveRunBusy, useInteractiveRunStore } from '../features/interactive-run';

// 阶段性拆分导入
import { useAnnotationRunExecutionStore } from '../features/annotation-run/store/annotationRunExecutionStore';
import {
  selectConversationSurfaceError,
  type ConversationSurfaceErrorSource,
} from '../features/error-surface';

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
  const activeConversationIsBusy = computed(
    () =>
      isInteractiveRunBusy(activeConversationInteractiveRun.value) ||
      annotationRunExecutionStore.isStreamingFor(conversationState.activeConversationId)
  );
  const activeConversationIsStreaming = computed(
    () =>
      resolveRunExecutionActivity(activeConversationInteractiveRun.value).isExecuting ||
      annotationRunExecutionStore.isStreamingFor(conversationState.activeConversationId)
  );
  const activeConversationRunIds = computed(() => {
    const runIds: string[] = [];
    const interactiveRun = activeConversationInteractiveRun.value;
    if (resolveRunExecutionActivity(interactiveRun).isExecuting && interactiveRun?.runId) {
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
  const globalIsBusy = computed(() => activeConversationIsBusy.value || executionState.isStreaming);
  const globalIsStreaming = computed(
    () => activeConversationIsStreaming.value || executionState.isStreaming
  );
  /**
   * 🔥 关键修复：跨 Store 暴露状态时必须通过 computed 建立响应式“管道”，避免返回快照值。
   *
   * 根因：
   * - executionState / annotationRunExecutionStore 是独立 Pinia store；
   * - 直接返回它们的 error 等字段，在聚合 store 中会退化为“创建时的快照”，
   *   导致 错误状态消费者无法随 setError() 更新。
   *
   * 结论：
   * - 一律用 computed(() => executionState.xxx) 包一层再导出。
   */
  const activeSurfaceError = computed(() =>
    selectConversationSurfaceError({
      interactiveRun: interactiveRunStore.snapshotFor(conversationState.activeConversationId)
        ?.error,
      legacyExecution: executionState.error,
      annotationRun: annotationRunExecutionStore.errorFor(conversationState.activeConversationId),
    })
  );
  const globalError = computed(() => activeSurfaceError.value?.message ?? null);

  /** 只关闭当前横幅真正的 owner；其它执行域的错误继续留在自己的生命周期中。 */
  const clearActiveError = (): void => {
    const source: ConversationSurfaceErrorSource | undefined = activeSurfaceError.value?.source;
    const conversationId = conversationState.activeConversationId;
    if (source === 'interactive-run' && conversationId) {
      interactiveRunStore.clearError(conversationId);
    } else if (source === 'legacy-execution') {
      executionState.clearError();
    } else if (source === 'annotation-run' && conversationId) {
      annotationRunExecutionStore.clearErrorFor(conversationId);
    }
  };

  // ===============================
  // 统一的取消操作
  // ===============================
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
  const navigationScope = useNavigationScope();
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
        navigationScope.rememberLastActiveConversation(
          navigationScope.currentScope,
          newActiveConvId
        );
      }
    }
  );

  const { inputText: conversationInputText } = storeToRefs(conversationState);

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
    isBusy: globalIsBusy,
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

    clearActiveConversation: () => {
      conversationState.setActiveConversation(null);
    },

    // 执行状态管理
    setLoading: executionState.setLoading,
    setStreaming: executionState.setStreaming,
    setError: executionState.setError,
    clearError: clearActiveError,
    setAbortController: executionState.setAbortController,
    clearAbortController: executionState.clearAbortController,
    clearAbortControllerIfCurrent: executionState.clearAbortControllerIfCurrent,
    startInteractiveRun: startConversationExecution,
    // application contributed use cases 尚未进入正文 interactive-run 协议，继续使用独立兼容执行态。
    startExecution: executionState.startExecution,

    // 工具交互

    // 编辑器任务

    // 统一事件投影

    // 作用域
    selectedConversationId: computed(() => selectedConversationId.value),
    setSelectedConversation,
    isTimelineCollapsed: computed(() => isTimelineCollapsed.value),
    toggleTimelineCollapsed,
    resetTimelineCollapsed,

    // 统一消息追加
  };
});
