<!--
 * BlockChrome.vue
 *
 * 块级 chrome 组件：拖拽柄、批注按钮、修订指示器/工具栏、历史模式 UI。
 * 仅在块进入视口附近时由 BlockView 挂载（v-if），避免为离屏块创建重型 composable。
 *
 * 设计说明：
 * - 接收 Tiptap NodeView 的全套 props + 父组件的 DOM ref + 可见性状态
 * - 自身管理焦点/选区检测，避免把旧 BlockView 壳组件重新做重
 * - 运行所有重型 composable（批注、拖拽、修订、历史、版本）
 * - 通过 watcher 直接操作父级 DOM 元素的 class/attribute（避免改变 DOM 结构）
 * - 历史面板通过 Teleport 渲染到 node-view-content 之后（保持 DOM 顺序）
 -->
<template>
  <!-- 左侧控制岛：拖拽手柄 + 版本按钮 -->
  <BlockLeftHandleGroup
    v-if="isRootBlock && blockActivation.renderHandles.value"
    :block-id="currentRootBlockId ?? ''"
    :has-history="versionHandleState.hasHistory.value"
    :version-count="versionHandleState.versionCount.value"
    :latest-version-number="versionHandleState.latestVersionNumber.value"
    @drag-mousedown="dragState.handleDragHandleMouseDown"
    @drag-mouseup="dragState.handleDragHandleMouseUp"
    @dragstart="dragState.onDragStart"
    @dragend="dragState.onDragEnd"
    @contextmenu="dragState.handleDragHandleContextMenu"
    @version-click="versionHandleState.handleVersionClick"
    @register-drag-handle="onRegisterDragHandle"
  />

  <!-- 修订状态指示条（块顶部一小行） -->
  <div
    v-if="blockActivation.renderRevisionChrome.value && revisionState.hasPendingRevision.value"
    class="block-revision-indicator-row"
  >
    <RevisionIndicator
      :status="revisionState.blockRevisionState.value?.status || 'pending'"
      :insert-count="revisionState.revisionDiffStats.value.insertCount"
      :delete-count="revisionState.revisionDiffStats.value.deleteCount"
      :created-at="revisionState.blockRevisionState.value?.createdAt"
    />
  </div>

  <!-- 批注按钮 -->
  <AnnotationHandle
    v-if="isRootBlock && blockActivation.renderAnnotation.value"
    :annotations="annotationState.annotationsForBlock.value"
    @create-annotation="annotationState.onAnnotationClick"
  />

  <!-- 修订工具栏（悬浮在块上方） -->
  <RevisionToolbar
    v-if="blockActivation.renderRevisionToolbar.value && revisionState.hasPendingRevision.value"
    :visible="true"
    :block-id="currentRootBlockId ?? ''"
    :position="revisionState.revisionToolbarPosition.value"
    :insert-count="revisionState.revisionDiffStats.value.insertCount"
    :delete-count="revisionState.revisionDiffStats.value.deleteCount"
    @accept-all="revisionState.handleAcceptAllRevisions"
    @reject-all="revisionState.handleRejectAllRevisions"
    @mouseenter="handleRevisionToolbarMouseEnter"
    @mouseleave="handleRevisionToolbarMouseLeave"
  />

  <!-- 历史 side-by-side 模式头部 -->
  <div
    v-if="blockActivation.renderHistory.value && historyState.isInSideBySideMode.value"
    class="block-history-side-by-side-header"
  >
    <div class="header-main-row">
      <div class="header-left">
        <span class="header-label">
          {{ historyState.currentVersionLabel.value }}
        </span>
      </div>
      <div class="header-right">
        <span class="header-label">
          {{ historyState.selectedVersionLabel.value }}
        </span>
        <CustomSelect
          v-if="historyState.selectedHistoryVersion.value"
          :options="moreMenuOptions"
          :on-select="handleMoreMenuSelect"
          variant="minimal"
          :manual-mode="false"
          :placeholder="''"
          :title="editorMessage('editor.common.moreActions')"
          :class-names="{
            trigger: 'block-history-more-trigger',
            selectedValue: 'block-history-more-value',
            options: 'block-history-more-options',
          }"
          class="header-more-menu"
        >
          <template #arrow-icon>
            <MoreIcon direction="horizontal" class="more-icon" />
          </template>
        </CustomSelect>
      </div>
    </div>
  </div>

  <!--
    后置历史面板：通过 Teleport 渲染到 node-view-content 之后，
    保持 flex 布局（side-by-side）和 DOM 顺序正确
  -->
  <Teleport v-if="historyMountTarget && blockActivation.renderHistory.value" :to="historyMountTarget">
    <HistorySideBySide
      v-if="historyState.isInSideBySideMode.value"
      class="root-block-history-panel"
      :block-id="historyState.currentBlockId.value"
      :current-content="historyState.getCurrentBlockContent.value"
      :document-node-id="historyState.documentNodeId.value"
      @exit="historyState.handleExitHistoryMode"
      @restore="historyState.handleHistoryRestore"
    />

    <HistoryOverlay
      v-if="historyState.isInOverlayMode.value"
      :block-id="historyState.currentBlockId.value"
      :document-node-id="historyState.documentNodeId.value"
      @close="historyState.handleExitHistoryMode"
      @restore="historyState.handleHistoryRestore"
    />

    <HistoryTimeline
      v-if="historyState.isInHistoryMode.value"
      :block-id="historyState.currentBlockId.value"
      :document-node-id="historyState.documentNodeId.value"
      @exit="historyState.handleExitHistoryMode"
      @version-select="historyState.handleVersionSelect"
      @restore="historyState.handleHistoryRestore"
    />
  </Teleport>

  <!-- 应用历史版本前的确认对话框 -->
  <AlertDialog
    v-if="historyState.showUnsavedVersionDialog.value"
    :visible="historyState.showUnsavedVersionDialog.value"
    is-confirmation
    :close-is-cancel="false"
    width="520px"
    :title="editorMessage('editor.blockHistory.applyDialog.title')"
    :message="editorMessage('editor.blockHistory.applyDialog.message')"
    :confirm-text="editorMessage('editor.blockHistory.applyDialog.confirm')"
    :cancel-text="editorMessage('editor.blockHistory.applyDialog.cancel')"
    @confirm="historyState.confirmRestoreWithSnapshot"
    @cancel="historyState.confirmRestoreDiscardChanges"
    @close="historyState.cancelRestoreDialog"
  />
  <AlertDialog
    v-if="historyState.showDeleteVersionDialog.value"
    :visible="historyState.showDeleteVersionDialog.value"
    is-confirmation
    :close-is-cancel="true"
    width="420px"
    :title="editorMessage('editor.blockHistory.deleteDialog.title')"
    :message="deleteVersionDialogMessage"
    :confirm-text="editorMessage('editor.blockHistory.deleteDialog.confirm')"
    :cancel-text="editorMessage('editor.blockHistory.deleteDialog.cancel')"
    @confirm="historyState.confirmDeleteVersion"
    @cancel="historyState.cancelDeleteVersion"
    @close="historyState.cancelDeleteVersion"
  />
