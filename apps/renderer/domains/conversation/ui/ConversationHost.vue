<!-- apps/renderer/features/conversation/ui/ConversationHost.vue -->
<template>
  <div
    class="conversation-host"
    ref="overlayScrollHostRef"
    :data-conversation-content-state="conversationContentState"
    :data-overlay-scroll-theme="useOwnScrollViewport ? 'linnya' : undefined"
    :data-overlay-scroll-visibility="useOwnScrollViewport ? 'strict-hover' : undefined"
  >

    <div
      ref="conversationViewportRef"
      class="conversation-host-viewport"
      :data-conversation-scroll-viewport="useOwnScrollViewport ? 'true' : undefined"
    >
      <!-- 对话内容区域（包含时间轴） -->
      <div class="panel-content" ref="panelContentRef">
        <!-- 隐藏宿主不能继续持有虚拟列表和 DOM observers。 -->
        <ConversationView
          ref="conversationViewRef"
          v-if="isConversationViewActive && conversationRenderScopeId && !subrunDetailScope"
          :key="conversationRenderScopeId"
          :conversation-id="conversationRenderScopeId"
          :messages="activeMessages"
          :isLoading="isLoading"
          :isTimelineCollapsed="isTimelineCollapsed"
          :is-history-replay-loading="isHistoryReplayLoading"
          :use-overlay-scroll-viewport="!useOwnScrollViewport && !hideFooter"
          :has-more-before="messageWindowHasMoreBefore"
          :has-more-after="messageWindowHasMoreAfter"
          :message-window-status="messageWindowStatus"
          :message-window-loading-mode="messageWindowLoadingMode"
          :is-window-navigating="isWindowNavigating"
          class="conversation-view-container"
          @timeline-positions-change="handleTimelinePositionsChange"
          @scroll-to-bottom-visibility-change="handleScrollToBottomVisibilityChange"
          @load-before-requested="handleLoadBeforeRequested"
          @load-after-requested="handleLoadAfterRequested"
        />

        <SubrunDetailSurface
          v-else-if="isConversationViewActive && subrunDetailScope"
          :key="`${subrunDetailScope.parentToolCallId}:${subrunDetailScope.subrunId}`"
          :scope="subrunDetailScope"
          :messages="activeMessages"
          class="conversation-view-container"
        />

        <template v-if="!conversationRenderScopeId">
          <ClientNoticeMessageComponent v-for="notice in localNotices" :key="notice.id" :message="notice" />
        </template>

        <!-- 🆕 时间轴导航 - 绝对定位在右侧，固定不滚动 -->
        <TimelineNav
          v-if="isConversationViewActive && !subrunDetailScope && hasTimelineMessages"
          :markers="timelineMarkers"
          :scroll-container="conversationScrollContainer"
          :positions="timelinePositions"
          :is-collapsed="isTimelineCollapsed"
          @navigate-to-visual-turn="handleNavigateToVisualTurn"
        />
      </div>

      <!-- 底部输入区域 -->
      <div v-if="!hideFooter" class="panel-footer">
        <ScrollToBottomButton
          v-if="!subrunDetailScope"
          class="conversation-scroll-to-bottom"
          :show="showScrollToBottomButton"
          @click="handleScrollToBottomClick"
        />
        <CommandApprovalPanel :conversation-id="assistantStore.activeConversationId" />
        <AiAssistantInput
          v-if="!subrunDetailScope"
          :placeholder="inputPlaceholder"
          :variant="inputVariant"
          :disabled="isHistoryReplayLoading"
          :on-user-message-committed="handleUserMessageCommitted"
        />
        <SubrunDetailFooterPanel
          v-else-if="subrunDetailParentMessage && subrunDetailScope"
          :parent-message="subrunDetailParentMessage"
          :subrun-id="subrunDetailScope.subrunId"
          :conversation-id="subrunDetailScope.conversationId"
        />
      </div>

    </div>
  </div>
</template>

