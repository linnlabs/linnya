<!-- apps/renderer/features/AiAssistant/ui/ConversationView.vue -->
<template>
  <div
    class="conversation-view-wrapper"
    ref="conversationWrapperRef"
    :class="{
      'timeline-expanded': !isTimelineCollapsed,
      'is-history-loading': isHistoryReplayPending,
    }"
    :data-overlay-scroll-theme="useOverlayScrollViewport ? 'linnya' : undefined"
    :data-overlay-scroll-visibility="useOverlayScrollViewport ? 'strict-hover' : undefined"
  >
    <div class="conversation-view" ref="conversationRef">
      <div class="conversation-content">
        <!-- 空状态 -->
        <div v-if="isHistoryReplayLoadingState" class="history-loading-state" role="status" aria-live="polite">
          <div class="history-loading-copy">
            <h3 class="history-loading-title">
              {{ conversationMessage('conversation.view.historyLoading') }}<span class="history-loading-dots" aria-hidden="true">
                <span>.</span><span>.</span><span>.</span><span>.</span><span>.</span><span>.</span>
              </span>
            </h3>
          </div>
        </div>

        <!-- 空状态 -->
        <ConversationEmptyState v-else-if="shouldShowEmptyState" />

        <!-- 消息列表 -->
        <div v-else ref="messagesContainerRef" class="messages-container">
          <VirtualConversationCanvas
            :items="visualRows"
            :messages="messages"
            :virtual-rows="virtualRows"
            :total-height="virtualTotalHeight"
            :scroll-margin="virtualScrollMargin"
            :timeline-positions="virtualTimelinePositions"
            :measure-element="measureVirtualElement"
            :active-run-ids="assistantStore.activeConversationRunIds"
            :answer-render-width-px="committedContentWidthPx"
            :trailing-status="trailingStatus"
            @layout-change="handleVirtualTurnLayoutChange"
            @edit-message="handleEditMessage"
            @regenerate-response="handleRegenerateResponse"
          />
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, provide, onMounted, onBeforeUnmount, watch, nextTick } from 'vue';
import {
  useOverlayScrollViewport as useSharedOverlayScrollViewport,
} from '@linnya/renderer-ui/scroll';
import { useAssistantStore } from '../store/assistantStore';
import { useConversationContentPhaseSelector } from '../store/conversationContentPhaseSelector';
import { useChatFlowOrchestrator } from '../services/orchestration/chatFlowOrchestrator';
import ConversationEmptyState from './components/ConversationEmptyState.vue';
import type { BaseMessage } from '../types';
import type {
  EditUserMessageCommand,
  RegenerateUserMessageCommand,
} from '../definitions/userMessageContent';
import type { MessageWindowLoadMode, MessageWindowStatus } from '../message-window';
import { useConversationScrollController } from './conversationView/composables/useConversationScrollController';
import { useConversationTimelinePositions } from './conversationView/composables/useConversationTimelinePositions';
import { useStreamingWaitingIndicator } from './conversationView/composables/useStreamingWaitingIndicator';
import { useAppendOnlyConversationVisualRows } from './conversationView/composables/useAppendOnlyConversationVisualRows';
import { useMessageEntryAnimation } from './conversationView/composables/useMessageEntryAnimation';
import { useTimelineLayoutReserveAnimation } from './conversationView/composables/useTimelineLayoutReserveAnimation';
import { useSettledConversationContentWidth } from './conversationView/composables/useSettledConversationContentWidth';
import VirtualConversationCanvas from './conversationView/components/VirtualConversationCanvas.vue';
import { cloneEstimationRegistry } from './conversationView/utils/estimationRegistry';
import { useTanstackConversationVirtualizer } from './conversationView/composables/useTanstackConversationVirtualizer';
import { useConversationVirtualizerGeometry } from './conversationView/composables/useConversationVirtualizerGeometry';
import { useConversationFooterMaskLayout } from './conversationView/composables/useConversationFooterMaskLayout';
import type { PositionInfo } from './components/timeline/composables/useTimelinePositions';
import { hasRenderableConversationMessages } from '../functions/renderableConversationMessage';
import { isConversationHistoryPendingPhase } from '../functions/conversationContentPhase';
import { useConversationLocalization } from './useConversationLocalization';
import { shouldTriggerLoadAfter, shouldTriggerLoadBefore } from './conversationView/functions/historyBackfillPolicy';
import { MESSAGE_ENTRY_ANIMATION_PORT_KEY } from '../definitions/messageEntryAnimation';
import { CONVERSATION_RENDER_SCOPE_KEY } from '../definitions/conversationRenderScope';
import { CONVERSATION_RENDER_SCHEDULING_PORT_KEY } from '../definitions/conversationRenderScheduling';
import type { ConversationVisualTurnId } from '@app/schemas';

