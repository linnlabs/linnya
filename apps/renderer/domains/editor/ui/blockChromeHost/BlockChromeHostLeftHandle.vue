<template>
  <BlockLeftHandleGroup
    :block-id="blockId"
    :has-history="versionSummary.hasHistory"
    :version-count="versionSummary.versionCount"
    :latest-version-number="versionSummary.latestVersionNumber"
    @drag-mousedown="handleDragHandleMouseDown"
    @drag-mouseup="handleDragHandleMouseUp"
    @dragstart="handleDragStart"
    @dragend="handleDragEnd"
    @contextmenu="handleContextMenu"
    @version-click="handleVersionClick"
    @register-drag-handle="registerDragHandle"
  />
</template>

<script setup lang="ts">
/**
 * Host 版 left-handle 最小入口。
 *
 * 中文说明：
 * - 这一刀只接管大文档裸 DOM RootBlock 的拖拽、菜单入口和历史版本入口；
 * - 组件只消费 `editor + blockId`，不接收 NodeView 的 `node/getPos`，保持 Host 与具体 NodeView 实现解耦。
 */

import { computed, onBeforeUnmount, ref, watch } from 'vue';
import type { Editor } from '@tiptap/vue-3';
import BlockLeftHandleGroup from '../components/BlockLeftHandleGroup.vue';
import {
  handleDragStartByRootBlockId,
  handleDragEndForEditor,
} from '../../extensions/interaction/drag/dragUtils.js';
import {
  beginRootBlockDragHandlePress,
  beginRootBlockDragVisualLifecycle,
  cleanupRootBlockDragVisualLifecycle,
  endRootBlockDragInteraction,
  endRootBlockDragHandlePress,
} from '../../extensions/interaction/drag/rootBlockDragLifecycle';
import { openBlockActionMenuForRootBlockId } from '../../features/blockActionMenu/orchestration/openBlockActionMenuForRootBlockId';
import { useOpenBlockActionMenuRootBlockId } from '../../features/blockActionMenu/readModel';
import { useBlockVersionHandleSummary } from '../../features/BlockHistory/readModel';
import { ensureBlockHistoryLoadedForRootBlockId } from '../../features/BlockHistory/orchestration/ensureBlockHistoryLoadedForRootBlockId';
import { toggleBlockHistoryForRootBlockId } from '../../features/BlockHistory/orchestration/toggleBlockHistoryForRootBlockId';
import { useRenderVirtualizationKeepAliveLease } from '../../features/RenderVirtualization/state/useRenderVirtualizationKeepAliveLease';
import { useFileStore } from '../../../../shared/stores/file';

const props = defineProps<{
  editor: Editor;
  blockId: string;
}>();

const dragHandleRef = ref<HTMLElement | null>(null);
const fileStore = useFileStore();
const currentBlockId = computed(() => props.blockId);
const currentDocumentNodeId = computed(() => fileStore.currentFilePath || '');
const versionSummary = useBlockVersionHandleSummary(currentBlockId);
const openMenuBlockId = useOpenBlockActionMenuRootBlockId();
const isDragging = ref(false);
const isHandleSelected = ref(false);
let dragHandleMouseDownAt = 0;
let dragHandleStartTime = 0;

useRenderVirtualizationKeepAliveLease({
  target: () => dragHandleRef.value,
  fallbackTarget: () => props.editor.view.dom,
  blockId: currentBlockId,
  reason: 'dragging',
  active: isDragging,
});

watch(
  () => ({
    documentNodeId: currentDocumentNodeId.value,
    blockId: currentBlockId.value,
  }),
  async ({ documentNodeId, blockId }) => {
    const result = await ensureBlockHistoryLoadedForRootBlockId({
      documentNodeId,
      blockId,
    });

    if (!result.ok && result.reason !== 'missing-document-node-id' && result.reason !== 'missing-block-id') {
      console.error('[BlockChromeHostLeftHandle] 预加载历史版本失败:', result);
    }
  },
  { immediate: true }
);

watch(
  () => openMenuBlockId.value,
  (blockId) => {
    if (blockId !== props.blockId && !isDragging.value) {
      isHandleSelected.value = false;
    }
  }
);

