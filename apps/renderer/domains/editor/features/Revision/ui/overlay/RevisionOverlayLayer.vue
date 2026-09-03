<template>
  <div
    ref="overlayRoot"
    class="revision-overlay-layer"
    :class="{ 'is-enabled': isEnabled }"
  >
    <template v-for="item in items" :key="item.blockId">
      <RevisionToolbar
        v-if="shouldRenderOverlayToolbar && item.showToolbar"
        class="revision-overlay-toolbar"
        placement="absolute"
        :visible="true"
        :block-id="item.blockId"
        :position="toolbarPosition(item)"
        :insert-count="item.insertCount"
        :delete-count="item.deleteCount"
        @accept-all="handleAcceptAll(item.blockId)"
        @reject-all="handleRejectAll(item.blockId)"
        @mouseenter="handleToolbarMouseEnter(item.blockId)"
        @mouseleave="handleToolbarMouseLeave(item.blockId)"
      />
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, inject, ref } from 'vue'
import type { Editor } from '@tiptap/core'
import { shouldUseVirtualRootBlockRenderingForOwner } from '../../../../ui/services/editorFeatureFlags'
import RevisionToolbar from '../RevisionToolbar.vue'
import { useRevisionOverlayLayer } from './useRevisionOverlayLayer'
import type { RevisionOverlayItem } from './revisionOverlayTypes'
import { useShellBlockRevisionHeader } from '../shell/useShellBlockRevisionHeader'
import { RENDER_VIRTUALIZATION_ENGINE_KEY } from '../../../RenderVirtualization'

const props = defineProps<{
  editor: Editor | null
}>()

const overlayRoot = ref<HTMLElement | null>(null)
const editorRef = computed(() => props.editor)
const shouldRenderOverlayToolbar = computed(() => !shouldUseVirtualRootBlockRenderingForOwner(props.editor))
const renderVirtualizationEngine = inject(RENDER_VIRTUALIZATION_ENGINE_KEY, null)
if (!renderVirtualizationEngine) {
  throw new Error('RevisionOverlayLayer 必须在 EditorContext 内使用，并复用统一的渲染虚拟化引擎')
}

useShellBlockRevisionHeader({
  editor: editorRef,
  renderVirtualizationEngine,
})

const {
  items,
  isEnabled,
  handleAcceptAll,
  handleRejectAll,
  handleToolbarMouseEnter,
  handleToolbarMouseLeave,
} = useRevisionOverlayLayer({
  editor: editorRef,
  overlayRoot,
})

function toolbarPosition(item: RevisionOverlayItem): { top: number; left: number } {
  return {
    // 中文说明：将工具栏放在块的右上角（内容区域顶部），而不是块的最底部。
    // 避免遇到大块（如长表格、长代码块）时，工具栏跑出屏幕外导致无法点击。
    top: Math.max(0, item.top + 4),
    left: Math.max(0, item.left + item.width - 136),
  }
}
</script>