</template>

<script setup lang="ts">
import { ref, computed, watch, defineAsyncComponent, inject, type ComputedRef } from 'vue';
import { NodeSelection } from 'prosemirror-state';
import type { Editor } from '@tiptap/vue-3';
import type { Node as ProseMirrorNode } from 'prosemirror-model';

// UI 组件
import AnnotationHandle from '../features/Annotation/ui/AnnotationHandle.vue';
import RevisionToolbar from '../features/Revision/ui/RevisionToolbar.vue';
import RevisionIndicator from '../features/Revision/ui/RevisionIndicator.vue';
import { CustomSelect } from '@linnya/renderer-ui';
import type { CustomSelectOption } from '@linnya/renderer-ui';
import { MoreIcon } from '@linnya/renderer-ui/icons';
import BlockLeftHandleGroup from './components/BlockLeftHandleGroup.vue';
import {
  applyRenderVirtualizationKeepAliveCommand,
  RENDER_VIRTUALIZATION_KEEP_ALIVE_PORT_KEY,
  type RenderVirtualizationKeepAliveReason,
} from '../features/RenderVirtualization';

// Composables
import {
  useBlockDragAndMenu,
  useBlockAnnotations,
  useBlockRevision,
  useBlockHistoryUi,
  useBlockVersionHandle,
} from './composables';
import { useBlockActivation } from './composables/useBlockActivation';
import { useFocusedRootBlockSelection } from './composables/focusedRootBlockSelection';
import {
  useBlockChromeDomSync,
  resolveBlockChromeOuterElement,
  type BlockChromeElementSource,
} from './composables/useBlockChromeDomSync';
import { useBlockChromeLifecycle } from './composables/useBlockChromeLifecycle';
import { recordBlockActivationState } from './composables/blockChromeRuntimePerf';
import { useEditorLocalization } from './useEditorLocalization';