<script setup lang="ts">
import { useConversationWindowNavigation } from './conversationView/composables/useConversationWindowNavigation';
import { computed, ref, onBeforeUnmount, onMounted, nextTick, provide, watch } from 'vue';
import type { ConversationMessageId } from '@app/schemas';
import type { ConversationSurfaceVariant } from '../definitions/conversationPresentation';
import { useOverlayScrollViewport } from '@linnya/renderer-ui/scroll';
import { useNotificationStore } from '@/app/notification';
import { useAssistantStore } from '../store/assistantStore';
import { useConversationContentPhaseSelector } from '../store/conversationContentPhaseSelector';
import { useMessageWindowStore } from '../message-window';
import { loadHistoryWindowBefore } from '../history/orchestration/historyWindowBeforeLoader';
import { loadHistoryWindowAfter } from '../history/orchestration/historyWindowAfterLoader';
import { ensureHistoryWindowTailForBottom } from '../history';
import ConversationView from './ConversationView.vue';
import AiAssistantInput from './AiAssistantInput.vue';
import { useClientNoticePresentation } from '../features/client-notices';
import ClientNoticeMessageComponent from '../features/client-notices/ui/ClientNoticeMessage.vue';
import TimelineNav from './components/timeline/TimelineNav.vue';
import { ScrollToBottomButton } from '@linnya/renderer-ui';
import CommandApprovalPanel from '../features/command-approval/ui/CommandApprovalPanel.vue';
import { resolveScrollContainer } from './conversationView/utils/resolveScrollContainer';
import { isConversationHistoryPendingPhase } from '../functions/conversationContentPhase';
import {
  isTimelineNavigationAbortError,
  navigateToTimelineVisualTurn,
  useTimelineTurnIndex,
  waitForTimelineVisualTurnMounted,
  type TimelineMarker,
} from '../features/timeline';
import type { PositionInfo } from './components/timeline/composables/useTimelinePositions';
import { useConversationLocalization } from './useConversationLocalization';
import { useConversationInputExecution } from '../features/input-extensions';
import { createCommandCardControlPageOwner } from '../features/command-execution-presentation/orchestration/useCommandCardControl';
import type { ConversationVirtualizerCommands } from './conversationView/composables/useConversationScrollController';
import {
  SUBRUN_DETAIL_NAVIGATION_PORT_KEY,
  SubrunDetailFooterPanel,
  SubrunDetailSurface,
  resolveSubrunDetailParentMessage,
  useSubrunDetailNavigation,
  type SubrunDetailReturnAnchor,
} from '../features/subrun-detail';

const props = withDefaults(defineProps<{
  isTimelineCollapsed: boolean;
  isActive?: boolean;
  useOwnScrollViewport?: boolean;
  // 在某些视图下（如项目初始化），可以隐藏内置输入框，改由外层自行渲染
  hideFooter?: boolean;
  inputPlaceholder?: string;
  inputVariant?: ConversationSurfaceVariant;
}>(), {
  isActive: true,
  useOwnScrollViewport: false,
  hideFooter: false,
  inputVariant: 'regular',
});

// Stores
const assistantStore = useAssistantStore();
const messageWindowStore = useMessageWindowStore();
const notificationStore = useNotificationStore();
const { conversationMessage } = useConversationLocalization();
const commandCardControlPageOwner = createCommandCardControlPageOwner();

// 🆕 时间轴相关状态
const panelContentRef = ref<HTMLElement | null>(null); // 外层滚动容器
const overlayScrollHostRef = ref<HTMLElement | null>(null);
const conversationViewportRef = ref<HTMLElement | null>(null);
const overlayScrollViewportRef = ref<HTMLElement | null>(null);
const conversationScrollContainer = ref<HTMLElement | null>(null);
const timelinePositions = ref<PositionInfo[]>([]);
const conversationViewRef = ref<Pick<ConversationVirtualizerCommands, 'scrollToVisualTurn'> & {
  scrollToBottomManual: () => void;
  navigateToBottom: (signal: AbortSignal) => Promise<boolean>;
  scrollToMessage: (messageId: ConversationMessageId) => Promise<boolean>;
} | null>(null);
const showScrollToBottomButton = ref(false);
const windowNavigation = useConversationWindowNavigation();
const isWindowNavigating = windowNavigation.isNavigating;
const {
  init: initOverlayScroll,
  scheduleUpdate: scheduleOverlayScrollUpdate,
  destroy: destroyOverlayScroll,
} = useOverlayScrollViewport({
  bindings: {
    hostRef: overlayScrollHostRef,
    viewportMountRef: conversationViewportRef,
    viewportRef: overlayScrollViewportRef,
  },
});

// 计算属性
const { localNotices } = useClientNoticePresentation({
  conversationId: () => assistantStore.activeConversationId,
  messages: () => assistantStore.activeMessages,
  isActive: () => props.isActive,
});
const activeMessages = computed(() => [...assistantStore.activeMessages, ...localNotices.value]);
/**
 * ConversationHost 是导航身份的 owner。key 与显式 prop 保证旧 View 不会在会话切换后
 * 继续拿新 active id 发起异步读取；叶子工具卡只消费 View 提供的 render scope。
 */
