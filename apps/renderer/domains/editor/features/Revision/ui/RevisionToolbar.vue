<!--
  RevisionToolbar.vue
  
  AI 修订模式的浮动工具栏
  显示在有待处理修订的块旁边，提供：
  - 接受全部修订
  - 拒绝全部修订
  - 修订统计信息（插入/删除数量）
-->

<template>
  <FloatingToolbar
    :show="visible"
    :position="position"
    class="revision-toolbar"
    :class="{
      'is-block-placement': placement === 'block',
      'is-block-top-right-placement': placement === 'block-top-right',
    }"
    @mouseenter="handleMouseEnter"
    @mouseleave="handleMouseLeave"
  >
    <!-- 操作按钮 -->
    <button
      class="toolbar-btn reject-btn"
      @click="handleRejectAll"
      :title="editorMessage('editor.revision.toolbar.rejectAllTitle')"
    >
      <CloseIcon class="btn-icon" />
      <span class="btn-text">{{ editorMessage('editor.revision.action.reject') }}</span>
    </button>

    <button
      class="toolbar-btn accept-btn"
      @click="handleAcceptAll"
      :title="editorMessage('editor.revision.toolbar.acceptAllTitle')"
    >
      <OkIcon class="btn-icon" />
      <span class="btn-text">{{ editorMessage('editor.revision.action.accept') }}</span>
    </button>
  </FloatingToolbar>
</template>

<script setup lang="ts">
import FloatingToolbar from '@/domains/editor/features/floating-toolbar/ui/FloatingToolbar.vue'
import { OkIcon } from '@linnya/renderer-ui/icons';
import { CloseIcon } from '@linnya/renderer-ui/icons';
import { useEditorLocalization } from '../../../ui/useEditorLocalization'

const { editorMessage } = useEditorLocalization()

// Props
withDefaults(defineProps<{
  /** 是否显示 */
  visible: boolean
  /** 块 ID */
  blockId: string
  /** 工具栏位置 */
  position: { top: number; left: number }
  /** 插入数量 */
  insertCount?: number
  /** 删除数量 */
  deleteCount?: number
  /** block：块底；block-top-right：块内右上角；absolute：由 editor 级 overlay 传入绝对坐标。 */
  placement?: 'block' | 'block-top-right' | 'absolute'
}>(), {
  placement: 'block',
})

// Emits
const emit = defineEmits<{
  (e: 'accept-all'): void
  (e: 'reject-all'): void
  (e: 'mouseenter'): void
  (e: 'mouseleave'): void
}>()

// 处理接受全部
function handleAcceptAll() {
  emit('accept-all')
}

// 处理拒绝全部
function handleRejectAll() {
  emit('reject-all')
}

function handleMouseEnter() {
  emit('mouseenter')
}

function handleMouseLeave() {
  emit('mouseleave')
}
</script>
