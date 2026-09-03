import { onMounted, onUnmounted } from 'vue'

/**
 * Composable for handling keyboard shortcuts
 * Provides a clean way to register and unregister keyboard event listeners
 */
export function useKeyboardShortcuts(shortcuts) {
  const handleKeyDown = (event) => {
    const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0
    const modKey = isMac ? event.metaKey : event.ctrlKey

    for (const shortcut of shortcuts) {
      const {
        key,
        ctrl = false,
        meta = false,
        shift = false,
        alt = false,
        handler
      } = shortcut

      // Check if key matches
      const keyMatch = event.key.toLowerCase() === key.toLowerCase()

      // Check modifiers
      const modMatch = (ctrl && event.ctrlKey) || (meta && modKey)
      const shiftMatch = shift ? event.shiftKey : !event.shiftKey
      const altMatch = alt ? event.altKey : !event.altKey

      if (keyMatch && modMatch && shiftMatch && altMatch) {
        const result = handler(event)
        if (result !== false) {
          event.preventDefault()
          event.stopPropagation()
        }
        return
      }
    }
  }

  onMounted(() => {
    document.addEventListener('keydown', handleKeyDown, true)
  })

  onUnmounted(() => {
    document.removeEventListener('keydown', handleKeyDown, true)
  })

  return {
    handleKeyDown
  }
}

/**
 * Composable for integrating find/replace with editor
 */
export function useFindReplace(editor, store) {
  // Watch for store changes and update editor commands
  const performSearch = () => {
    if (!editor.value) return

    const options = {
      matchCase: store.matchCase,
      wholeWord: store.wholeWord,
      useRegex: store.useRegex
    }

    editor.value.commands.search(store.searchTerm, options)
  }

  return {
    performSearch,

    findNext() {
      editor.value?.commands.findNext()
    },

    findPrev() {
      editor.value?.commands.findPrev()
    },

    replaceCurrent(term) {
      editor.value?.commands.replaceCurrent(term)
    },

    replaceAll(term) {
      editor.value?.commands.replaceAll(term)
    },

    clearSearch() {
      editor.value?.commands.clearSearch()
    }
  }
}
