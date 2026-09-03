<!--
  RevisionIndicator.vue
  
  修订状态指示器
  显示在块的右上角，展示当前块的修订统计信息
-->

<template>
  <div 
    v-if="hasRevisions"
    class="revision-indicator"
    :class="{ 'is-pending': status === 'pending' }"
    :title="indicatorTitle"
  >
    <span class="indicator-label">{{ editorMessage('editor.revision.indicator.label') }}</span>
    <span v-if="(insertCount ?? 0) > 0" class="indicator-insert">+{{ insertCount ?? 0 }}</span>
    <span v-if="(insertCount ?? 0) > 0 && (deleteCount ?? 0) > 0" class="indicator-separator">/</span>
    <span v-if="(deleteCount ?? 0) > 0" class="indicator-delete">-{{ deleteCount ?? 0 }}</span>
    <span v-if="pendingOnly" class="indicator-pending">{{ editorMessage('editor.revision.indicator.pending') }}</span>
    <span v-if="formattedTime" class="indicator-time">{{ formattedTime }}</span>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useEditorLocalization } from '../../../ui/useEditorLocalization'
import {
  formatRevisionIndicatorTitle,
  formatRevisionTimeLabel,
} from '../functions/revisionPresentation'

const { editorMessage } = useEditorLocalization()

const props = defineProps<{
  /** 修订状态 */
  status: 'pending' | 'applied' | 'discarded'
  /** 插入数量 */
  insertCount?: number
  /** 删除数量 */
  deleteCount?: number
  /** 创建时间 */
  createdAt?: number
  /**
   * canonical-only pending 尚未投影 revisionMark 时没有 +/- 统计，但仍然必须展示块级状态。
   */
  forceVisible?: boolean
  /** 是否展示“待处理”轻量态，而不是 +/- 统计。 */
  pendingOnly?: boolean
}>()

// 是否有修订
const hasRevisions = computed(() => {
  return props.forceVisible === true || (props.insertCount ?? 0) > 0 || (props.deleteCount ?? 0) > 0
})

// 格式化时间
const formattedTime = computed(() => {
  return formatRevisionTimeLabel(props.createdAt, editorMessage)
})

// 指示器提示文字
const indicatorTitle = computed(() => {
  return formatRevisionIndicatorTitle({
    status: props.status,
    insertCount: props.insertCount ?? 0,
    deleteCount: props.deleteCount ?? 0,
    hasDetailedStats: !props.pendingOnly,
  }, editorMessage)
})
</script>
