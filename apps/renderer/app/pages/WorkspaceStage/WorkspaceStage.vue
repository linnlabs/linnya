<template>
  <div
    ref="workspaceStageRef"
    class="workspace-stage"
  >
    <!-- 隐藏对话不能继续持有滚动实例、DOM observers 或分页 watch。 -->
    <section v-if="layoutState.layoutMode === 'chat-centric'" class="workspace-stage__chat">
      <ChatCentricPage />
    </section>

    <PaneDivider
      v-if="shouldShowRightPane"
      class="workspace-stage__pane-divider"
      side="left"
      interaction-group="workspace-split"
      interactive
      :label="resizePaneLabel"
      :min="paneGeometry.rightPaneMinWidth"
      :max="paneGeometry.rightPaneMaxWidth"
      :value="paneGeometry.rightPaneWidth"
      @resize-start="startResize"
      @resize-to="layoutStore.setPreferredRightPaneWidth"
    />

    <!-- 文档 runtime 只能有一份；左右交换只是几何变化，不能通过两套 DocumentPane 互相卸载来实现。 -->
    <div
      v-if="shouldMountDocumentPane"
      class="workspace-stage__document-frame"
      :class="documentPaneFrameClasses"
      :style="documentPaneFrameStyle"
    >
      <DocumentPane
        v-if="layoutState.activeDocument !== null"
        class="workspace-stage__document"
        :class="documentPaneClasses"
        :style="documentPaneContentStyle"
      />
      <section
        v-else
        class="workspace-stage__empty-files workspace-stage__document"
        :class="documentPaneClasses"
        :style="documentPaneContentStyle"
      >
        <span>{{ layoutMessage('layout.workspaceFiles.empty') }}</span>
      </section>
    </div>

    <div
      v-if="shouldMountConversationSidePane"
      class="workspace-stage__right-pane-frame"
      :class="{ 'workspace-stage__pane-frame--visible': shouldShowRightPane }"
      :style="conversationPaneFrameStyle"
      @transitionend="handleConversationPaneFrameTransitionEnd"
    >
      <ConversationSidePane
        class="workspace-stage__conversation-side"
        :style="conversationPaneContentStyle"
        :is-active="isConversationSidePaneContentActive"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, defineAsyncComponent, ref, watch } from 'vue';
import ChatCentricPage from '@/app/pages/ChatCentricPage/ChatCentricPage.vue';
import PaneDivider from '@/app/layout/components/PaneDivider.vue';
import { useLayoutLocalization } from '@/app/layout/composables/useLayoutLocalization';
import { useRightPaneResize } from '@/app/layout/composables/useRightPaneResize';
import { useWorkspacePaneGeometry } from '@/app/layout/composables/useWorkspacePaneGeometry';
import { useWorkspaceStageMeasurement } from '@/app/layout/composables/useWorkspaceStageMeasurement';
import { useLayoutStore } from '@/app/layout/store/layoutStore';

// 文档和右侧会话 pane 都由 v-if 控制；未进入对应布局时不加载其完整运行时。
const ConversationSidePane = defineAsyncComponent(() => import('@/app/layout/chat/ConversationSidePane.vue'));
const DocumentPane = defineAsyncComponent(() => import('@/app/layout/document/DocumentPane.vue'));

const layoutStore = useLayoutStore();
const { layoutMessage } = useLayoutLocalization();
const layoutState = computed(() => layoutStore.state);
const workspaceStageRef = ref<HTMLElement | null>(null);
useWorkspaceStageMeasurement(workspaceStageRef);
const { geometry: paneGeometry } = useWorkspacePaneGeometry();

const hasDocumentPaneContent = computed(() => (
  layoutState.value.activeDocument !== null
  || layoutState.value.documentPane.emptyStateVisible
));

const shouldShowRightDocumentPane = computed(() => {
  return (
    layoutState.value.layoutMode === 'chat-centric'
    && hasDocumentPaneContent.value
    && paneGeometry.value.rightPaneOccupiedWidth > 0
  );
});

const shouldShowRightPane = computed(() => (
  hasDocumentPaneContent.value
  && paneGeometry.value.rightPaneOccupiedWidth > 0
));

const resizePaneLabel = computed(() => (
  layoutState.value.layoutMode === 'chat-centric'
    ? layoutMessage('layout.pane.resizeDocument')
    : layoutMessage('layout.pane.resizeConversation')
));

const shouldMountDocumentPane = computed(() => hasDocumentPaneContent.value);

const shouldMountConversationSidePane = computed(() => (
  layoutState.value.layoutMode === 'editor-centric'
  && hasDocumentPaneContent.value
));

const documentPaneFrameClasses = computed(() => ({
  'workspace-stage__document-frame--main': layoutState.value.layoutMode === 'editor-centric',
  'workspace-stage__document-frame--right': layoutState.value.layoutMode === 'chat-centric',
  'workspace-stage__pane-frame--visible':
    layoutState.value.layoutMode === 'editor-centric' || shouldShowRightDocumentPane.value,
}));

const documentPaneClasses = computed(() => ({
  'workspace-stage__document--main': layoutState.value.layoutMode === 'editor-centric',
  'workspace-stage__document--right': layoutState.value.layoutMode === 'chat-centric',
}));

const documentPaneFrameStyle = computed(() => {
  if (layoutState.value.layoutMode === 'editor-centric') {
    return {};
  }

  return {
    width: `${paneGeometry.value.rightPaneOccupiedWidth}px`,
  };
});

const documentPaneContentStyle = computed(() => {
  if (layoutState.value.layoutMode === 'editor-centric') {
    return { width: '100%' };
  }

  return { width: `${paneGeometry.value.rightPaneWidth}px` };
});

const conversationPaneFrameStyle = computed(() => ({
  width: `${paneGeometry.value.rightPaneOccupiedWidth}px`,
}));

// 右侧对话使用抽屉几何：外框负责 0 → target 的裁剪动画，正文从第一帧起保持 target 宽度。
// 若正文跟随外框逐帧变宽，长对话会持续换行并触发虚拟列表锚点二次收敛。
const conversationPaneContentStyle = computed(() => ({
  width: `${paneGeometry.value.rightPaneWidth}px`,
}));

// 展开前先恢复 ConversationView；收起动画结束后再释放其 observers 和虚拟滚动实例。
// 这样退出动画仍能裁剪已有正文，但完全隐藏后不会让后台 surface 持续工作。
const isConversationSidePaneContentActive = ref(shouldShowRightPane.value);
watch(
  shouldShowRightPane,
  (shouldShow) => {
    if (shouldShow) isConversationSidePaneContentActive.value = true;
  },
  { flush: 'sync' },
);

const handleConversationPaneFrameTransitionEnd = (event: TransitionEvent): void => {
  if (event.target !== event.currentTarget || event.propertyName !== 'width') return;
  if (!shouldShowRightPane.value) {
    isConversationSidePaneContentActive.value = false;
  }
};

const { startResize } = useRightPaneResize({
  getRightBoundary: () => workspaceStageRef.value?.getBoundingClientRect().right ?? globalThis.innerWidth,
  getWidthLimits: () => ({
    min: paneGeometry.value.rightPaneMinWidth,
    max: paneGeometry.value.rightPaneMaxWidth,
  }),
  setWidth: layoutStore.setPreferredRightPaneWidth,
});
</script>
