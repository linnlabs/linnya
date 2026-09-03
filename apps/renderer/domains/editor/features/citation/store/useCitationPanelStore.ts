/**
 * @file citation/store/useCitationPanelStore.ts
 * @description Citation 面板状态管理（Phase 2 + Phase 3）
 *
 * 职责：
 * - 管理 Citation 面板的可见性与当前 Tab
 * - 管理 KB 搜索相关状态（选中的 KB、搜索查询、结果、加载状态、错误）
 * - 管理 Web/Manual 表单状态
 * - Phase 3：管理 Popover 和 EditPanel 状态
 *
 * 设计说明：
 * - 独立于 UIStore，保持高内聚
 * - 通过 uiStore.getEditor() 获取 editor 实例
 */

import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { CitationKbSearchItem } from '../services/citationKbSearchService'
import type { CitationWebManualValidationErrorCode } from '../functions/citationPresentation'
import type { CitationNodeAttrs, CitationSourceType } from '../types'

/** 面板 Tab 类型 */
export type CitationPanelTab = 'kb' | 'web'

/**
 * Citation 内联触发语法类型
 *
 * - latexCite: \\cite{...}
 * - bracketAt: [@...]
 * - footnote: [^...]
 */
export type CitationInsertSyntax = 'latexCite' | 'bracketAt' | 'footnote'

/** Web/Manual 表单数据 */
export interface WebManualFormData {
  /** URL（web 来源时必填） */
  url: string
  /** 标题（必填） */
  title: string
  /** 作者（可选，逗号分隔） */
  authors: string
  /** 年份（可选） */
  date: string
  /** 容器标题（可选，如期刊名） */
  containerTitle: string
  /** 引用片段（可选） */
  snippet: string
  /** 是否是手动来源（无 URL） */
  isManual: boolean
}

