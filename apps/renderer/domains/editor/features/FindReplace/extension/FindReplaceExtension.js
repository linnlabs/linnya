import { Extension } from '@tiptap/core'
import {
  clearSearchCommand,
  createFindReplacePlugin,
  findReplacePluginKey,
  getPluginState,
  replaceAllCommand,
  replaceCurrentCommand,
  searchCommand,
  setActiveMatchCommand,
} from '../plugin/findReplacePlugin.js'
import {
  handleCloseFindReplace,
  handleFindNext,
  handleFindPrev,
  handleOpenFindReplace,
} from '../keyboard/FindReplaceKeys.js'
import { positionTextSelectionWithHandshake } from '../../RenderVirtualization'

function focusAndScrollToMatch(match, view) {
  if (!match || !view || view.isDestroyed) return

  view.focus()
  requestAnimationFrame(() => {
    if (view.isDestroyed) return
    void positionTextSelectionWithHandshake(
      {
        get state() {
          return view.state
        },
        view,
        isDestroyed: view.isDestroyed,
        commands: {
          focus: () => {
            view.focus()
            return true
          },
        },
      },
      match.from,
      match.to,
    )
  })
}

export const FindReplaceExtension = Extension.create({
  name: 'findReplace',

  addOptions() {
    return { store: null }
  },

  addStorage() {
    return { handlerIds: [] }
  },

  onCreate() {
    const store = this.options.store
    if (!store) {
      console.warn('[FindReplace] No store provided to extension')
      return
    }

    this.editor.storage.findReplaceStore = store
    const registry = this.editor.storage.keyboardRegistry
    if (!registry) {
      console.warn('[FindReplace] KeyboardRegistry not found in editor.storage')
      return
    }

    const handlers = [
      { keys: 'Mod-F', handler: handleOpenFindReplace, phase: 'pre', priority: 100, id: Symbol('findReplace-open') },
      { keys: 'Mod-G', handler: handleFindNext, phase: 'normal', priority: 50, id: Symbol('findReplace-next') },
      { keys: 'Shift-Mod-G', handler: handleFindPrev, phase: 'normal', priority: 50, id: Symbol('findReplace-prev') },
      { keys: 'Escape', handler: handleCloseFindReplace, phase: 'normal', priority: 60, id: Symbol('findReplace-close') },
    ]
    for (const handler of handlers) registry.register(handler)
    this.storage.handlerIds = handlers.map(handler => handler.id)
  },

  onDestroy() {
    const registry = this.editor.storage.keyboardRegistry
    if (registry) {
      for (const id of this.storage.handlerIds) registry.unregister(id)
    }
    delete this.editor.storage.findReplaceStore
  },

  addProseMirrorPlugins() {
    return [createFindReplacePlugin(this.options.store)]
  },

  addCommands() {
    return {
      setActiveMatchIndex: index => ({ state, dispatch }) => setActiveMatchCommand(index)(state, dispatch),
      search: (searchTerm, options = {}) => ({ state, dispatch }) => searchCommand(searchTerm, options)(state, dispatch),
      findNext: () => ({ state, dispatch, view }) => {
        const pluginState = getPluginState(state)
        if (!pluginState || pluginState.matches.length === 0) return false

        const nextIndex = (pluginState.activeIndex + 1) % pluginState.matches.length
        this.options.store.setActiveMatchIndex(nextIndex)
        setActiveMatchCommand(nextIndex)(state, dispatch)
        focusAndScrollToMatch(getPluginState(this.editor.state)?.matches[nextIndex], view)
        return true
      },
      findPrev: () => ({ state, dispatch, view }) => {
        const pluginState = getPluginState(state)
        if (!pluginState || pluginState.matches.length === 0) return false

        const previousIndex = pluginState.activeIndex <= 0
          ? pluginState.matches.length - 1
          : pluginState.activeIndex - 1
        this.options.store.setActiveMatchIndex(previousIndex)
        setActiveMatchCommand(previousIndex)(state, dispatch)
        focusAndScrollToMatch(getPluginState(this.editor.state)?.matches[previousIndex], view)
        return true
      },
      replaceCurrent: replaceTerm => ({ state, dispatch }) => {
        const replaced = replaceCurrentCommand(replaceTerm)(state, dispatch)
        if (replaced) this.options.store.setReplaceTerm(replaceTerm)
        return replaced
      },
      replaceAll: replaceTerm => ({ state, dispatch }) => {
        const replaced = replaceAllCommand(replaceTerm)(state, dispatch)
        if (replaced) {
          this.options.store.setReplaceTerm(replaceTerm)
          this.options.store.reset()
        }
        return replaced
      },
      clearSearch: () => ({ state, dispatch }) => {
        this.options.store.reset()
        return clearSearchCommand()(state, dispatch)
      },
    }
  },

  onTransaction({ transaction }) {
    if (!transaction.getMeta(findReplacePluginKey)) return

    const pluginState = getPluginState(this.editor.state)
    if (!pluginState) return
    if (pluginState.matches.length !== this.options.store.matchCount) {
      this.options.store.setMatches(pluginState.matches)
    }
    if (pluginState.activeIndex !== this.options.store.activeMatchIndex) {
      this.options.store.setActiveMatchIndex(pluginState.activeIndex)
    }
  },
})

export function createFindReplaceExtension(store) {
  return FindReplaceExtension.configure({ store })
}
