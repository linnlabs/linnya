<template>
  <DraggablePanel
    :visible="store.visible"
    width="560px"
    height="auto"
    container-selector=".editor-shell"
    initial-position="top-right"
    :position-offset="{ top: 16, right: 24 }"
    @close="handleClose"
  >
    <template #title>{{ editorMessage('editor.citation.panel.title') }}</template>
    <div class="citation-panel" @keydown.stop>
      <!-- Tab 切换 -->
      <div class="citation-tabs">
        <button
          class="citation-tab"
          :class="{ active: store.activeTab === 'kb' }"
          @click="store.switchTab('kb')"
        >
          {{ editorMessage('editor.citation.panel.tab.knowledgeBase') }}
        </button>
        <button
          class="citation-tab"
          :class="{ active: store.activeTab === 'web' }"
          @click="store.switchTab('web')"
        >
          {{ editorMessage('editor.citation.panel.tab.webManual') }}
        </button>
      </div>

      <!-- Tab 内容 -->
      <div class="citation-tab-content">
        <CitationKbTab v-show="store.activeTab === 'kb'" @insert="handleInsertKb" />
        <CitationWebManualTab v-show="store.activeTab === 'web'" @insert="handleInsertWeb" />
      </div>
    </div>
  </DraggablePanel>
</template>

<script setup lang="ts">
/**
 * @file citation/ui/CitationPanel.vue
 * @description Citation 主面板组件（Phase 2）
 *
 * 职责：
 * - 提供 Tab 切换（KB / Web&Manual）
 * - 协调子组件与 store 的交互
 * - 处理引用插入动作
 */

import { watch, onMounted, onUnmounted, computed } from 'vue'
import { DraggablePanel } from '@linnya/renderer-ui'
import { useCitationPanelStore } from '../store/useCitationPanelStore'
import { useUIStore } from '@/shared/stores/ui'
import { useWorkspaceScopeStore } from '@/shared/stores/workspaceScopeStore'
import { projectKbLinksGateway } from '@/shared/ipc/projectKbLinksGateway'
import { knowledgeBaseService } from '@/domains/knowledgebase/services/knowledgeBaseService'
import { convertKbResultToCitationAttrs } from '../adapters/knowledgeBaseCitationAdapter'
import { convertWebManualFormToCitationAttrs } from '../adapters/webCitationAdapter'
import type { CitationKbSearchItem } from '../services/citationKbSearchService'
import type { WebManualFormInput } from '../adapters/webCitationAdapter'
import type { CitationNodeAttrs } from '../types'
import CitationKbTab from './components/CitationKbTab.vue'
import CitationWebManualTab from './components/CitationWebManualTab.vue'
import { useEditorLocalization } from '../../../ui/useEditorLocalization'
import { resolveCurrentEditorMessage } from '../../../functions/resolveCurrentEditorMessage'

const store = useCitationPanelStore()
const uiStore = useUIStore()
const workspaceScopeStore = useWorkspaceScopeStore()
const { editorMessage } = useEditorLocalization()

const editor = computed(() => uiStore.getEditor())

// ============ 初始化：加载当前项目关联的 KB 列表 ============

