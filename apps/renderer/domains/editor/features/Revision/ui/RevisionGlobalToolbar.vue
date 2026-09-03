<!--
  RevisionGlobalToolbar.vue
  
  文档级修订工具栏：
  - 当整篇文档存在多个待处理修订时，悬浮显示在编辑区域底部
  - 提供「拒绝全部」和「接受全部」操作
  - 展示当前待处理的块数量与插入 / 删除统计（聚合自各个块）
-->

<template>
  <transition name="revision-global-toolbar-fade">
    <div
      v-if="visible"
      class="revision-global-toolbar"
    >
      <div class="revision-global-toolbar__inner">
        <!-- 文本说明与统计 -->
        <div class="revision-global-toolbar__summary">
          <span class="summary-title">{{ editorMessage('editor.revision.global.pendingTitle') }}</span>
          <span class="summary-counts">
            <span v-if="pendingCount > 0" class="summary-blocks">
              {{ formatRevisionBlockCount(pendingCount, editorMessage) }}
            </span>
            <span v-if="insertCount > 0" class="summary-insert">
              +{{ insertCount }}
            </span>
            <span
              v-if="insertCount > 0 && deleteCount > 0"
              class="summary-separator"
            >
              /
            </span>
            <span v-if="deleteCount > 0" class="summary-delete">
              -{{ deleteCount }}
            </span>
          </span>
          <span
            v-if="projectionDeferred"
            class="summary-warning"
          >
            {{ editorMessage('editor.revision.global.projectionDeferred') }}
          </span>
        </div>

        <!-- 操作按钮 -->
        <div class="revision-global-toolbar__actions">
          <button
            class="toolbar-btn reject-btn"
            type="button"
            @click="handleRejectAll"
          >
            {{ editorMessage('editor.revision.action.rejectAll') }}
          </button>
          <button
            class="toolbar-btn accept-btn"
            type="button"
            @click="handleAcceptAll"
          >
            {{ editorMessage('editor.revision.action.acceptAll') }}
          </button>
        </div>
      </div>
    </div>
  </transition>
</template>

<script setup lang="ts">
import { useEditorLocalization } from '../../../ui/useEditorLocalization'
import { formatRevisionBlockCount } from '../functions/revisionPresentation'

const { editorMessage } = useEditorLocalization()

/**
 * 文档级修订工具栏 Props
 */
defineProps<{
  /** 是否显示工具栏 */
  visible: boolean
  /** 存在待处理修订的块数量（来自 canonicalPendingBlockCount） */
  pendingCount: number
  /** 聚合后的插入数量 */
  insertCount: number
  /** 聚合后的删除数量 */
  deleteCount: number
  /** 大文档首开暂缓了行内 revisionMark 投影 */
  projectionDeferred?: boolean
}>()

/**
 * 事件定义：
 * - accept-all: 文档级接受全部修订
 * - reject-all: 文档级拒绝全部修订
 */
const emit = defineEmits<{
  (e: 'accept-all'): void
  (e: 'reject-all'): void
}>()

// 处理接受全部
function handleAcceptAll() {
  emit('accept-all')
}

// 处理拒绝全部
function handleRejectAll() {
  emit('reject-all')
}
</script>
