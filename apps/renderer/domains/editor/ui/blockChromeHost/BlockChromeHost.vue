<template>
  <BlockChromeHostSurfaceTeleport
    v-for="target in surfaceTargets"
    :key="target.key"
    :to="target.mountElement"
  >
    <BlockChromeHostLeftHandle
      v-if="target.kind === 'left-handle'"
      :key="target.key"
      :editor="props.editor"
      :block-id="target.blockId"
    />
    <BlockChromeHostAnnotationHandle
      v-else-if="target.kind === 'annotation-handle'"
      :key="target.key"
      :block-id="target.blockId"
      :root-block-outer-element="target.rootBlockOuterElement"
    />
    <BlockChromeHostRevisionIndicator
      v-else-if="target.kind === 'revision-indicator'"
      :key="target.key"
      :editor="props.editor"
      :block-id="target.blockId"
    />
    <BlockChromeHostRevisionToolbar
      v-else-if="target.kind === 'revision-toolbar'"
      :key="target.key"
      :editor="props.editor"
      :block-id="target.blockId"
    />
    <BlockChromeHostHistoryPanel
      v-else-if="target.kind === 'history-panel'"
      :key="target.key"
      :editor="props.editor"
      :block-id="target.blockId"
      :root-block-element="target.rootBlockElement"
      :get-root-block-pos="target.getRootBlockPos"
    />
  </BlockChromeHostSurfaceTeleport>

  <BlockChromeHostAnnotationPanel />
</template>

<script setup lang="ts">
/**
 * BlockChromeHost.vue
 *
 * 阶段 3 块级 chrome 中央宿主。
 *
 * 中文说明：
 * - 只在 rootBlock 渲染虚拟化运行态下接管大文档的轻量块级 UI；
 * - 小文档 / 非虚拟化路径仍由旧 BlockView + BlockChrome 承担完整交互；
 * - Host 只消费各 feature 暴露的窄 read-model / orchestration，不直接读取业务 store 内部结构。
 */

import { computed, inject, onBeforeUnmount, watch } from 'vue';
import type { Editor } from '@tiptap/vue-3';
import { acquireFocusedRootBlockSelection } from '../composables/focusedRootBlockSelection';
import {
  RENDER_VIRTUALIZATION_ENGINE_KEY,
} from '../../features/RenderVirtualization';
import { useActiveChromeBlocks } from './useActiveChromeBlocks';
import { recordBlockChromeHostShadowSnapshot } from './debug/blockChromeHostRuntimePerf';
import BlockChromeHostSurfaceTeleport from './BlockChromeHostSurfaceTeleport.vue';
import BlockChromeHostLeftHandle from './BlockChromeHostLeftHandle.vue';
import BlockChromeHostAnnotationHandle from './BlockChromeHostAnnotationHandle.vue';
import BlockChromeHostAnnotationPanel from './BlockChromeHostAnnotationPanel.vue';
import BlockChromeHostRevisionIndicator from './BlockChromeHostRevisionIndicator.vue';
import BlockChromeHostRevisionToolbar from './BlockChromeHostRevisionToolbar.vue';
import BlockChromeHostHistoryPanel from './BlockChromeHostHistoryPanel.vue';
import { useBlockActionMenuChromeSource } from './sources/useBlockActionMenuChromeSource';
import { useRootBlockDraggingChromeSource } from './sources/useRootBlockDraggingChromeSource';
import { useBlockHistoryChromeSource } from './sources/useBlockHistoryChromeSource';
import { useRenderVirtualizationKeepAliveChromeSource } from './sources/useRenderVirtualizationKeepAliveChromeSource';
import { useAnnotationChromeSource } from './sources/useAnnotationChromeSource';
import { useRevisionToolbarChromeSource } from './sources/useRevisionToolbarChromeSource';
import { useRootBlockHoverChromeSource } from './sources/useRootBlockHoverChromeSource';
import { useAnnotationBlockHoverHighlight } from '../../features/Annotation/ui/useAnnotationBlockHoverHighlight';
import { useBlockChromeHostSurfaceTargets } from './useBlockChromeHostSurfaceTargets';

const props = defineProps<{
  editor: Editor;
}>();

const renderVirtualizationEngine = inject(RENDER_VIRTUALIZATION_ENGINE_KEY, null);

const selectionHandle = acquireFocusedRootBlockSelection(props.editor);
onBeforeUnmount(() => {
  selectionHandle.release();
});

const hoveredBlockId = useRootBlockHoverChromeSource(props.editor);

useAnnotationBlockHoverHighlight({
  hoveredBlockId,
});

const { activeChromeBlocks } = useActiveChromeBlocks({
  hoveredBlockId,
  focusedBlockId: computed(() => selectionHandle.focusedRootBlockId.value),
  selectedBlockId: computed(() => selectionHandle.selectedRootBlockId.value),
  menuOpenBlockId: useBlockActionMenuChromeSource(),
  draggingBlockId: useRootBlockDraggingChromeSource(),
  annotationActiveBlockIds: useAnnotationChromeSource(),
  revisionToolbarBlockIds: useRevisionToolbarChromeSource(),
  historyModeBlockIds: useBlockHistoryChromeSource(),
  keepAlivePinnedBlockIds: useRenderVirtualizationKeepAliveChromeSource(
    props.editor,
    renderVirtualizationEngine
  ),
});

const {
  surfaceTargets,
  targetReadyBlockIds,
  renderPlans,
} = useBlockChromeHostSurfaceTargets({
  editor: props.editor,
  activeChromeBlocks,
  renderVirtualizationEngine,
});

watch(
  () => ({
    activeBlocks: activeChromeBlocks.value,
    readyIds: targetReadyBlockIds.value,
    plans: renderPlans.value,
  }),
  ({ activeBlocks, readyIds, plans }) => {
    recordBlockChromeHostShadowSnapshot({
      activeBlocks,
      targetReadyBlockIds: readyIds,
      renderPlans: plans,
    });
  },
  { immediate: true }
);
</script>
