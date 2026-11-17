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
          v-if="knowledgeAvailable"
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
        <CitationKbTab
          v-if="knowledgeAvailable && navigationScope.currentProjectId"
          v-show="store.activeTab === 'kb'"
          :key="navigationScope.currentProjectId"
          :project-id="navigationScope.currentProjectId"
          @insert="handleInsertKb"
        />
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
import { useNavigationScope } from '@/app/navigation'
import { getKnowledgeCitationSearchPort } from '../../../ports/knowledgeCitationSearchPort'
import { convertKbResultToCitationAttrs } from '../adapters/knowledgeBaseCitationAdapter'
import { convertWebManualFormToCitationAttrs } from '../adapters/webCitationAdapter'
import type { CitationKbSearchItem } from '../services/citationKbSearchService'
import type { WebManualFormInput } from '../adapters/webCitationAdapter'
import type { CitationNodeAttrs } from '../types'
import CitationKbTab from './components/CitationKbTab.vue'
import CitationWebManualTab from './components/CitationWebManualTab.vue'
import { useEditorLocalization } from '../../../ui/useEditorLocalization'

const store = useCitationPanelStore()
const uiStore = useUIStore()
const navigationScope = useNavigationScope()
const { editorMessage } = useEditorLocalization()

const editor = computed(() => uiStore.getEditor())

// 请求身份在面板打开/项目切换时冻结，旧返回不得覆盖新范围。
const knowledgePort = getKnowledgeCitationSearchPort()
const knowledgeAvailable = computed(() => knowledgePort.isAvailable())
watch(
  [() => store.visible, () => navigationScope.currentProjectId, knowledgeAvailable],
  async ([visible, projectId, available], _previous, onCleanup) => {
    const controller = new AbortController()
    onCleanup(() => controller.abort())
    store.setAvailableKbs([])
    store.reset()
    if (!available && store.activeTab === 'kb') store.switchTab('web')
    if (!visible || !projectId || !available) return
    try {
      const libraries = await knowledgePort.listProjectLibraries(projectId, controller.signal)
      controller.signal.throwIfAborted()
      store.setAvailableKbs(libraries)
    } catch (error) {
      if (controller.signal.aborted) return
      console.error('[CitationPanel] 加载项目知识库失败:', error)
      store.setKbError('scope', error instanceof Error ? error.message : editorMessage('editor.citation.fallback.projectKbLoadFailed'))
    }
  },
  { immediate: true },
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
