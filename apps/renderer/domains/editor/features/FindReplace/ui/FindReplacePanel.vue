<template>
  <DraggablePanel
    :visible="isPanelVisible"
    width="auto"
    height="auto"
    container-selector=".editor-shell"
    initial-position="top-right"
    :position-offset="{ top: 16, right: 24 }"
    @close="handleClose"
  >
    <template #title>{{ editorMessage('editor.findReplace.title') }}</template>
    <div class="find-replace-panel" @keydown.stop>
      <div class="find-replace-body">
        <!-- Search input -->
        <div class="find-replace-input-group">
          <input
            ref="searchInputRef"
            v-model="localSearchTerm"
            type="text"
            class="find-replace-input"
            :placeholder="editorMessage('editor.findReplace.searchPlaceholder')"
            @keydown.enter.exact.prevent="handleNext"
            @keydown.enter.shift.exact.prevent="handlePrev"
            @keydown.escape="handleClose"
          />
          <div class="find-replace-input-actions">
            <span class="find-replace-count">{{ displayPosition }}</span>
            <button
              class="find-replace-nav-btn"
              :disabled="!hasMatches"
              @click="handlePrev"
              :aria-label="editorMessage('editor.findReplace.previous')"
              :title="`${editorMessage('editor.findReplace.previous')} (Shift+Enter)`"
            >
              <ChevronIcon direction="left" class="nav-icon" />
            </button>
            <button
              class="find-replace-nav-btn"
              :disabled="!hasMatches"
              @click="handleNext"
              :aria-label="editorMessage('editor.findReplace.next')"
              :title="`${editorMessage('editor.findReplace.next')} (Enter)`"
            >
              <ChevronIcon direction="right" class="nav-icon" />
            </button>
          </div>
        </div>

        <!-- Replace input -->
        <div class="find-replace-input-group">
          <input
            v-model="localReplaceTerm"
            type="text"
            class="find-replace-input"
            :placeholder="editorMessage('editor.findReplace.replacePlaceholder')"
            @keydown.escape="handleClose"
          />
          <div class="find-replace-input-actions">
            <button
              class="find-replace-action-btn"
              :disabled="!hasMatches"
              @click="handleReplaceCurrent"
              :title="editorMessage('editor.findReplace.replaceCurrent')"
            >
              {{ editorMessage('editor.findReplace.replaceCurrent') }}
            </button>
            <button
              class="find-replace-action-btn"
              :disabled="!hasMatches"
              @click="handleReplaceAll"
              :title="editorMessage('editor.findReplace.replaceAll')"
            >
              {{ editorMessage('editor.findReplace.replaceAll') }}
            </button>
          </div>
        </div>

        <!-- Options -->
        <div class="find-replace-options">
          <div class="option-wrapper" @click="localMatchCase = !localMatchCase">
            <CustomCheckbox v-model="localMatchCase">
              {{ editorMessage('editor.findReplace.matchCase') }}
            </CustomCheckbox>
          </div>
          <div class="option-wrapper" @click="localWholeWord = !localWholeWord">
            <CustomCheckbox v-model="localWholeWord">
              {{ editorMessage('editor.findReplace.wholeWord') }}
            </CustomCheckbox>
          </div>
          <div class="option-wrapper" @click="localUseRegex = !localUseRegex">
            <CustomCheckbox v-model="localUseRegex">
              {{ editorMessage('editor.findReplace.regex') }}
            </CustomCheckbox>
          </div>
        </div>

        <!-- No matches message -->
        <div v-if="showNoMatches" class="find-replace-no-matches">
          {{ editorMessage('editor.findReplace.noMatches') }}
        </div>
      </div>
    </div>
  </DraggablePanel>
</template>

<script setup>
import { ref, watch, computed, onMounted, onUnmounted, nextTick } from 'vue'
import { storeToRefs } from 'pinia'
import { useFindReplaceStore } from '../store/useFindReplaceStore'
import { useUIStore } from '@/shared/stores/ui'
import { useDebounceFn } from '@vueuse/core'
import { CustomCheckbox, DraggablePanel } from '@linnya/renderer-ui'
import { ChevronIcon } from '@linnya/renderer-ui/icons';
import { useEditorLocalization } from '../../../ui/useEditorLocalization'

