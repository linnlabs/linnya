<template>
  <NodeViewWrapper 
    class="transcript-segment-wrapper"
    :class="{ active: isActive, 'has-translation': showTranslation }"
    :style="wrapperGridStyle"
    as="div"
  >
    <!-- 时间戳列 -->
    <div class="timestamp-column">
      <span 
        class="timestamp-text" 
        @click="handleTimestampClick"
      >
        {{ node.attrs.timestamp }}
      </span>
    </div>

    <!-- 内容列：由 NodeViewContent 渲染子节点（原文/翻译） -->
    <div class="content-columns">
      <NodeViewContent class="content-dom" :style="contentGridStyle" />
    </div>

    <!-- 分割线（覆盖在内容列上方，绝对定位） -->
    <div 
      v-if="showTranslation"
      class="divider-overlay"
      :class="{ 'is-dragging': isDragging, 'is-hovering': isDividerHoveringGlobal }"
      :style="dividerStyle"
      @mousedown="handleDividerMouseDown"
      @mouseenter="isDividerHoveringGlobal = true"
      @mouseleave="isDividerHoveringGlobal = false"
    >
      <div class="divider-handle"></div>
    </div>
  </NodeViewWrapper>
</template>

<script setup>
import { computed, ref, inject } from 'vue'
import { NodeViewWrapper, NodeViewContent } from '@tiptap/vue-3'

const props = defineProps({
  editor: { type: Object, required: true },
  node: { type: Object, required: true },
  decorations: { type: Object, required: true },
  selected: { type: Boolean, required: true },
  extension: { type: Object, required: true },
  getPos: { type: Function, required: true },
  updateAttributes: { type: Function, required: true },
  deleteNode: { type: Function, required: true },
})


const showTranslationGlobal = inject('showTranslation', ref(false))
const isDividerHoveringGlobal = inject('isDividerHovering', ref(false))
const textColumnWidthGlobal = inject('textColumnWidth', ref(50))
const onSeekToTime = inject('onSeekToTime', null)

const isActive = ref(false)
const isDragging = ref(false)

// 是否有翻译子节点
const hasTranslationNode = computed(() => {
  let hasTranslation = false
  props.node.content.forEach((child) => {
    if (child.type.name === 'transcriptTranslation') {
      hasTranslation = true
    }
  })
  return hasTranslation
})

// 是否显示翻译列（全局开关 + 实际存在）
const showTranslation = computed(() => showTranslationGlobal.value && hasTranslationNode.value)

// 外层 Wrapper 的两列布局：时间戳 + 内容
const wrapperGridStyle = computed(() => ({
  gridTemplateColumns: '78px 1fr'
}))

// 内部内容两列布局：原文 + 翻译（可选）
const contentGridStyle = computed(() => {
  if (!showTranslation.value) {
    return { display: 'block' }
  }
  const textWidth = textColumnWidthGlobal.value
  const translationWidth = 100 - textWidth
  return {
    display: 'grid',
    gridTemplateColumns: `${textWidth}% ${translationWidth}%`
  }
})

// 分割线位置（绝对定位在 Wrapper 上，基于原文列比例）
const dividerStyle = computed(() => {
  if (!showTranslation.value) return { display: 'none' }
  const percent = textColumnWidthGlobal.value / 100
  // 距离左侧：时间戳列 78px + 内容列宽度 * percent
  return {
    left: `calc(78px + (100% - 78px) * ${percent})`
  }
})

function handleTimestampClick() {
  const startTime = props.node.attrs.startTime
  if (onSeekToTime) onSeekToTime(startTime)
}

// 拖动分割线调整列宽
const dragStartX = ref(0)
const dragStartPercent = ref(50)
const dragContainerWidth = ref(0)

function handleDividerMouseDown(event) {
  event.preventDefault()
  isDragging.value = true
  dragStartX.value = event.clientX
  dragStartPercent.value = textColumnWidthGlobal.value

  const wrapper = event.currentTarget?.closest('.transcript-segment-wrapper')
  if (wrapper) {
    const rect = wrapper.getBoundingClientRect()
    dragContainerWidth.value = rect.width - 78 // 内容区域宽度（wrapper总宽 - 时间戳列）
  }

  document.body.style.cursor = 'col-resize'
  document.body.style.userSelect = 'none'

  document.addEventListener('mousemove', handleMouseMove)
  document.addEventListener('mouseup', handleMouseUp)
}

function handleMouseMove(event) {
  if (!isDragging.value || dragContainerWidth.value <= 0) return
  const deltaX = event.clientX - dragStartX.value
  const deltaPercent = (deltaX / dragContainerWidth.value) * 100
  let newPercent = dragStartPercent.value + deltaPercent
  newPercent = Math.max(30, Math.min(70, newPercent))
  textColumnWidthGlobal.value = Math.round(newPercent * 10) / 10
}

function handleMouseUp() {
  if (!isDragging.value) return
  isDragging.value = false
  document.body.style.cursor = ''
  document.body.style.userSelect = ''
  document.removeEventListener('mousemove', handleMouseMove)
  document.removeEventListener('mouseup', handleMouseUp)
}
</script>