async function loadProjectKbs() {
  const projectId = workspaceScopeStore.currentProjectId
  if (!projectId) {
    console.warn('[CitationPanel] 无法获取当前项目 ID，KB 列表为空')
    store.setAvailableKbs([])
    return
  }

  try {
    // 1. 获取项目关联的 KB ID 列表
    const kbIdsResult = await projectKbLinksGateway.listKnowledgeBaseIdsForProject({
      projectId,
    })

    if (kbIdsResult.success !== true) {
      // 中文说明：OperationResult 在 success=true 的分支下不一定存在 error 字段，需要先收窄
      const errorMessage =
        'error' in kbIdsResult && typeof kbIdsResult.error === 'string'
          ? kbIdsResult.error
          : resolveCurrentEditorMessage('editor.citation.fallback.projectKbLoadFailed')
      console.error('[CitationPanel] 获取项目关联 KB 失败:', errorMessage)
      store.setAvailableKbs([])
      return
    }

    const kbIds = kbIdsResult.data ?? []

    if (kbIds.length === 0) {
      store.setAvailableKbs([])
      return
    }

    // 2. 获取所有 KB 的详情（名称）
    const allKbsResponse = await knowledgeBaseService.getAllKnowledgeBases()
    const allKbs = allKbsResponse.knowledge_bases || []

    // 3. 过滤出当前项目关联的 KB
    const projectKbs = allKbs
      .filter((kb: { id: string; name: string }) => kbIds.includes(kb.id))
      .map((kb: { id: string; name: string }) => ({
        id: kb.id,
        name: kb.name,
      }))

    store.setAvailableKbs(projectKbs)
  } catch (error) {
    console.error('[CitationPanel] 加载项目 KB 列表失败:', error)
    store.setAvailableKbs([])
  }
}

// 面板打开时加载 KB 列表
watch(
  () => store.visible,
  async visible => {
    if (visible) {
      await loadProjectKbs()
    } else {
      // 面板关闭时重置状态
      store.reset()
    }
  }
)

// ============ 插入引用处理 ============

/**
 * 插入结构化 CitationNode。
 *
 * 引用快照只存在于节点 attrs；`[1]` 是 NodeView 的派生显示，`[@ref]` 只在 Markdown
 * 导入/导出边界出现。这样编辑器正文不再保存会被重写的展示文本。
 */
function insertCitationNode(attrs: Omit<CitationNodeAttrs, 'citationId'>) {
  const editorInstance = editor.value
  if (!editorInstance) {
    console.error('[CitationPanel] 无法获取 editor 实例')
    return false
  }

  try {
    // citationId 是引用实例身份；显示编号不参与身份计算。
    const citationId = crypto.randomUUID()
    const fullAttrs: CitationNodeAttrs = {
      ...attrs,
      citationId,
    }

    editorInstance.chain().focus().insertCitation(fullAttrs).run()

    return true
  } catch (error) {
    console.error('[CitationPanel] 插入引用失败:', error)
    return false
  }
}

/**
 * 处理 KB 引用插入（支持多选）
 */
function handleInsertKb(items: CitationKbSearchItem[]) {
  if (items.length === 0) return

  // 插入多个引用，每个引用之间用空格分隔
  let allSuccess = true
  for (let i = 0; i < items.length; i++) {
    let success = false
    try {
      const attrs = convertKbResultToCitationAttrs(items[i], {
        unknownDocumentTitle: editorMessage('editor.citation.fallback.unknownDocument'),
      })
      success = insertCitationNode(attrs)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      store.setKbError(items[i].kbId, message)
      console.error('[CitationPanel] Knowledge 引用缺少精确来源锚点:', error)
    }

    if (!success) {
      allSuccess = false
      break
    }

    // 如果不是最后一个，插入一个空格
    if (i < items.length - 1) {
      const editor = uiStore.getEditor()
      if (editor) {
        editor.commands.insertContent(' ')
      }
    }
  }

  if (allSuccess) {
    store.close()
  }
}

/**
 * 处理 Web/Manual 引用插入
 */
function handleInsertWeb(form: WebManualFormInput) {
  const attrs = convertWebManualFormToCitationAttrs(form)
  const success = insertCitationNode(attrs)

  if (success) {
    store.close()
  }
}

/**
 * 关闭面板
 */
function handleClose() {
  store.close()
}

// ============ 键盘快捷键处理 ============

function handleKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape' && store.visible) {
    store.close()
  }
}

onMounted(() => {
  document.addEventListener('keydown', handleKeydown)
})

onUnmounted(() => {
  document.removeEventListener('keydown', handleKeydown)
})
</script>