const store = useFindReplaceStore()
const uiStore = useUIStore()
const { editorMessage } = useEditorLocalization()

const editor = computed(() => uiStore.getEditor())

const {
  searchTerm,
  replaceTerm,
  matchCase,
  wholeWord,
  useRegex,
  isPanelVisible,
  hasMatches,
  displayPosition
} = storeToRefs(store)

// Local state for inputs (to allow immediate UI updates)
const localSearchTerm = ref('')
const localReplaceTerm = ref('')
const localMatchCase = ref(false)
const localWholeWord = ref(false)
const localUseRegex = ref(false)

const searchInputRef = ref(null)
const showNoMatches = ref(false) // 是否显示"未找到匹配项"

// Sync local state with store
watch([searchTerm, replaceTerm, matchCase, wholeWord, useRegex], () => {
  localSearchTerm.value = searchTerm.value
  localReplaceTerm.value = replaceTerm.value
  localMatchCase.value = matchCase.value
  localWholeWord.value = wholeWord.value
  localUseRegex.value = useRegex.value
})

// Initialize local state
onMounted(() => {
  localSearchTerm.value = searchTerm.value
  localReplaceTerm.value = replaceTerm.value
  localMatchCase.value = matchCase.value
  localWholeWord.value = wholeWord.value
  localUseRegex.value = useRegex.value
})

// Debounced search update
const updateSearch = useDebounceFn((term, options) => {
  store.setSearchTerm(term)

  // Trigger search in editor
  if (editor.value?.commands) {
    editor.value.commands.search(term, options)
  }
}, 150)

// Watch local inputs and trigger debounced search
watch([localSearchTerm, localMatchCase, localWholeWord, localUseRegex], () => {
  const options = {
    matchCase: localMatchCase.value,
    wholeWord: localWholeWord.value,
    useRegex: localUseRegex.value
  }

  updateSearch(localSearchTerm.value, options)
})

watch(localReplaceTerm, (value) => {
  store.setReplaceTerm(value)
})

// 监听匹配状态变化，控制"未找到匹配项"的显示
// 只在状态真正改变时更新，避免闪烁
watch([hasMatches, localSearchTerm], ([newHasMatches, newSearchTerm], [oldHasMatches, oldSearchTerm]) => {
  if (!newSearchTerm) {
    // 搜索词为空时，隐藏消息
    showNoMatches.value = false
  } else if (newHasMatches !== oldHasMatches) {
    // 只在匹配状态真正改变时更新显示
    showNoMatches.value = !newHasMatches
  }
  // 如果搜索词改变但匹配状态没变，保持当前显示状态不变
})

// Focus search input when panel becomes visible
watch(isPanelVisible, async (visible, wasVisible) => {
  if (visible) {
    // 面板打开时：聚焦输入框
    await nextTick()
    searchInputRef.value?.focus()
    searchInputRef.value?.select()
  } else if (wasVisible) {
    // 面板关闭时：执行清理（无论是通过哪种方式关闭的）
    store.reset()
    if (editor.value?.commands) {
      editor.value.commands.clearSearch()
    }
  }
})

// Handlers
function handleNext() {
  if (!hasMatches.value) return
  if (editor.value?.commands) {
    editor.value.commands.findNext()
  }
}

function handlePrev() {
  if (!hasMatches.value) return
  if (editor.value?.commands) {
    editor.value.commands.findPrev()
  }
}

function handleReplaceCurrent() {
  if (!hasMatches.value) return
  if (editor.value?.commands) {
    editor.value.commands.replaceCurrent(localReplaceTerm.value)
  }
}

function handleReplaceAll() {
  if (!hasMatches.value) return
  if (editor.value?.commands) {
    editor.value.commands.replaceAll(localReplaceTerm.value)
  }
}

function handleClose() {
  // 只需要隐藏面板，清理逻辑由 watch(isPanelVisible) 统一处理
  store.hidePanel()
}
</script>