watch(
  () => isHandleSelected.value || openMenuBlockId.value === props.blockId || isDragging.value,
  (active) => {
    setRootBlockSelectionVisual(active);
  },
  { immediate: true, flush: 'post' }
);

function registerDragHandle(el: HTMLElement): void {
  dragHandleRef.value = el;
}

function handleDragHandleMouseDown(event: MouseEvent): void {
  if (!beginRootBlockDragHandlePress(event)) return;
  event.stopPropagation();
  dragHandleMouseDownAt = event.clientY;
  dragHandleStartTime = Date.now();
  isHandleSelected.value = true;
}

async function openMenuFromHandle(mode: 'open' | 'toggle'): Promise<void> {
  const anchorElement = dragHandleRef.value;
  if (!anchorElement) {
    isHandleSelected.value = false;
    return;
  }

  const result = await openBlockActionMenuForRootBlockId({
    editor: props.editor,
    rootBlockId: props.blockId,
    anchorElement,
    mode,
  });

  if (!result.ok || result.action !== 'opened') {
    isHandleSelected.value = false;
  }
}

function handleDragHandleMouseUp(event: MouseEvent): void {
  endRootBlockDragHandlePress();

  const mouseMoveDistance = Math.abs(event.clientY - dragHandleMouseDownAt);
  const timeSinceMouseDown = Date.now() - dragHandleStartTime;

  if (mouseMoveDistance < 5 && timeSinceMouseDown < 300) {
    void openMenuFromHandle('toggle');
    return;
  }

  if (!isDragging.value && openMenuBlockId.value !== props.blockId) {
    isHandleSelected.value = false;
  }
}

function handleContextMenu(event: MouseEvent): void {
  event.preventDefault();
  event.stopPropagation();
  isHandleSelected.value = true;
  void openMenuFromHandle('open');
}

function handleDragStart(event: DragEvent): void {
  isDragging.value = true;
  beginRootBlockDragVisualLifecycle();
  const started = handleDragStartByRootBlockId(event, {
    editor: props.editor,
    rootBlockId: props.blockId,
  }) === true;
  if (!started) {
    isDragging.value = false;
    endRootBlockDragInteraction({
      releaseHandleSelection: releaseDragHandleSelection,
      restoreHoverOnNextPointerMove: false,
    });
  }
}

function handleDragEnd(event: DragEvent): void {
  try {
    handleDragEndForEditor(event, {
      editor: props.editor,
      fallbackBlockId: props.blockId,
    });
  } finally {
    isDragging.value = false;
    // Host 和旧 BlockChrome 遵守同一交互合同：拖拽结束即释放本次手柄按压态。
    // 菜单若确实打开，仍由 openMenuBlockId 作为独立原因保持选中视觉。
    endRootBlockDragInteraction({
      releaseHandleSelection: releaseDragHandleSelection,
    });
  }
}

function releaseDragHandleSelection(): void {
  isHandleSelected.value = false;
}

function handleVersionClick(): void {
  void toggleBlockHistoryForRootBlockId({
    documentNodeId: currentDocumentNodeId.value,
    blockId: props.blockId,
  }).then((result) => {
    if (!result.ok) {
      console.error('[BlockChromeHostLeftHandle] 切换历史版本视图失败:', result);
    }
  });
}

onBeforeUnmount(() => {
  setRootBlockSelectionVisual(false);
  if (!isDragging.value) return;
  isDragging.value = false;
  cleanupRootBlockDragVisualLifecycle();
});

function resolveRootBlockOuterElement(): HTMLElement | null {
  const outerElement = dragHandleRef.value?.closest('.root-block-outer') ?? null;
  return outerElement instanceof HTMLElement ? outerElement : null;
}

function setRootBlockSelectionVisual(active: boolean): void {
  const outerElement = resolveRootBlockOuterElement();
  if (!outerElement) return;
  // Host 不写 ProseMirror NodeSelection，只恢复旧 BlockChrome 点击柄时的视觉契约。
  outerElement.classList.toggle('is-block-selected', active);
  outerElement.classList.toggle('handle-selected', active);
}
</script>