/**
 * 功能 (What): 对话视图组件，展示AI助手的对话消息列表，支持流式传输状态管理
 * 输入 (Input): messages - 消息数组，isLoading - 加载状态，isStreaming - 流式传输状态
 * 输出 (Output): 渲染包含消息列表的对话界面
 * 副作用 (Side-effects): 自动滚动到底部，提供消息列表给子组件, 处理消息的编辑和重新生成
 */

// Props
interface Props {
  conversationId: string;
  messages?: BaseMessage[];
  isLoading?: boolean;
  isTimelineCollapsed?: boolean;
  isHistoryReplayLoading?: boolean;
  useOverlayScrollViewport?: boolean;
  hasMoreBefore?: boolean;
  hasMoreAfter?: boolean;
  messageWindowStatus?: MessageWindowStatus;
  messageWindowLoadingMode?: MessageWindowLoadMode | null;
  isTimelineNavigating?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  messages: () => [],
  isLoading: false,
  isTimelineCollapsed: true,
  isHistoryReplayLoading: false,
  useOverlayScrollViewport: false,
  hasMoreBefore: false,
  hasMoreAfter: false,
  messageWindowStatus: 'idle',
  messageWindowLoadingMode: null,
  isTimelineNavigating: false,
});

const emit = defineEmits<{
  'timeline-positions-change': [positions: PositionInfo[]];
  'scroll-to-bottom-visibility-change': [show: boolean];
  'load-before-requested': [];
  'load-after-requested': [];
}>();

// Store
const assistantStore = useAssistantStore();
const conversationIsStreaming = computed(() => assistantStore.activeConversationIsStreaming);
const { conversationMessage } = useConversationLocalization();

// Host 以 conversationId 作为本组件 key；这里发布本次挂载的不可变消息窗口身份。
provide(CONVERSATION_RENDER_SCOPE_KEY, Object.freeze({ conversationId: props.conversationId }));

// 提供消息列表给子组件（用于ThoughtMessage判断思考是否完成）
provide('conversationMessages', () => props.messages);

// Refs：在默认情况下，使用内部 .conversation-view 作为滚动容器；
// 在 PROJECT_SETUP 视图中，会在 onMounted 中自动提升为外层 .editor-shell.for-project-setup。
const conversationWrapperRef = ref<HTMLElement | null>(null);
const conversationRef = ref<HTMLElement>();
const messagesContainerRef = ref<HTMLElement | null>(null);
const virtualScrollElementRef = ref<HTMLElement | null>(null);
const conversationOverlayViewportMountRef = ref<HTMLElement | null>(null);
const conversationOverlayViewportRef = ref<HTMLElement | null>(null);
useTimelineLayoutReserveAnimation({
  conversationRef,
  isTimelineCollapsed: () => props.isTimelineCollapsed,
});

const {
  init: initOverlayScroll,
  scheduleUpdate: scheduleOverlayScrollUpdate,
  destroy: destroyOverlayScroll,
} = useSharedOverlayScrollViewport({
  bindings: {
    hostRef: conversationWrapperRef,
    viewportMountRef: conversationOverlayViewportMountRef,
    viewportRef: conversationOverlayViewportRef,
  },
});
// 时间轴位置上报（解耦：只提供测量函数，触发时机交给滚动/DOM 监听）
const { updateTurnPositionsToTimeline } = useConversationTimelinePositions(
  (positions) => {
    emit('timeline-positions-change', positions);
  }
);

// 计算属性
const messages = computed(() => {
  // 直接使用 props 传入的消息（不要在这里做副作用/过滤，保持单一职责）
  return props.messages;
});

const { port: messageEntryAnimationPort } = useMessageEntryAnimation({
  conversationId: computed(() => props.conversationId),
  messages,
});

provide(MESSAGE_ENTRY_ANIMATION_PORT_KEY, messageEntryAnimationPort);

