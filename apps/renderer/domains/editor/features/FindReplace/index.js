/**
 * Find & Replace Feature
 * Provides Word-style find/replace functionality for the editor
 */

export { useFindReplaceStore } from './store/useFindReplaceStore'
export { FindReplaceExtension, createFindReplaceExtension } from './extension/FindReplaceExtension'
export { default as FindReplacePanel } from './ui/FindReplacePanel.vue'
export { useFindReplace, useKeyboardShortcuts } from './composables/useFindReplace'
export {
  createFindReplacePlugin,
  searchCommand,
  setActiveMatchCommand,
  replaceCurrentCommand,
  replaceAllCommand,
  clearSearchCommand,
  getPluginState
} from './plugin/findReplacePlugin'