const conversationRenderScopeId = computed(() => assistantStore.activeConversationId);
function findParentMessageElement(messageId: ConversationMessageId): HTMLElement | null {
  const candidates = panelContentRef.value?.querySelectorAll<HTMLElement>(
    '[data-conversation-message-id]',
  );
  return [...(candidates ?? [])].find(
    candidate => candidate.dataset.conversationMessageId === messageId,
  ) ?? null;
}

function captureSubrunReturnAnchor(parentMessageId: ConversationMessageId): SubrunDetailReturnAnchor {
  const element = findParentMessageElement(parentMessageId);
  const container = conversationScrollContainer.value;
  if (!element || !container) {
    throw new Error(`[SUBRUN_DETAIL_ANCHOR_MISSING] ${parentMessageId}`);
  }
  return {
    parentMessageId,
    offsetTop: element.getBoundingClientRect().top - container.getBoundingClientRect().top,
  };
}

async function restoreSubrunReturnAnchor(anchor: SubrunDetailReturnAnchor): Promise<void> {
  await syncConversationScrollContainer();
  const didScroll = await conversationViewRef.value?.scrollToMessage(anchor.parentMessageId);
  if (!didScroll) {
    throw new Error(`[SUBRUN_DETAIL_ANCHOR_NOT_IN_WINDOW] ${anchor.parentMessageId}`);
  }
  await nextTick();
  const element = findParentMessageElement(anchor.parentMessageId);
  const container = conversationScrollContainer.value;
  if (!element || !container) {
    throw new Error(`[SUBRUN_DETAIL_ANCHOR_NOT_MOUNTED] ${anchor.parentMessageId}`);
  }
  const currentOffset = element.getBoundingClientRect().top - container.getBoundingClientRect().top;
  container.scrollTop += currentOffset - anchor.offsetTop;
}

const subrunDetailNavigation = useSubrunDetailNavigation({
  conversationId: conversationRenderScopeId,
  captureAnchor: captureSubrunReturnAnchor,
  restoreAnchor: restoreSubrunReturnAnchor,
});
const subrunDetailScope = subrunDetailNavigation.scope;
const subrunDetailParentMessage = computed(() => {
  const scope = subrunDetailScope.value;
  if (!scope) return null;
  return resolveSubrunDetailParentMessage({
    messages: activeMessages.value,
    parentMessageId: scope.parentMessageId,
    parentToolCallId: scope.parentToolCallId,
  });
});
provide(SUBRUN_DETAIL_NAVIGATION_PORT_KEY, subrunDetailNavigation.port);
const contentPhase = useConversationContentPhaseSelector();
const isHistoryReplayLoading = computed(() => isConversationHistoryPendingPhase(contentPhase.value));
const inputExecution = useConversationInputExecution({
  isBusy: () => assistantStore.isBusy,
  isLoading: () => assistantStore.isLoading,
  isStreaming: () => assistantStore.isStreaming,
  cancel: () => assistantStore.cancelCurrentStream(),
});
const isLoading = inputExecution.isLoading;
const isStreaming = inputExecution.isStreaming;
const isConversationViewActive = computed(() => props.isActive);
const messageWindowHasMoreBefore = computed(() => (
  messageWindowStore.conversationId === assistantStore.activeConversationId && messageWindowStore.hasMoreBefore
));
const messageWindowHasMoreAfter = computed(() => (
  messageWindowStore.conversationId === assistantStore.activeConversationId && messageWindowStore.hasMoreAfter
));
const messageWindowStatus = computed(() => messageWindowStore.status);
const messageWindowLoadingMode = computed(() => messageWindowStore.loadingMode);
const { markers: timelineMarkers, status: timelineIndexStatus } = useTimelineTurnIndex({
  conversationId: computed(() => assistantStore.activeConversationId),
  messages: activeMessages,
  isStreaming,
  windowConversationId: computed(() => messageWindowStore.conversationId),
  windowStatus: messageWindowStatus,
  windowRevision: computed(() => messageWindowStore.revision),
});
watch(timelineIndexStatus, (status, previousStatus) => {
  if (status === 'error' && previousStatus !== 'error') {
    notificationStore.show(
      conversationMessage('conversation.timeline.loadFailed'),
      'error',
      3000,
    );
  }
});
const hasTimelineMessages = computed(() => timelineMarkers.value.length > 0);
const conversationContentState = computed(() => (
  subrunDetailScope.value
    ? 'filled'
    : (contentPhase.value === 'draft' || contentPhase.value === 'ready-empty' ? 'empty' : 'filled')
));

