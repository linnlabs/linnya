<template>
  <DraggablePanel
    :visible="store.visible"
    width="560px"
    height="auto"
    container-selector=".mindmap-container"
    initial-position="top-right"
    :position-offset="{ top: 16, right: 24 }"
    data-mm-interactive="true"
    @close="handleClose"
  >
    <template #title>插入引用</template>
    <div class="reference-insert-panel" @keydown.stop>
      <!-- Tab 切换（复用 Editor 同款交互） -->
      <div class="reference-insert-tabs">
        <button
          class="reference-insert-tab"
          :class="{ active: store.activeTab === 'kb' }"
          @click="store.switchTab('kb')"
        >
          知识库
        </button>
        <button
          class="reference-insert-tab"
          :class="{ active: store.activeTab === 'web' }"
          @click="store.switchTab('web')"
        >
          网页 / 手动
        </button>
      </div>

      <div class="reference-insert-tab-content">
        <ReferenceKbTab
          v-show="store.activeTab === 'kb'"
          @insert="handleInsertKb"
        />
        <ReferenceWebManualTab
          v-show="store.activeTab === 'web'"
          @insert="handleInsertWeb"
        />
      </div>
    </div>
  </DraggablePanel>
</template>

<script setup lang="ts">
/**
 * ReferenceInsertPanel.vue
 *
 * 中文说明：
 * - MindMap 的“插入引用”面板（复用 Editor 的 CitationPanel 同款 UX）
 * - 区别在于：Editor 是把引用插入到富文本里；MindMap 是把引用写入 mindmap_evidence 表并挂到节点上
 */

import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { DraggablePanel } from '@linnya/renderer-ui'
import ReferenceKbTab from './components/ReferenceKbTab.vue'
import ReferenceWebManualTab from './components/ReferenceWebManualTab.vue'
import {
  getCurrentWorkspaceProjectId,
  listProjectKnowledgeBaseIds,
} from '@plugin/renderer/workspaceRuntime'
import { generateUUID } from '../../../shared/utils/common'
import type { MindMapInstance } from '../../../domain/types'
import { useMindMapEvidenceStore } from '../domain/store/evidenceStore'
import { useMindMapReferenceInsertStore } from '../domain/store/referenceInsertStore'
import {
  listKnowledgeBasesForPlugin,
  type CitationKbSearchItem,
  type WebManualFormInput,
} from '@plugin/renderer/referenceRuntime'

interface Props {
  mind: MindMapInstance
}

const props = defineProps<Props>()

const store = useMindMapReferenceInsertStore()
const evidenceStore = useMindMapEvidenceStore()

/**
 * 当前要插入引用的目标节点
 * 中文说明：由右键菜单/节点内按钮触发打开面板时写入
 */
const targetNodeId = ref<string>('')
const targetNodeTopic = ref<string>('')

const canInsert = computed(() => targetNodeId.value.trim().length > 0)

async function loadProjectKbs() {
  const projectId = getCurrentWorkspaceProjectId()
  if (!projectId) {
    console.warn('[ReferenceInsertPanel] 无法获取当前项目 ID，KB 列表为空')
    store.setAvailableKbs([])
    return
  }

  try {
    const kbIdsResult = await listProjectKnowledgeBaseIds({ projectId })
    if (kbIdsResult.success !== true) {
      const errorMessage =
        'error' in kbIdsResult && typeof kbIdsResult.error === 'string'
          ? kbIdsResult.error
          : '获取项目关联 KB 失败（未知错误）'
      console.error('[ReferenceInsertPanel] 获取项目关联 KB 失败:', errorMessage)
      store.setAvailableKbs([])
      return
    }

    const kbIds = kbIdsResult.data ?? []
    if (kbIds.length === 0) {
      store.setAvailableKbs([])
      return
    }

    const allKbs = await listKnowledgeBasesForPlugin()

    const projectKbs = allKbs
      .filter((kb) => kbIds.includes(kb.id))
      .map((kb) => ({ id: kb.id, name: kb.name }))

    store.setAvailableKbs(projectKbs)
  } catch (error) {
    console.error('[ReferenceInsertPanel] 加载项目 KB 列表失败:', error)
    store.setAvailableKbs([])
  }
}

