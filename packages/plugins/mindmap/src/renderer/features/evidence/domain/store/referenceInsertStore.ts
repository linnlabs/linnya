import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
// 中文说明：复用 editor/citation 的“纯数据结构与校验”，不复用 editor 插入逻辑
import type { CitationKbSearchItem } from '@plugin/renderer/referenceRuntime'
import type { WebManualFormInput } from '@plugin/renderer/referenceRuntime'

export type ReferenceInsertTab = 'kb' | 'web'

function createEmptyWebManualForm(): WebManualFormInput {
  return {
    url: '',
    title: '',
    authors: '',
    date: '',
    containerTitle: '',
    snippet: '',
    isManual: false,
  }
}

/**
 * MindMap 引用插入面板状态（与 Editor 的 CitationPanel 解耦）
 *
 * 中文说明：
 * - 不能复用 `useCitationPanelStore`：它会驱动全局 `CitationPanel`，而 CitationPanel 依赖 editorInstance
 * - MindMap 只需要“同款 UX”，但插入目标是 mindmap 引用表，不是富文本编辑器
 */
export const useMindMapReferenceInsertStore = defineStore('mindmap-reference-insert', () => {
  // ============ 面板通用状态 ============
  const visible = ref(false)
  const activeTab = ref<ReferenceInsertTab>('kb')

  // ============ KB Tab 状态 ============
  const availableKbs = ref<Array<{ id: string; name: string }>>([])
  const selectedKbIds = ref<string[]>([])
  const kbQuery = ref('')
  const kbResults = ref<CitationKbSearchItem[]>([])
  const kbLoading = ref(false)
  const kbErrorByKbId = ref<Record<string, string>>({})
  const selectedKbResults = ref<CitationKbSearchItem[]>([])

  const hasKbErrors = computed(() => Object.keys(kbErrorByKbId.value).length > 0)
  // 命名对齐 CitationPanel（保证同款组件逻辑可直接复用）
  const canInsertKbCitation = computed(() => selectedKbResults.value.length > 0)

  // ============ Web/Manual Tab 状态 ============
  const webManualForm = ref<WebManualFormInput>(createEmptyWebManualForm())
  const webManualErrors = ref<Partial<Record<keyof WebManualFormInput, string>>>({})
  const canInsertWebCitation = computed(() => {
    const form = webManualForm.value
    if (!form.title.trim()) return false
    if (!form.isManual && !form.url.trim()) return false
    return true
  })

  // ============ Actions ============
  function open(tab: ReferenceInsertTab = 'kb') {
    visible.value = true
    activeTab.value = tab
  }

  function close() {
    visible.value = false
  }

  function switchTab(tab: ReferenceInsertTab) {
    activeTab.value = tab
  }

  function setAvailableKbs(kbs: Array<{ id: string; name: string }>) {
    availableKbs.value = kbs
    // 默认全选
    selectedKbIds.value = kbs.map(kb => kb.id)
  }

  function setSelectedKbIds(ids: string[]) {
    selectedKbIds.value = ids
  }

  function setKbQuery(query: string) {
    kbQuery.value = query
  }

  function setKbResults(results: CitationKbSearchItem[]) {
    kbResults.value = results
  }

  function setKbLoading(loading: boolean) {
    kbLoading.value = loading
  }

  function setKbError(kbId: string, error: string | null) {
    if (error) {
      kbErrorByKbId.value[kbId] = error
    } else {
      delete kbErrorByKbId.value[kbId]
    }
  }

  function clearKbErrors() {
    kbErrorByKbId.value = {}
  }

  function toggleKbResultSelection(result: CitationKbSearchItem) {
    const index = selectedKbResults.value.findIndex(
      r => r.docId === result.docId && r.blockId === result.blockId
    )
    if (index === -1) {
      selectedKbResults.value.push(result)
    } else {
      selectedKbResults.value.splice(index, 1)
    }
  }

  function clearKbResultSelection() {
    selectedKbResults.value = []
  }

  function updateWebManualForm<K extends keyof WebManualFormInput>(
    field: K,
    value: WebManualFormInput[K]
  ) {
    webManualForm.value[field] = value
    if (webManualErrors.value[field]) {
      delete webManualErrors.value[field]
    }
  }

  function setWebManualError(field: keyof WebManualFormInput, error: string | null) {
    if (error) {
      webManualErrors.value[field] = error
    } else {
      delete webManualErrors.value[field]
    }
  }

  function resetWebManualForm() {
    webManualForm.value = createEmptyWebManualForm()
    webManualErrors.value = {}
  }

  function reset() {
    // 不重置 availableKbs（避免重复请求）
    kbQuery.value = ''
    kbResults.value = []
    kbLoading.value = false
    kbErrorByKbId.value = {}
    selectedKbResults.value = []
    resetWebManualForm()
  }

  return {
    // state
    visible,
    activeTab,
    availableKbs,
    selectedKbIds,
    kbQuery,
    kbResults,
    kbLoading,
    kbErrorByKbId,
    selectedKbResults,
    webManualForm,
    webManualErrors,

    // computed
    hasKbErrors,
    canInsertKbCitation,
    canInsertWebCitation,

    // actions
    open,
    close,
    switchTab,
    setAvailableKbs,
    setSelectedKbIds,
    setKbQuery,
    setKbResults,
    setKbLoading,
    setKbError,
    clearKbErrors,
    toggleKbResultSelection,
    clearKbResultSelection,
    updateWebManualForm,
    setWebManualError,
    resetWebManualForm,
    reset,
  }
})

