<!--
  RevisionMarkPopup.vue
  
  修订标记的微型弹出菜单
  当用户点击带有 revisionMark 的文字时显示
  提供单条修订的接受/拒绝操作
-->

<template>
  <Teleport to="body">
    <div
      v-if="visible"
      ref="popupRef"
      class="revision-mark-popup"
      :style="popupStyle"
      @mousedown.prevent
      @mouseenter="handleMouseEnter"
      @mouseleave="handleMouseLeave"
    >
      <button
        class="popup-btn accept"
        @click="handleAccept"
        :title="acceptTitle"
      >
        <CheckIcon class="popup-icon" />
      </button>
      <button
        class="popup-btn reject"
        @click="handleReject"
        :title="rejectTitle"
      >
        <CloseIcon class="popup-icon" />
      </button>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted, watch, nextTick } from 'vue'
import { useEditorLocalization } from '../../../ui/useEditorLocalization'
import {
  resolveRevisionMarkAcceptTitle,
  resolveRevisionMarkRejectTitle,
} from '../functions/revisionPresentation'

const { editorMessage } = useEditorLocalization()

// 简单的图标组件（内联 SVG）
const CheckIcon = {
  template: `
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
      <polyline points="20 6 9 17 4 12"></polyline>
    </svg>
  `
}

const CloseIcon = {
  template: `
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
      <line x1="18" y1="6" x2="6" y2="18"></line>
      <line x1="6" y1="6" x2="18" y2="18"></line>
    </svg>
  `
}

// Props
const props = defineProps<{
  /** 是否显示 */
  visible: boolean
  /** 变更类型 */
  changeType: 'insert' | 'delete'
  /** 弹出位置 */
  position: { top: number; left: number }
  /** 文本范围（用于传递给父组件） */
  range: { from: number; to: number }
}>()

// Emits
const emit = defineEmits<{
  (e: 'accept', range: { from: number; to: number }): void
  (e: 'reject', range: { from: number; to: number }): void
  (e: 'close'): void
  (e: 'mouseenter'): void
  (e: 'mouseleave'): void
}>()

const popupRef = ref<HTMLElement | null>(null)

// 根据变更类型生成提示文字
const acceptTitle = computed(() => {
  return resolveRevisionMarkAcceptTitle(props.changeType, editorMessage)
})

const rejectTitle = computed(() => {
  return resolveRevisionMarkRejectTitle(props.changeType, editorMessage)
})

// 计算弹出位置（考虑边界）
const popupStyle = computed(() => {
  const POPUP_WIDTH = 64
  const POPUP_HEIGHT = 28
  const MARGIN = 8
  
  let left = props.position.left
  let top = props.position.top - POPUP_HEIGHT - 8 // 默认显示在上方
  
  // 检查右边界
  if (left + POPUP_WIDTH > window.innerWidth - MARGIN) {
    left = window.innerWidth - MARGIN - POPUP_WIDTH
  }
  
  // 检查左边界
  if (left < MARGIN) {
    left = MARGIN
  }
  
  // 检查上边界，如果上方空间不足则显示在下方
  if (top < MARGIN) {
    top = props.position.top + 24
  }
  
  return {
    top: `${top}px`,
    left: `${left}px`,
  }
})

// 处理接受
function handleAccept() {
  emit('accept', props.range)
  emit('close')
}

// 处理拒绝
function handleReject() {
  emit('reject', props.range)
  emit('close')
}

function handleMouseEnter() {
  emit('mouseenter')
}

function handleMouseLeave() {
  emit('mouseleave')
}

// 点击外部关闭
function handleClickOutside(event: MouseEvent) {
  if (popupRef.value && !popupRef.value.contains(event.target as Node)) {
    emit('close')
  }
}

// 按 Escape 关闭
function handleKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    emit('close')
  }
}

onMounted(() => {
  document.addEventListener('mousedown', handleClickOutside)
  document.addEventListener('keydown', handleKeydown)
})

onUnmounted(() => {
  document.removeEventListener('mousedown', handleClickOutside)
  document.removeEventListener('keydown', handleKeydown)
})
</script>
