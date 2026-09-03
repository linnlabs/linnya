<template>
  <div class="reference-kb-tab">
    <!-- KB 范围选择 -->
    <div class="kb-scope-section">
      <div class="section-label">搜索范围</div>
      <div class="kb-checkboxes">
        <template v-if="store.availableKbs.length === 0">
          <div class="no-kbs-hint">当前项目未关联任何知识库</div>
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
        placeholder="输入关键词搜索知识库..."
        @keydown.enter="handleSearch"
      />
      <button
        class="search-btn"
        :disabled="!canSearch || store.kbLoading"
        @click="handleSearch"
      >
        {{ store.kbLoading ? '搜索中...' : '搜索' }}
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
          {{ localQuery.trim() ? '未找到匹配结果' : '输入关键词开始搜索' }}
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
            <span v-if="item.page" class="result-page">第 {{ item.page }} 页</span>
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
        插入引用 {{ store.selectedKbResults.length > 0 ? `(${store.selectedKbResults.length})` : '' }}
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue'
import { useDebounceFn } from '@vueuse/core'
import { useMindMapReferenceInsertStore } from '../../domain/store/referenceInsertStore'
import { searchInMultipleKbs, type CitationKbSearchItem } from '@plugin/renderer/referenceRuntime'
import { CustomCheckbox } from '@linnya/renderer-ui'

const emit = defineEmits<{
  insert: [items: CitationKbSearchItem[]]
}>()

const store = useMindMapReferenceInsertStore()
const searchInputRef = ref<HTMLInputElement | null>(null)
const localQuery = ref('')

const canSearch = computed(() => {
  return (
    localQuery.value.trim().length > 0 &&
    store.selectedKbIds.length > 0
  )
})

watch(
  () => store.visible,
  async (visible) => {
    if (visible && store.activeTab === 'kb') {
      await nextTick()
      searchInputRef.value?.focus()
    }
  }
)

watch(
  () => store.activeTab,
  async (tab) => {
    if (tab === 'kb' && store.visible) {
      await nextTick()
      searchInputRef.value?.focus()
    }
  }
)

watch(localQuery, (query) => {
  store.setKbQuery(query)
})

async function runSearch() {
  if (!canSearch.value) return

  store.setKbLoading(true)
  store.clearKbErrors()
  store.clearKbResultSelection()

  try {
    const kbIdToName: Record<string, string> = {}
    for (const kb of store.availableKbs) {
      kbIdToName[kb.id] = kb.name
    }

    const result = await searchInMultipleKbs({
      kbIds: store.selectedKbIds,
      kbIdToName,
      query: localQuery.value.trim(),
      topKPerKb: 5,
      topKFinal: 15,
    })

    store.setKbResults(result.results)

    for (const [kbId, error] of Object.entries(result.errorsByKbId)) {
      store.setKbError(kbId, error)
    }
  } catch (error) {
    console.error('[ReferenceKbTab] 搜索失败:', error)
    store.setKbResults([])
  } finally {
    store.setKbLoading(false)
  }
}

const debouncedSearch = useDebounceFn(async () => {
  await runSearch()
}, 300)

function handleSearch() {
  if (canSearch.value) {
    void runSearch()
  } else {
    void debouncedSearch()
  }
}

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

function getKbName(kbId: string): string {
  const kb = store.availableKbs.find((k) => k.id === kbId)
  return kb?.name || kbId
}
</script>