const HistorySideBySide = defineAsyncComponent(
  () => import('../features/BlockHistory/ui/HistorySideBySide.vue')
);
const HistoryOverlay = defineAsyncComponent(
  () => import('../features/BlockHistory/ui/HistoryOverlay.vue')
);
const HistoryTimeline = defineAsyncComponent(
  () => import('../features/BlockHistory/ui/HistoryTimeline.vue')
);
const AlertDialog = defineAsyncComponent(
  () => import('@linnya/renderer-ui').then(({ AlertDialog: component }) => component)
);

// ==================== Props ====================

interface BlockChromeProps {
  editor: Editor;
  node: ProseMirrorNode;
  selected: boolean;
  getPos: () => number;
  /** 父级 root-block-outer 元素（用于 class/event 管理） */
  rootBlockOuterEl: BlockChromeElementSource;
  /** 父级 root-block 元素（用于历史模式 class） */
  rootBlockEl: HTMLElement | null;
  /** 可见性：块是否在视口附近（nearViewport） */
  isBlockVisible: boolean;
  /** 可见性：块是否在精确视口中 */
  isBlockInViewport: boolean;
  /** 可见性：块是否在历史 UI 视口中 */
  isBlockHistoryVisible: boolean;
  /** Teleport 目标：用于历史面板（位于 node-view-content 之后） */
  historyMountTarget: HTMLElement | null;
  /** 保活状态（来自父级 provideBlockKeepAlive） */
  isKeepAlive: ComputedRef<boolean>;
}

const props = defineProps<BlockChromeProps>();
const setupStartedAt = performance.now();
const injectedKeepAlivePort = inject(RENDER_VIRTUALIZATION_KEEP_ALIVE_PORT_KEY, null);
const { editorMessage } = useEditorLocalization();

// ==================== 基础状态（焦点 / 选区） ====================
// 小文档路径仍需要本地焦点 / 选区 read-model；大文档 Host 路径不走这里。

const isRootBlock = computed(() => props.node.type.name === 'rootBlock');
const isFocused = ref(false);
const isBlockSelected = ref(false);
const isHandleSelected = ref(false);
const isRevisionToolbarHovered = ref(false);
const dragHandleRef = ref<HTMLElement | null>(null);

// 将 prop（非 ref）包装为 computed，供 composable 消费
const isBlockVisibleRef = computed(() => props.isBlockVisible);
const isBlockInViewportRef = computed(() => props.isBlockInViewport);
const isBlockHistoryVisibleRef = computed(() => props.isBlockHistoryVisible);
const currentRootBlockId = computed<string | null>(() => {
  const blockId = props.node.attrs.id;
  return typeof blockId === 'string' && blockId.length > 0 ? blockId : null;
});
const currentRootBlockContentJson = computed<string>(() => JSON.stringify(props.node.toJSON()));

const focusedRootBlockId = useFocusedRootBlockSelection(props.editor);

watch(
  () => ({
    currentBlockId: currentRootBlockId.value,
    focusedBlockId: focusedRootBlockId.value,
  }),
  ({ currentBlockId, focusedBlockId }) => {
    isFocused.value = !!currentBlockId && currentBlockId === focusedBlockId;
  },
  { immediate: true }
);

watch(
  () => props.selected,
  (isSelected) => {
    const sel = props.editor?.state?.selection;
    isBlockSelected.value = !!(isSelected && sel instanceof NodeSelection);
    if (!isSelected) isHandleSelected.value = false;
  }
);

const setBlockSelected = (selected: boolean, fromHandle = false) => {
  isBlockSelected.value = selected;
  if (fromHandle) isHandleSelected.value = selected;
};

// ==================== Composables 初始化 ====================

const annotationState = useBlockAnnotations({
  editor: props.editor,
  blockId: currentRootBlockId,
  isRootBlock,
});

const dragState = useBlockDragAndMenu({
  props: {
    editor: props.editor,
    rootBlockId: currentRootBlockId,
  },
  dragHandleRef,
  hasAnnotations: annotationState.hasAnnotations,
  setBlockSelected,
});

const revisionState = useBlockRevision({
  props: computed(() => ({
    editor: props.editor,
    blockId: currentRootBlockId.value,
  })),
  enabled: isBlockVisibleRef,
});

const historyState = useBlockHistoryUi({
  props: {
    editor: props.editor,
    blockId: currentRootBlockId,
    currentContentJson: currentRootBlockContentJson,
    getRootBlockPos: props.getPos,
  },
  enabled: isBlockVisibleRef,
});

const versionHandleState = useBlockVersionHandle({
  blockId: currentRootBlockId,
  isBlockVisible: isBlockVisibleRef,
});