/** 创建空的 Web/Manual 表单 */
function createEmptyWebManualForm(): WebManualFormData {
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

export const useCitationPanelStore = defineStore('citationPanel', () => {
  // ============ 面板通用状态 ============

  /** 面板是否可见 */
  const visible = ref(false)

  /** 当前激活的 Tab */
  const activeTab = ref<CitationPanelTab>('kb')

  /**
   * 当前插入语法（Phase 3）
   * 中文说明：用于决定插入 token 的形式（\\cite / [@ / [^]）
   */
  const insertSyntax = ref<CitationInsertSyntax>('bracketAt')

  // ============ KB Tab 状态 ============

  /** 当前项目关联的 KB 列表（id + name） */
  const availableKbs = ref<Array<{ id: string; name: string }>>([])

  /** 用户选中的 KB ID 列表（默认全选） */
  const selectedKbIds = ref<string[]>([])

  /** KB 搜索查询关键词 */
  const kbQuery = ref('')

  /** KB 搜索结果 */
  const kbResults = ref<CitationKbSearchItem[]>([])

  /** KB 搜索加载状态 */
  const kbLoading = ref(false)

  /** 按 KB 维度的错误信息 */
  const kbErrorByKbId = ref<Record<string, string>>({})

  /** 当前选中的搜索结果列表（多选，用于插入） */
  const selectedKbResults = ref<CitationKbSearchItem[]>([])

  // ============ Web/Manual Tab 状态 ============

  /** Web/Manual 表单数据 */
  const webManualForm = ref<WebManualFormData>(createEmptyWebManualForm())

  /** Web/Manual 表单校验错误 */
  const webManualErrors = ref<Partial<Record<keyof WebManualFormData, CitationWebManualValidationErrorCode>>>({})

  // ============ Computed ============

  /** 是否有 KB 搜索错误 */
  const hasKbErrors = computed(() => Object.keys(kbErrorByKbId.value).length > 0)

  /** 是否可以插入 KB 引用（至少有一个选中结果） */
  const canInsertKbCitation = computed(() => selectedKbResults.value.length > 0)

  /** 是否可以插入 Web/Manual 引用（标题必填；web 来源时 URL 必填） */
  const canInsertWebCitation = computed(() => {
    const form = webManualForm.value
    if (!form.title.trim()) return false
    if (!form.isManual && !form.url.trim()) return false
    return true
  })

  // ============ Actions ============

  /** 打开面板 */
  function open(tab: CitationPanelTab = 'kb', syntax: CitationInsertSyntax = 'bracketAt') {
    visible.value = true
    activeTab.value = tab
    insertSyntax.value = syntax
  }

  /** 关闭面板 */
  function close() {
    visible.value = false
  }

  /** 切换 Tab */
  function switchTab(tab: CitationPanelTab) {
    activeTab.value = tab
  }

  /** 设置可用的 KB 列表 */
  function setAvailableKbs(kbs: Array<{ id: string; name: string }>) {
    availableKbs.value = kbs
    // 默认全选
    selectedKbIds.value = kbs.map((kb) => kb.id)
  }

  /** 设置选中的 KB ID 列表 */
  function setSelectedKbIds(ids: string[]) {
    selectedKbIds.value = ids
  }

  /** 切换某个 KB 的选中状态 */
  function toggleKbSelection(kbId: string) {
    const index = selectedKbIds.value.indexOf(kbId)
    if (index === -1) {
      selectedKbIds.value.push(kbId)
    } else {
      selectedKbIds.value.splice(index, 1)
    }
  }

  /** 设置 KB 搜索查询 */
  function setKbQuery(query: string) {
    kbQuery.value = query
  }

  /** 设置 KB 搜索结果 */
  function setKbResults(results: CitationKbSearchItem[]) {
    kbResults.value = results
  }

  /** 设置 KB 搜索加载状态 */
  function setKbLoading(loading: boolean) {
    kbLoading.value = loading
  }

  /** 设置按 KB 维度的错误 */
  function setKbError(kbId: string, error: string | null) {
    if (error) {
      kbErrorByKbId.value[kbId] = error
    } else {
      delete kbErrorByKbId.value[kbId]
    }
  }

  /** 清除所有 KB 错误 */
  function clearKbErrors() {
    kbErrorByKbId.value = {}
  }

  /** 切换某个 KB 搜索结果的选中状态 */
  function toggleKbResultSelection(result: CitationKbSearchItem) {
    const index = selectedKbResults.value.findIndex(
      (r) => r.docId === result.docId && r.blockId === result.blockId
    )
    if (index === -1) {
      selectedKbResults.value.push(result)
    } else {
      selectedKbResults.value.splice(index, 1)
    }
  }

  /** 清空 KB 搜索结果选中 */
  function clearKbResultSelection() {
    selectedKbResults.value = []
  }

  /** 更新 Web/Manual 表单字段 */
  function updateWebManualForm<K extends keyof WebManualFormData>(
    field: K,
    value: WebManualFormData[K]
  ) {
    webManualForm.value[field] = value
    // 清除对应字段的错误
    if (webManualErrors.value[field]) {
      delete webManualErrors.value[field]
    }
  }

  /** 设置 Web/Manual 表单错误 */
  function setWebManualError(field: keyof WebManualFormData, error: CitationWebManualValidationErrorCode | null) {
    if (error) {
      webManualErrors.value[field] = error
    } else {
      delete webManualErrors.value[field]
    }
  }

  /** 重置 Web/Manual 表单 */
  function resetWebManualForm() {
    webManualForm.value = createEmptyWebManualForm()
    webManualErrors.value = {}
  }

  /** 重置所有状态（面板关闭时调用） */
  function reset() {
    // 不重置 availableKbs（避免重复请求）
    kbQuery.value = ''
    kbResults.value = []
    kbLoading.value = false
    kbErrorByKbId.value = {}
    selectedKbResults.value = []
    resetWebManualForm()
    insertSyntax.value = 'bracketAt'
  }

  // ============ Phase 3：Popover 状态 ============

  /** Popover 是否可见 */
  const popoverVisible = ref(false)

  /** Popover 关联的引用数据 */
  const popoverCitation = ref<CitationNodeAttrs | null>(null)

  /** Popover 位置 */
  const popoverPosition = ref({ top: 0, left: 0 })

  /**
   * Popover 是否为“固定显示（点击后 pin）”
   *
   * 中文说明：
   * - pinned=true：点击引用后保持显示，直到用户发生“外部点击/键入/其它主动交互”才关闭
   * - pinned=false：用于 hover 预览（可选），允许 mouseleave 自动关闭
   */
  const popoverPinned = ref(false)

  /** 打开 Popover */
  function openPopover(
    citation: CitationNodeAttrs,
    position: { top: number; left: number },
    options?: {
      /** 是否固定显示（默认：true，因为当前触发入口是 click） */
      pinned?: boolean
    }
  ) {
    popoverCitation.value = citation
    popoverPosition.value = position
    popoverPinned.value = options?.pinned ?? true
    popoverVisible.value = true
  }

  /** 关闭 Popover */
  function closePopover() {
    popoverVisible.value = false
    popoverCitation.value = null
    popoverPinned.value = false
  }

  // ============ Phase 3：EditPanel 状态 ============

  /** EditPanel 是否可见 */
  const editPanelVisible = ref(false)

  /** EditPanel 关联的引用数据 */
  const editPanelCitation = ref<CitationNodeAttrs | null>(null)

  /** 打开 EditPanel */
  function openEditPanel(citation: CitationNodeAttrs) {
    editPanelCitation.value = citation
    editPanelVisible.value = true
    // 关闭 Popover
    closePopover()
  }

  /** 关闭 EditPanel */
  function closeEditPanel() {
    editPanelVisible.value = false
    editPanelCitation.value = null
  }

  return {
    // State
    visible,
    activeTab,
    insertSyntax,
    availableKbs,
    selectedKbIds,
    kbQuery,
    kbResults,
    kbLoading,
    kbErrorByKbId,
    selectedKbResults,
    webManualForm,
    webManualErrors,

    // Phase 3：Popover State
    popoverVisible,
    popoverCitation,
    popoverPosition,
    popoverPinned,

    // Phase 3：EditPanel State
    editPanelVisible,
    editPanelCitation,

    // Computed
    hasKbErrors,
    canInsertKbCitation,
    canInsertWebCitation,

    // Actions
    open,
    close,
    switchTab,
    setAvailableKbs,
    setSelectedKbIds,
    toggleKbSelection,
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

    // Phase 3：Popover Actions
    openPopover,
    closePopover,

    // Phase 3：EditPanel Actions
    openEditPanel,
    closeEditPanel,
  }
})
