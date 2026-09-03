<!--
  HistoryOverlay.vue
  
  块级时光机 - 覆盖式预览视图
  
  以半透明覆盖层的形式显示历史版本内容
  适用于快速预览历史版本，无需离开当前编辑区
-->

<template>
  <Transition name="overlay-fade">
    <div class="history-overlay" v-if="isActive">
      <!-- 覆盖层标题 -->
      <div class="overlay-header">
        <div class="header-info">
          <span class="version-badge">
            <HistoryIcon />
            {{ versionBadgeText }}
          </span>
          <span class="version-time">{{ formattedTime }}</span>
        </div>
        <div class="header-actions">
          <button class="overlay-btn restore-btn" @click="handleRestore" :disabled="!canRestore">
            <RestoreIcon />
            {{ editorMessage('editor.blockHistory.overlay.restore') }}
          </button>
          <button class="overlay-btn close-btn" @click="handleClose">
            <CloseIcon />
          </button>
        </div>
      </div>
      
      <!-- 覆盖层内容 -->
      <div class="overlay-content">
        <div 
          v-for="(line, idx) in historyLines" 
          :key="idx"
          class="overlay-line"
        >
          {{ line.text || '\u00A0' }}
        </div>
        
        <!-- 空内容提示 -->
        <div v-if="historyLines.length === 0" class="overlay-empty">
          <span>{{ editorMessage('editor.blockHistory.overlay.empty') }}</span>
        </div>
      </div>
      
      <!-- 底部提示 -->
      <div class="overlay-footer">
        <span class="tip">{{ editorMessage('editor.blockHistory.overlay.closePreviewShortcut') }}</span>
        <span class="origin-type" :class="originTypeClass">
          {{ originTypeLabel }}
        </span>
      </div>
    </div>
  </Transition>
</template>

<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount } from 'vue'
import { useBlockHistoryStore, type BlockVersion } from '../index'
import { extractLinesFromContentJson, type VersionLine } from '../utils/lineExtractor'
import { useEditorLocalization } from '../../../ui/useEditorLocalization'
import {
  formatBlockHistoryFullTime,
  readBlockHistoryOriginLabel,
} from '../functions/blockHistoryPresentation'

// ==================== 图标组件 ====================

const HistoryIcon = {
  template: `
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="12" cy="12" r="10"/>
      <polyline points="12 6 12 12 16 14"/>
    </svg>
  `
}

const RestoreIcon = {
  template: `
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/>
      <path d="M3 3v5h5"/>
    </svg>
  `
}

const CloseIcon = {
  template: `
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <line x1="18" y1="6" x2="6" y2="18"/>
      <line x1="6" y1="6" x2="18" y2="18"/>
    </svg>
  `
}

// ==================== Props ====================

const props = defineProps<{
  /** 块 ID */
  blockId: string
  /** 文档节点 ID */
  documentNodeId?: string
}>()

// ==================== Emits ====================

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'restore', versionId: string): void
}>()

// ==================== Store ====================

const blockHistoryStore = useBlockHistoryStore()
const { currentLocale, editorMessage } = useEditorLocalization()

// ==================== 计算属性 ====================

/** 是否激活 */
const isActive = computed(() => {
  const uiState = blockHistoryStore.getUiState(props.blockId)
  return uiState.mode === 'overlay'
})

/** 选中的版本 ID */
const selectedVersionId = computed(() => {
  return blockHistoryStore.getUiState(props.blockId).selectedVersionId
})

/** 选中的版本 */
const selectedVersion = computed<BlockVersion | null>(() => {
  if (!selectedVersionId.value) return null
  const versions = blockHistoryStore.getVersions(props.blockId)
  return versions.find(v => v.id === selectedVersionId.value) || null
})

const versionBadgeText = computed(() => {
  return editorMessage('editor.blockHistory.overlay.versionBadge', {
    version: selectedVersion.value?.version_number ?? '-',
  })
})

/** 格式化时间 */
const formattedTime = computed(() => {
  if (!selectedVersion.value) return ''
  return formatBlockHistoryFullTime(selectedVersion.value.created_at, currentLocale.value)
})

/** 版本来源类型 */
const originTypeLabel = computed(() => {
  if (!selectedVersion.value) return ''
  return readBlockHistoryOriginLabel(selectedVersion.value.origin_type, editorMessage)
})

/** 来源类型样式类 */
const originTypeClass = computed(() => {
  if (!selectedVersion.value) return ''
  return `origin-${selectedVersion.value.origin_type}`
})

/** 历史版本的行数据 */
const historyLines = computed<VersionLine[]>(() => {
  if (!selectedVersion.value) return []
  try {
    const content = JSON.parse(selectedVersion.value.content_json)
    return extractLinesFromContentJson(content)
  } catch (error) {
    console.error('[HistoryOverlay] 解析历史版本失败:', error)
    return []
  }
})

/** 是否可以恢复 */
const canRestore = computed(() => {
  return !!selectedVersion.value && !!props.documentNodeId
})

// ==================== 方法 ====================

/** 关闭覆盖层 */
function handleClose() {
  blockHistoryStore.exitHistoryMode(props.blockId)
  emit('close')
}

/** 恢复版本（具体恢复逻辑交给上层 useBlockHistoryUi 统一处理） */
async function handleRestore() {
  if (!selectedVersion.value) return
  emit('restore', selectedVersion.value.id)
}

/** 处理键盘事件 */
function handleKeydown(e: KeyboardEvent) {
  if (!isActive.value) return
  
  if (e.key === 'Escape') {
    e.preventDefault()
    handleClose()
  }
}

// ==================== 生命周期 ====================

onMounted(() => {
  document.addEventListener('keydown', handleKeydown)
})

onBeforeUnmount(() => {
  document.removeEventListener('keydown', handleKeydown)
})
</script>