const handleNavigateToVisualTurn = async (marker: TimelineMarker): Promise<void> => {
  const conversationId = assistantStore.activeConversationId;
  if (!conversationId || !conversationViewRef.value) return;
  try {
    await windowNavigation.run(async signal => {
      await navigateToTimelineVisualTurn(conversationId, marker, {
        signal,
        scrollToVisualTurn: visualTurnId => (
          conversationViewRef.value?.scrollToVisualTurn(visualTurnId, signal)
          ?? Promise.resolve(false)
        ),
        waitForVisualTurnMounted: visualTurnId => waitForTimelineVisualTurnMounted(
          timelinePositions,
          visualTurnId,
          signal,
        ),
      });
    });
  } catch (caught) {
    if (isTimelineNavigationAbortError(caught)) return;
    console.error('[TimelineNavigation] Failed to navigate to turn:', caught);
  }
};

/**
 * @description
 * 统一承接 ConversationView 上报的轮次位置，再显式传给 TimelineNav。
 * 这样数据流始终经过共同父组件，避免兄弟组件之间错误使用 provide/inject。
 */
const handleTimelinePositionsChange = (positions: PositionInfo[]) => {
  timelinePositions.value = positions;
};

const handleScrollToBottomVisibilityChange = (show: boolean) => {
  showScrollToBottomButton.value = show;
};

const handleScrollToBottomClick = async () => {
  const conversationId = assistantStore.activeConversationId;
  const view = conversationViewRef.value;
  if (!conversationId || !view) return;
  try {
    await windowNavigation.run(async signal => {
      const status = await ensureHistoryWindowTailForBottom(conversationId, undefined, { signal });
      if (signal.aborted || (status !== 'current' && status !== 'reloaded')) return;
      await view.navigateToBottom(signal);
    });
  } catch (caught) {
    if (isTimelineNavigationAbortError(caught)) return;
    console.error('[ConversationNavigation] Failed to return to bottom:', caught);
  }
};

const handleUserMessageCommitted = (): void => {
  conversationViewRef.value?.scrollToBottomManual();
};

const handleLoadBeforeRequested = async () => {
  const conversationId = assistantStore.activeConversationId;
  if (!conversationId || isWindowNavigating.value) return;
  await loadHistoryWindowBefore(conversationId);
};

const handleLoadAfterRequested = async () => {
  const conversationId = assistantStore.activeConversationId;
  if (!conversationId || isWindowNavigating.value) return;
  await loadHistoryWindowAfter(conversationId);
};


const syncConversationScrollContainer = async () => {
  await nextTick();

  if (!panelContentRef.value) {
    conversationScrollContainer.value = null;
    return;
  }

  const conversationViewEl = panelContentRef.value.querySelector('.conversation-view');
  if (!(conversationViewEl instanceof HTMLElement)) {
    conversationScrollContainer.value = null;
    return;
  }

  conversationScrollContainer.value = resolveScrollContainer(conversationViewEl);
};

const syncOverlayScrollViewport = async () => {
  await nextTick();

  if (!props.useOwnScrollViewport || !props.isActive) {
    destroyOverlayScroll();
    return;
  }

  initOverlayScroll();
};

// 生命周期
onMounted(async () => {
  await syncOverlayScrollViewport();
  await syncConversationScrollContainer();
});

watch(
  () => [
    assistantStore.activeConversationId,
    activeMessages.value.length,
    props.isActive,
    props.useOwnScrollViewport,
    subrunDetailScope.value,
  ] as const,
  async () => {
    await syncOverlayScrollViewport();
    if (props.useOwnScrollViewport) {
      scheduleOverlayScrollUpdate();
    }
    void syncConversationScrollContainer();
  },
  { flush: 'post' }
);

watch(
  () => assistantStore.activeConversationId,
  () => {
    windowNavigation.cancel();
    timelinePositions.value = [];
  },
  { immediate: true }
);

watch(
  () => [assistantStore.activeConversationId, props.isActive] as const,
  ([conversationId, isActive]) => {
    if (isActive && conversationId) {
      void commandCardControlPageOwner.ensure(conversationId);
      return;
    }
    commandCardControlPageOwner.release();
  },
  { immediate: true },
);

watch(
  () => props.isActive,
  (isActive) => {
    if (isActive) return;
    windowNavigation.cancel();
    subrunDetailNavigation.reset();
    // 侧栏重开后必须等待新实例测量，不能短暂复用隐藏前的视图派生状态。
    conversationScrollContainer.value = null;
    timelinePositions.value = [];
    showScrollToBottomButton.value = false;
  },
);

onBeforeUnmount(() => {
  // detail scope 进入 feature store 后不再随组件实例自然销毁；Host 卸载必须显式结束当前子 surface，
  // 保持“交换 pane 等价于关闭详情”的既有生命周期语义，也避免应用 Header 残留子标题。
  subrunDetailNavigation.reset();
  commandCardControlPageOwner.release();
  windowNavigation.cancel();
});
</script>