const estimationRegistry = cloneEstimationRegistry();
const resetKey = computed(() => props.conversationId);
const {
  committedWidthPx: committedContentWidthPx,
  isChanging: isContentWidthChanging,
} = useSettledConversationContentWidth({
  contentColumnRef: messagesContainerRef,
  resetKey,
});
provide(CONVERSATION_RENDER_SCHEDULING_PORT_KEY, Object.freeze({
  isContentWidthChanging: () => isContentWidthChanging.value,
}));

const syncOverlayScrollViewport = (): void => {
  conversationOverlayViewportMountRef.value = conversationRef.value ?? null;

  if (!props.useOverlayScrollViewport) {
    destroyOverlayScroll();
    return;
  }

  initOverlayScroll();
};

const scheduleOverlayScrollUpdateIfNeeded = (): void => {
  if (!props.useOverlayScrollViewport) return;
  scheduleOverlayScrollUpdate();
};

const { visualRows } = useAppendOnlyConversationVisualRows({
  messages,
  resetKey,
  widthPx: committedContentWidthPx,
  estimationRegistry,
});

const hasRenderableSourceMessages = computed(() => {
  return hasRenderableConversationMessages(messages.value);
});

const contentPhase = useConversationContentPhaseSelector({
  isHistoryReplayLoading: computed(() => props.isHistoryReplayLoading),
  hasRenderableSourceMessages,
  hasRenderableItems: computed(() => visualRows.value.length > 0),
});

const isHistoryReplayPending = computed(() => isConversationHistoryPendingPhase(contentPhase.value));
const isHistoryReplayLoadingState = computed(() => contentPhase.value === 'history-loading');

const shouldShowEmptyState = computed(() => {
  return contentPhase.value === 'draft' || contentPhase.value === 'ready-empty';
});

const {
  scrollMargin: virtualScrollMargin,
  scrollEndThreshold,
  updateGeometry,
} = useConversationVirtualizerGeometry({
  conversationRef,
  listStartRef: messagesContainerRef,
  scrollElementRef: virtualScrollElementRef,
  resetKey,
});

// 控制器只发布产品滚动意图；滚动、prepend 锚定和尺寸修正统一由 TanStack 执行。
const {
  mode: scrollMode,
  showScrollToBottomBtn,
  scrollToBottomManual,
  scrollToVisualTurn,
} = useConversationScrollController({
  conversationRef,
  scrollContainerRef: virtualScrollElementRef,
  messages,
  initialRenderableContentKey: computed(() => {
    if (contentPhase.value !== 'ready') return null;
    const conversationId = props.conversationId;
    const lastItem = visualRows.value[visualRows.value.length - 1];
    return conversationId && lastItem ? `${conversationId}:${lastItem.key}` : null;
  }),
  scrollEndThreshold,
  resetKey,
  virtualizer: {
    scrollToEnd: () => virtualizer.scrollToEnd(),
    scrollToVisualTurn: (visualTurnId, signal) => (
      virtualizer.scrollToVisualTurn(visualTurnId, signal)
    ),
  },
  onDomMutated: () => {
    scheduleOverlayScrollUpdateIfNeeded();
    updateFooterMaskLayout();
    updateGeometry();
  },
});

const chatFlowOrchestrator = useChatFlowOrchestrator({
  onUserMessageCommitted: scrollToBottomManual,
});

const virtualizer = useTanstackConversationVirtualizer({
  items: visualRows,
  enabled: computed(() => true),
  isStreaming: conversationIsStreaming,
  scrollMode,
  scrollElement: virtualScrollElementRef,
  scrollMargin: computed(() => virtualScrollMargin.value),
  scrollEndThreshold: computed(() => scrollEndThreshold.value),
  estimationWidthPx: committedContentWidthPx,
});

const {
  virtualRows,
  totalHeight: virtualTotalHeight,
  scrollOffset: virtualScrollOffset,
  viewportHeight: virtualViewportHeight,
  timelinePositions: virtualTimelinePositions,
  measureElement: measureVirtualElement,
} = virtualizer;

onMounted(() => {
  syncOverlayScrollViewport();
});

onBeforeUnmount(() => {
  destroyOverlayScroll();
});

const handleVirtualTurnLayoutChange = (
  positions: Array<{
    visualTurnId: ConversationVisualTurnId;
    top: number;
    height: number;
    measured: boolean;
  }>
) => {
  updateTurnPositionsToTimeline(positions);
};