function openForNode(payload: { nodeId: string; nodeTopic?: string }) {
  targetNodeId.value = payload.nodeId
  targetNodeTopic.value = payload.nodeTopic ?? ''
  store.open('kb')
}

function handleClose() {
  store.close()
  targetNodeId.value = ''
  targetNodeTopic.value = ''
}

async function handleInsertKb(items: CitationKbSearchItem[]) {
  if (!canInsert.value) {
    console.error('[ReferenceInsertPanel] 缺少 targetNodeId，无法插入引用')
    return
  }
  if (items.length === 0) return

  // 中文说明：支持多选插入（逐条写入引用表）
  for (const item of items) {
    const sourceId = item.blockId ? `${item.docId}#${item.blockId}` : item.docId
    const noteParts: string[] = []
    if (item.kbName) noteParts.push(`知识库：${item.kbName}`)
    if (typeof item.page === 'number') noteParts.push(`第 ${item.page} 页`)
    const note = noteParts.length > 0 ? noteParts.join('，') : undefined

    await evidenceStore.addEvidence({
      mindmapNodeId: targetNodeId.value,
      sourceType: 'knowledge_base',
      sourceId,
      title: item.docTitle || undefined,
      snippet: item.snippet || undefined,
      note,
    })
  }

  // 插入成功后：展开该节点引用区并刷新列表（根本性逻辑：展开状态在 store 内管理）
  evidenceStore.setNodeExpanded(targetNodeId.value, true)
  await evidenceStore.loadEvidences(targetNodeId.value)
  props.mind.requestReflow('addons:content')
  // 插入成功后关闭面板
  handleClose()
}

async function handleInsertWeb(form: WebManualFormInput) {
  if (!canInsert.value) {
    console.error('[ReferenceInsertPanel] 缺少 targetNodeId，无法插入引用')
    return
  }

  const sourceType = form.isManual ? 'manual' : 'web'
  const sourceId = form.isManual ? generateUUID() : form.url.trim()
  const authors = form.authors.trim()
    ? form.authors.split(',').map((a: string) => a.trim()).filter(Boolean)
    : undefined

  await evidenceStore.addEvidence({
    mindmapNodeId: targetNodeId.value,
    sourceType,
    sourceId,
    title: form.title.trim() || undefined,
    snippet: form.snippet.trim() || undefined,
    url: form.isManual ? undefined : (form.url.trim() || undefined),
    authors: authors && authors.length > 0 ? authors : undefined,
    date: form.date.trim() || undefined,
    containerTitle: form.containerTitle.trim() || undefined,
  })

  // 插入成功后：展开该节点引用区并刷新列表（根本性逻辑：展开状态在 store 内管理）
  evidenceStore.setNodeExpanded(targetNodeId.value, true)
  await evidenceStore.loadEvidences(targetNodeId.value)
  props.mind.requestReflow('addons:content')
  handleClose()
}

const handleOpenByBus = (payload: { nodeId: string; nodeTopic?: string }) => {
  openForNode(payload)
}

function handleKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape' && store.visible) {
    handleClose()
  }
}

// 面板打开时加载 KB 列表；关闭时重置本地 store 的局部状态
watch(
  () => store.visible,
  async (visible) => {
    if (visible) {
      await loadProjectKbs()
      if (targetNodeTopic.value) {
        console.log('[ReferenceInsertPanel] open for node', { nodeId: targetNodeId.value, topic: targetNodeTopic.value })
      }
    } else {
      store.reset()
    }
  }
)

onMounted(() => {
  // 中文说明：监听新事件名（ui:*），旧事件名仍会通过 bus 桥接双发
  props.mind.bus.addListener('ui:openReferenceInsertPanel', handleOpenByBus)
  document.addEventListener('keydown', handleKeydown)
})

onUnmounted(() => {
  props.mind.bus.removeListener('ui:openReferenceInsertPanel', handleOpenByBus)
  document.removeEventListener('keydown', handleKeydown)
})
</script>
