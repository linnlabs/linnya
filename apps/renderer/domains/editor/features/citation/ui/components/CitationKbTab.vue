<template>
  <div class="citation-kb-tab">
    <!-- KB 范围选择 -->
    <div class="kb-scope-section">
      <div class="section-label">{{ editorMessage('editor.citation.kb.searchScope') }}</div>
      <div class="kb-checkboxes">
        <template v-if="store.availableKbs.length === 0">
          <div class="no-kbs-hint">
            {{ editorMessage('editor.citation.kb.noProjectKnowledgeBases') }}
          </div>
        </template>
        <template v-else>
          <CustomCheckbox
            v-for="kb in store.availableKbs"
            :key="kb.id"
            :model-value="store.selectedKbIds"
            :value="kb.id"
            @update:model-value="store.setSelectedKbIds($event as string[])"
          >
            <span class="kb-name">{{ kb.name }}</span>
          </CustomCheckbox>
        </template>
      </div>
    </div>

    <!-- 搜索输入 -->
    <div class="search-section">
      <input
        ref="searchInputRef"
        v-model="localQuery"
        type="text"
        class="search-input"
        :placeholder="editorMessage('editor.citation.kb.searchPlaceholder')"
        @keydown.enter="handleSearch"
      />
      <button
        class="search-btn"
        :disabled="!canSearch || store.kbLoading"
        @click="handleSearch"
      >
        {{ store.kbLoading ? editorMessage('editor.citation.kb.searching') : editorMessage('editor.citation.kb.search') }}
      </button>
    </div>

    <!-- 错误提示 -->
    <div v-if="store.hasKbErrors" class="error-section">
      <div
        v-for="(error, kbId) in store.kbErrorByKbId"
        :key="kbId"
        class="error-item"
      >
        <span class="error-kb">{{ getKbName(kbId as string) }}:</span>
        <span class="error-msg">{{ error }}</span>
      </div>
    </div>

    <!-- 搜索结果 -->
    <div class="results-section">
      <template v-if="store.kbResults.length === 0 && !store.kbLoading">
        <div class="no-results">
          {{ localQuery.trim() ? editorMessage('editor.citation.kb.noResults') : editorMessage('editor.citation.kb.startSearch') }}
        </div>
      </template>
      <template v-else>
        <div
          v-for="item in store.kbResults"
          :key="`${item.docId}-${item.blockId || ''}`"
          class="result-item"
          :class="{ selected: isSelected(item) }"
          @click="handleSelectResult(item)"
        >
          <div class="result-header">
            <span class="result-title">{{ item.docTitle }}</span>
            <span class="result-kb-badge">{{ item.kbName }}</span>
          </div>
          <div class="result-snippet">{{ item.snippet }}</div>
          <div class="result-meta">
            <span v-if="item.page" class="result-page">
              {{ formatCitationPageLabel(item.page, editorMessage) }}
            </span>
          </div>
        </div>
      </template>
    </div>

    <!-- 插入按钮 -->
    <div class="action-section">
      <button
        class="insert-btn"
        :disabled="!store.canInsertKbCitation"
        @click="handleInsert"
      >
        {{ formatCitationKbInsertLabel(store.selectedKbResults.length, editorMessage) }}
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * @file citation/ui/components/CitationKbTab.vue
 * @description KB 搜索与选择 Tab 组件（Phase 2）
 *
 * 职责：
 * - 展示 KB 范围多选
 * - 提供搜索输入
 * - 展示搜索结果列表
 * - 处理结果选择与插入
 */

import { ref, computed, watch, nextTick } from 'vue'
import { useDebounceFn } from '@vueuse/core'
import { useCitationPanelStore } from '../../store/useCitationPanelStore'
import { searchInMultipleKbs, type CitationKbSearchItem } from '../../services/citationKbSearchService'
import { CustomCheckbox } from '@linnya/renderer-ui'
import { useEditorLocalization } from '../../../../ui/useEditorLocalization'
import {
  formatCitationKbInsertLabel,
  formatCitationPageLabel,
} from '../../functions/citationPresentation'

const emit = defineEmits<{
  insert: [items: CitationKbSearchItem[]]
}>()

const store = useCitationPanelStore()
const { editorMessage } = useEditorLocalization()
const searchInputRef = ref<HTMLInputElement | null>(null)

// 本地搜索关键词（与 store 同步）
const localQuery = ref('')

// 是否可以搜索
const canSearch = computed(() => {
  return (
    localQuery.value.trim().length > 0 &&
    store.selectedKbIds.length > 0
  )
})

// 面板打开时聚焦搜索框
watch(
  () => store.visible,
  async (visible) => {
    if (visible && store.activeTab === 'kb') {
      await nextTick()
      searchInputRef.value?.focus()
    }
  }
)

// Tab 切换时聚焦
watch(
  () => store.activeTab,
  async (tab) => {
    if (tab === 'kb' && store.visible) {
      await nextTick()
      searchInputRef.value?.focus()
    }
  }
)

// 同步本地 query 到 store
watch(localQuery, (query) => {
  store.setKbQuery(query)
})

// ============ 搜索处理 ============

/**
 * 实际执行搜索（点击按钮/回车等“显式触发”应当立即执行，不做防抖）
 */
async function runSearch() {
  if (!canSearch.value) return

  store.setKbLoading(true)
  store.clearKbErrors()
  store.clearKbResultSelection()

  try {
    // 构建 kbIdToName 映射
    const kbIdToName: Record<string, string> = {}
    for (const kb of store.availableKbs) {
      kbIdToName[kb.id] = kb.name
    }

    const result = await searchInMultipleKbs({
      kbIds: store.selectedKbIds,
      kbIdToName,
      query: localQuery.value.trim(),
      editorMessage,
      topKPerKb: 5,
      topKFinal: 15,
    })

    store.setKbResults(result.results)

    // 设置错误信息
    for (const [kbId, error] of Object.entries(result.errorsByKbId)) {
      store.setKbError(kbId, error)
    }
  } catch (error) {
    console.error('[CitationKbTab] 搜索失败:', error)
    store.setKbResults([])
  } finally {
    store.setKbLoading(false)
  }
}

/**
 * 防抖版本（预留给“输入即搜”等场景；当前点击按钮不走防抖）
 */
const debouncedSearch = useDebounceFn(async () => {
  await runSearch()
}, 300)

function handleSearch() {
  if (canSearch.value) {
    // 中文说明：点击按钮/回车属于用户显式触发，应当立即搜索
    void runSearch()
  }
}

// ============ 结果选择 ============

function isSelected(item: CitationKbSearchItem): boolean {
  return store.selectedKbResults.some(
    (r) => r.docId === item.docId && r.blockId === item.blockId
  )
}

function handleSelectResult(item: CitationKbSearchItem) {
  store.toggleKbResultSelection(item)
}

function handleInsert() {
  if (store.selectedKbResults.length > 0) {
    emit('insert', store.selectedKbResults)
  }
}

// ============ 辅助函数 ============

function getKbName(kbId: string): string {
  const kb = store.availableKbs.find((k) => k.id === kbId)
  return kb?.name || kbId
}
</script>
