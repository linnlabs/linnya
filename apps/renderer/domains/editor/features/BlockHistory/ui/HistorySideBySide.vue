<!--
  HistorySideBySide.vue
  
  块级时光机 - 左右分栏对比视图
  
  左侧显示当前版本，右侧显示选中的历史版本
  支持高亮差异、滚动同步
-->

<template>
  <!-- 历史 side-by-side 右侧面板：仅负责展示选中历史版本的文本内容，不负责 Header / Diff -->
  <div
    v-if="isActive"
    class="history-side-by-side-panel"
    contenteditable="false"
  >
    <EditorContent
      v-if="historyEditor"
      :editor="historyEditor"
      class="history-editor-content"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, watch } from 'vue'
import { useBlockHistoryStore } from '../index'
import { EditorContent, useEditor } from '@tiptap/vue-3'
import { createHistoryEditorOptions } from '../utils/createHistoryEditor'
import type { BlockVersion } from '../../../../../shared/ipc/blockHistoryGateway'

// （历史右侧仅负责内容展示，不再在本组件内渲染关闭/恢复图标，相关 UI 由上层容器负责）

// ==================== Props ====================

const props = defineProps<{
  /** 块 ID */
  blockId: string
  /** 当前块的内容（JSON 字符串或对象） */
  currentContent: string | object
  /** 文档节点 ID（用于恢复操作） */
  documentNodeId?: string
}>()

// ==================== Emits ====================

const emit = defineEmits<{
  (e: 'exit'): void
  (e: 'restore', versionId: string): void
}>()

// ==================== Store ====================

const blockHistoryStore = useBlockHistoryStore()

// ==================== Editor ====================

/**
 * 右侧历史版本专用的只读 Editor
 *
 * 使用 useEditor：
 * - 由 Vue 负责创建 / 销毁生命周期
 * - 返回 shallowRef<Editor | null>，类型与 EditorContent 的 props 完整对齐
 */
const historyEditor = useEditor(createHistoryEditorOptions())

// ==================== 计算属性 ====================

/** 是否激活（处于 side-by-side 模式） */
const isActive = computed(() => {
  const uiState = blockHistoryStore.getUiState(props.blockId)
  return uiState.mode === 'side-by-side'
})

/** 选中的历史版本 ID */
const selectedVersionId = computed(() => {
  return blockHistoryStore.getUiState(props.blockId).selectedVersionId
})

/** 选中的历史版本 */
const selectedVersion = computed<BlockVersion | null>(() => {
  if (!selectedVersionId.value) return null
  const versions = blockHistoryStore.getVersions(props.blockId)
  return versions.find(v => v.id === selectedVersionId.value) || null
})

/**
 * 监听「选中版本」和「historyEditor 实例」的变化，更新右侧只读 Editor 内容
 *
 * 注意：
 * - useEditor 返回的 historyEditor 在组件挂载前为 null
 * - 选中版本 ID 往往会在打开历史模式之前就写入 Store
 * - 如果只 watch(selectedVersion) 且 immediate: true，那么初次触发时 editor 可能还没创建，
 *   之后 selectedVersion 也不会再变化，导致内容永远不渲染。
 *
 * 这里通过同时监听 [selectedVersion, historyEditor]，确保两者任一就绪时都会尝试同步内容。
 */
watch([selectedVersion, historyEditor], ([version, editor]) => {
  if (!editor || !version) return

  try {
    const rawContent = JSON.parse(version.content_json)

    // 构造完整的文档结构：doc -> rootBlock -> ...
    // 注意：version.content_json 存储的是 rootBlock 这一层的 JSON
    const docContent = {
      type: 'doc',
      content: [rawContent],
    }

    editor.commands.setContent(docContent, { emitUpdate: false })
  } catch (error) {
    console.error('[HistorySideBySide] 解析/设置历史内容失败:', error)
    // 设置为空或错误提示
    if (editor) {
    editor.commands.setContent(null, { emitUpdate: false })
    }
  }
}, { immediate: true })

// ==================== 方法 ====================

/** 退出对比模式 */
function handleExit() {
  blockHistoryStore.exitHistoryMode(props.blockId)
  emit('exit')
}

</script>