const footerMaskLayoutWatchKey = computed(() => {
  const list = messages.value;
  const last = list.length > 0 ? list[list.length - 1] : undefined;
  return [
    props.conversationId,
    String(visualRows.value.length),
    String(list.length),
    last?.id ?? '',
    conversationIsStreaming.value ? 'streaming' : 'settled',
  ].join(':');
});

const { updateLayout: updateFooterMaskLayout } = useConversationFooterMaskLayout({
  conversationRef,
  resetKey: computed(() => props.conversationId),
  watchKey: footerMaskLayoutWatchKey,
});

watch(
  () => [props.useOverlayScrollViewport, props.conversationId, visualRows.value.length] as const,
  () => {
    syncOverlayScrollViewport();
    scheduleOverlayScrollUpdateIfNeeded();
  },
  { flush: 'post' },
);

watch(
  showScrollToBottomBtn,
  (show) => {
    emit('scroll-to-bottom-visibility-change', show);
  },
  { immediate: true },
);

watch(
  () => [
    virtualScrollOffset.value,
    virtualViewportHeight.value,
    virtualTotalHeight.value,
    scrollMode.value,
    props.hasMoreBefore,
    props.hasMoreAfter,
    props.messageWindowStatus,
    props.messageWindowLoadingMode,
    props.isTimelineNavigating,
  ] as const,
  ([
    nextScrollTop,
    nextViewportHeight,
    nextScrollHeight,
    nextScrollMode,
    nextHasMoreBefore,
    nextHasMoreAfter,
    nextWindowStatus,
    nextLoadingMode,
    nextIsNavigating,
  ]) => {
    const baseInput = {
      scrollTop: nextScrollTop,
      viewportHeight: nextViewportHeight,
      scrollHeight: nextScrollHeight,
      scrollMode: nextScrollMode,
      windowStatus: nextWindowStatus,
      loadingMode: nextLoadingMode,
      isNavigating: nextIsNavigating,
    };

    if (shouldTriggerLoadBefore({
      ...baseInput,
      hasMoreBefore: nextHasMoreBefore,
    })) {
      emit('load-before-requested');
    }

    if (shouldTriggerLoadAfter({
      ...baseInput,
      hasMoreAfter: nextHasMoreAfter,
    })) {
      emit('load-after-requested');
    }
  },
  { flush: 'post' },
);

/** 返回详情时先用正式 message identity 找到所属 visual turn，再等待目标行挂载。 */
const scrollToMessage = async (messageId: string): Promise<boolean> => {
  const row = visualRows.value.find(candidate => candidate.payload.id === messageId);
  if (!row) return false;
  const didScroll = await scrollToVisualTurn(row.visualTurnId);
  if (!didScroll) return false;
  await nextTick();
  return true;
};

defineExpose({
  scrollToBottomManual,
  scrollToMessage,
  scrollToVisualTurn,
});

// 通用等待指示器（副作用拆分，且移除 any 解析）
const { isWaitingSlotActive, isWaitingIndicatorVisible } = useStreamingWaitingIndicator({
  messages,
  isStreaming: conversationIsStreaming,
});
const trailingStatus = computed(() => ({
  active: isWaitingSlotActive.value,
  visible: isWaitingIndicatorVisible.value,
}));

/**
 * @description
 * 功能 (What): 处理用户消息原地编辑后的保存操作。
 *              它会更新指定消息的内容，然后截断该消息之后的所有对话，
 *              并触发AI重新生成回答。
 *
 * 输入 (Input): command - 只包含消息 ID 与替换文本的编辑命令。
 *
 * 副作用 (Side-effects): 调用 chat orchestration，由它统一同步投影并发起新请求。
 */
const handleEditMessage = (command: EditUserMessageCommand) => {
  chatFlowOrchestrator.editAndResendMessage(command);
};

/**
 * @description
 * 功能 (What): 处理重新生成AI回答的请求。它会移除当前轮次中除了用户第一条消息外的所有消息，
 *              然后以该用户消息为提示，重新调用AI服务生成新的回答。
 * 
 * 输入 (Input): command - 只包含目标用户消息 ID 的重新生成命令。
 * 
 * 输出 (Output): 无
 * 
 * 副作用 (Side-effects): 调用 chat orchestration 发起重新生成。
 */
const handleRegenerateResponse = (command: RegenerateUserMessageCommand) => {
  chatFlowOrchestrator.regenerateResponseForMessage(command);
};

</script>
