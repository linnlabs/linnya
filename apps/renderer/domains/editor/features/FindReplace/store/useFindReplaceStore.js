import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

/**
 * Find & Replace state management store
 * Tracks search/replace terms, match state, and panel visibility
 */
export const useFindReplaceStore = defineStore('findReplace', () => {
  // Search state
  const searchTerm = ref('')
  const replaceTerm = ref('')
  const matchCase = ref(false)
  const wholeWord = ref(false)
  const useRegex = ref(false)

  // Match tracking
  const matches = ref([])
  const activeMatchIndex = ref(-1)

  // UI state
  const isPanelVisible = ref(false)

  // Computed
  const hasMatches = computed(() => matches.value.length > 0)

  const currentMatch = computed(() => {
    if (activeMatchIndex.value >= 0 && activeMatchIndex.value < matches.value.length) {
      return matches.value[activeMatchIndex.value]
    }
    return null
  })

  const matchCount = computed(() => matches.value.length)

  const displayPosition = computed(() => {
    if (!hasMatches.value) return '0 / 0'
    return `${activeMatchIndex.value + 1} / ${matchCount.value}`
  })

  // Actions
  function showPanel() {
    isPanelVisible.value = true
  }

  function hidePanel() {
    isPanelVisible.value = false
  }

  function togglePanel() {
    isPanelVisible.value = !isPanelVisible.value
  }

  function setSearchTerm(term) {
    searchTerm.value = term
  }

  function setReplaceTerm(term) {
    replaceTerm.value = term
  }

  function setMatchCase(value) {
    matchCase.value = value
  }

  function setWholeWord(value) {
    wholeWord.value = value
  }

  function setUseRegex(value) {
    useRegex.value = value
  }

  function setMatches(newMatches) {
    matches.value = newMatches
    // Reset active index if matches changed
    if (newMatches.length > 0 && activeMatchIndex.value < 0) {
      activeMatchIndex.value = 0
    } else if (newMatches.length === 0) {
      activeMatchIndex.value = -1
    } else if (activeMatchIndex.value >= newMatches.length) {
      activeMatchIndex.value = newMatches.length - 1
    }
  }

  function setActiveMatchIndex(index) {
    if (index >= 0 && index < matches.value.length) {
      activeMatchIndex.value = index
    }
  }

  function nextMatch() {
    if (!hasMatches.value) return
    activeMatchIndex.value = (activeMatchIndex.value + 1) % matches.value.length
  }

  function prevMatch() {
    if (!hasMatches.value) return
    activeMatchIndex.value = activeMatchIndex.value <= 0
      ? matches.value.length - 1
      : activeMatchIndex.value - 1
  }

  function reset() {
    searchTerm.value = ''
    replaceTerm.value = ''
    matches.value = []
    activeMatchIndex.value = -1
    // Keep options (matchCase, wholeWord, useRegex) intact
  }

  function resetAll() {
    searchTerm.value = ''
    replaceTerm.value = ''
    matchCase.value = false
    wholeWord.value = false
    useRegex.value = false
    matches.value = []
    activeMatchIndex.value = -1
    isPanelVisible.value = false
  }

  return {
    // State
    searchTerm,
    replaceTerm,
    matchCase,
    wholeWord,
    useRegex,
    matches,
    activeMatchIndex,
    isPanelVisible,

    // Computed
    hasMatches,
    currentMatch,
    matchCount,
    displayPosition,

    // Actions
    showPanel,
    hidePanel,
    togglePanel,
    setSearchTerm,
    setReplaceTerm,
    setMatchCase,
    setWholeWord,
    setUseRegex,
    setMatches,
    setActiveMatchIndex,
    nextMatch,
    prevMatch,
    reset,
    resetAll
  }
})