// 中文说明：
// - 修订工具栏显示在块的右下角外侧，鼠标从块本体移向工具栏时会先触发 outer 的 pointerleave；
// - 如果仍然只依赖块本体 hover，工具栏会在进入前被隐藏。
// - 因此这里把“块 hover”和“工具栏 hover”合并成统一的修订交互 hover。
const revisionInteractionHovered = computed(() => {
  return annotationState.isHovered.value || isRevisionToolbarHovered.value;
});

const blockActivation = useBlockActivation({
  isBlockVisible: isBlockVisibleRef,
  isBlockInViewport: isBlockInViewportRef,
  isBlockHistoryVisible: isBlockHistoryVisibleRef,
  isFocused,
  isBlockSelected,
  isHandleSelected,
  isHovered: revisionInteractionHovered,
  isInHistoryMode: historyState.isInHistoryMode,
  isKeepAlive: props.isKeepAlive,
});

// ==================== DOM 交互管理 ====================
// 在父级 root-block-outer 上管理交互 class 和事件

watch(
  () => ({
    active: blockActivation.isUiActive.value,
    blockId: currentRootBlockId.value,
    reasons: blockActivation.activationReasons.value,
  }),
  ({ active, blockId, reasons }) => {
    if (!blockId) return;
    recordBlockActivationState({
      blockId,
      active,
      reasons,
    });
  },
  { immediate: true }
);

function setRenderVirtualizationKeepAlive(
  reason: RenderVirtualizationKeepAliveReason,
  active: boolean
): void {
  const blockId = currentRootBlockId.value;
  if (!blockId) return;

  // 中文说明：旧 BlockChrome 路径也优先走显式 KeepAlivePort；
  // DOM event 只作为非 EditorContext 挂载时的 legacy adapter，避免 Teleport/detached release 丢失。
  applyRenderVirtualizationKeepAliveCommand({
    port: injectedKeepAlivePort,
    legacyTarget: resolveBlockChromeOuterElement(props.rootBlockOuterEl),
    command: {
      blockId,
      reason,
    },
    active,
  });
}

const blockChromeDomSync = useBlockChromeDomSync({
  rootBlockOuterEl: () => props.rootBlockOuterEl,
  rootBlockEl: () => props.rootBlockEl,
  isDragging: dragState.isDragging,
  isBlockSelected,
  isHandleSelected,
  hasAnnotations: annotationState.hasAnnotations,
  revisionToolbarActive: computed(() => {
    return blockActivation.renderRevisionToolbar.value && revisionState.hasPendingRevision.value;
  }),
  isInHistoryMode: historyState.isInHistoryMode,
  isInSideBySideMode: historyState.isInSideBySideMode,
  setRenderVirtualizationKeepAlive,
});

const getOuterEl = blockChromeDomSync.getOuterEl;

// ==================== 更多菜单 ====================

const moreMenuOptions = computed<CustomSelectOption<string>[]>(() => {
  const selectedVersion = historyState.selectedHistoryVersion.value;
  if (!selectedVersion) return [];
  const label = editorMessage('editor.blockHistory.more.deleteVersion', {
    version: selectedVersion.version_number,
  });
  return [{ label, text: label, value: 'delete', variant: 'danger' }];
});

const deleteVersionDialogMessage = computed<string>(() => {
  const version = historyState.selectedHistoryVersion.value;
  if (!version) return editorMessage('editor.blockHistory.deleteDialog.message');
  return editorMessage('editor.blockHistory.deleteDialog.messageWithVersion', {
    version: version.version_number,
  });
});

const handleMoreMenuSelect = (value: string | number | null) => {
  if (value !== 'delete') return;
  const selectedVersion = historyState.selectedHistoryVersion.value;
  if (selectedVersion) historyState.handleDeleteVersion(selectedVersion.id);
};

const onRegisterDragHandle = (el: HTMLElement) => {
  dragHandleRef.value = el;
};

function handleRevisionToolbarMouseEnter() {
  isRevisionToolbarHovered.value = true;
}

function handleRevisionToolbarMouseLeave() {
  isRevisionToolbarHovered.value = false;
}

useBlockChromeLifecycle({
  blockId: currentRootBlockId,
  setupStartedAt,
  getOuterEl,
  onPointerEnter: annotationState.onPointerEnter,
  onPointerLeave: annotationState.onPointerLeave,
  onMountedWhileHovered: () => annotationState.onPointerEnter(new Event('pointerenter')),
  setupDropIndicator: dragState.setupDropIndicator,
  cleanupDropIndicator: dragState.cleanupDropIndicator,
  cleanupHoverTimer: annotationState.cleanupHoverTimer,
  cleanupDomSync: blockChromeDomSync.cleanup,
  clearRevisionToolbarHover: () => {
    isRevisionToolbarHovered.value = false;
  },
});
</script>
