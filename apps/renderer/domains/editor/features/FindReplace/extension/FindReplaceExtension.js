import { Extension } from '@tiptap/core'
import { TextSelection } from 'prosemirror-state'
import {
  createFindReplacePlugin,
  findReplacePluginKey,
  searchCommand,
  setActiveMatchCommand,
  replaceCurrentCommand,
  replaceAllCommand,
  clearSearchCommand,
  getPluginState
} from '../plugin/findReplacePlugin.js'
import {
  handleOpenFindReplace,
  handleFindNext,
  handleFindPrev,
  handleCloseFindReplace
} from '../keyboard/FindReplaceKeys.js'
import { positionTextSelectionWithHandshake } from '../../RenderVirtualization'

/**
 * 自动切换到包含匹配的 tab
 * @param {Object} match - 匹配项
 * @param {Object} audioEditorsStore - Audio editors store
 * @param {Object} audioRuntimeStore - Audio runtime store
 * @param {Object} mainEditor - 主编辑器实例（用于获取插件状态）
 * @param {Function} [callback] - tab 激活且高亮应用后执行的回调
 * @returns {Promise<boolean>} 当 tab 发生切换时 resolve true，否则 false
 */
async function switchToMatchTab(match, audioEditorsStore, audioRuntimeStore, mainEditor, callback) {
  if (!match || !audioEditorsStore || !audioRuntimeStore || match.editorType === 'main') {
    return false
  }
  
  const tabMap = {
    'notes': 'notes',
    'summary': 'summary',
    'transcript': 'transcript'
  }
  
  const targetTab = tabMap[match.editorType]
  if (targetTab && match.blockId) {
    const runtime = audioRuntimeStore.getRuntime(match.blockId)
    const currentTab = runtime?.activeTab
    const needSwitch = currentTab !== targetTab
    if (needSwitch) {
      audioRuntimeStore.updateRuntime(match.blockId, { activeTab: targetTab })
    }
    
    // 如果需要切换且是未激活的 tab，等待编辑器实例注册
    if (needSwitch && match.isInactive) {
      // 等待 Vue 渲染和编辑器初始化
      await new Promise(resolve => setTimeout(resolve, 120))
      
      // 等待编辑器实例注册（最多等待2秒）
      let attempts = 0
      while (attempts < 20) {
        const instances = audioEditorsStore.getAllEditors
        const found = instances.find(
          inst => inst.blockId === match.blockId && inst.editorType === match.editorType
        )
        if (found && found.editor && found.editor.view && found.editor.view.state) {
          // 将编辑器实例附加到 match 对象上
          match.editor = found.editor
          match.isInactive = false
          
          // 从主编辑器的插件状态中获取搜索配置，在新激活的编辑器中重新搜索
          if (mainEditor) {
            const pluginState = getPluginState(mainEditor.state)
            if (pluginState) {
              // 获取搜索词和选项
              const searchTerm = mainEditor.storage.findReplaceStore?.searchTerm
              const store = mainEditor.storage.findReplaceStore
              
              if (searchTerm && store) {
                // 在新激活的编辑器中重新搜索，获取正确的位置
                const options = {
                  matchCase: store.matchCase,
                  wholeWord: store.wholeWord,
                  useRegex: store.useRegex
                }
                
                // 使用 findMatchesInDoc 在子编辑器中搜索
                const { findMatchesInDoc } = await import('../plugin/findReplacePlugin.js')
                const actualMatches = findMatchesInDoc(found.editor.state.doc, searchTerm, options)
                
                if (actualMatches.length > 0) {
                  // 添加 blockId 和 editorType 信息
                  actualMatches.forEach(m => {
                    m.blockId = match.blockId
                    m.editorType = match.editorType
                    m.editor = found.editor
                  })
                  
                  // 计算本地 activeIndex
                  const globalActiveIndex = pluginState.activeIndex
                  let localActiveIndex = -1 // 默认为-1
                  
                  if (globalActiveIndex >= 0 && globalActiveIndex < pluginState.matches.length) {
                    const activeMatch = pluginState.matches[globalActiveIndex]
                    if (activeMatch.blockId === match.blockId && activeMatch.editorType === match.editorType) {
                      // 找到新计算的匹配项中与全局活动匹配项对应的索引
                      const newActiveMatchInEditor = actualMatches.find((m, i) => {
                        const globalMatchData = activeMatch.transcriptMatchData
                        const localMatchData = m.transcriptMatchData
                        if (globalMatchData && localMatchData) {
                          return globalMatchData.segmentIndex === localMatchData.segmentIndex &&
                                 globalMatchData.columnType === localMatchData.columnType &&
                                 m.text === activeMatch.text
                        }
                        // 对于 notes/summary，匹配可能不唯一，我们先用第一个
                        return i === 0
                      })
                      
                      localActiveIndex = newActiveMatchInEditor ? actualMatches.indexOf(newActiveMatchInEditor) : 0
                    }
                  }
                  
                  // 应用高亮
                  found.editor.commands.applyFindReplaceHighlights?.(actualMatches, localActiveIndex)

                  // 构造一个新的 match 对象，包含准确的位置信息
                  const newMatchWithPosition = actualMatches[localActiveIndex >= 0 ? localActiveIndex : 0]
                  callback?.({
                    ...match, // 保留原始信息
                    ...newMatchWithPosition, // 覆盖位置信息
                    editor: found.editor // 确保 editor 实例存在
                  })
                } else {
                  callback?.(null) // 没有找到匹配
                }
              }
            }
          }
          return true
        }
        await new Promise(resolve => setTimeout(resolve, 100))
        attempts++
      }
      return true
    } else {
      // 不需要切 tab：当前 tab 已是目标 tab。
      // 高亮已由 `setActiveMatchCommand` 触发的插件状态更新处理。
      // 我们只需要调用回调来处理滚动即可。
      callback?.(match)
      return false
    }
  }
  return false
}

/**
 * 聚焦并滚动到指定的匹配项
 * @param {Object} match - 匹配项
 * @param {Object} view - 主编辑器的 view
 * @param {Object} audioEditorsStore - Audio editors store
 */
function focusAndScrollToMatch(match, view, audioEditorsStore) {
  if (!match) return;

  const editorToFocus = match.editorType === 'main' ? view : match.editor?.view;
  if (!editorToFocus || editorToFocus.isDestroyed) {
    // 如果是子编辑器但实例不存在，尝试从 store 获取
    if (match.editorType !== 'main' && audioEditorsStore) {
      const instances = audioEditorsStore.getAllEditors;
      const found = instances.find(inst => inst.blockId === match.blockId && inst.editorType === match.editorType);
      if (found && found.editor && !found.editor.isDestroyed) {
        focusAndScrollToMatch({ ...match, editor: found.editor }, view, audioEditorsStore);
      }
    }
    return;
  }
  
  editorToFocus.focus();
  requestAnimationFrame(() => {
    if (editorToFocus && !editorToFocus.isDestroyed) {
      if (match.editorType === 'main') {
        void positionTextSelectionWithHandshake(
          {
            get state() {
              return editorToFocus.state
            },
            view: editorToFocus,
            isDestroyed: editorToFocus.isDestroyed,
            commands: {
              focus: () => {
                editorToFocus.focus()
                return true
              }
            }
          },
          match.from,
          match.to
        )
        return
      }

      editorToFocus.dispatch(
        editorToFocus.state.tr
          .setSelection(TextSelection.near(editorToFocus.state.doc.resolve(match.from)))
          .scrollIntoView()
      )
    }
  });
}

/**
 * Find & Replace TipTap extension
 * Provides commands and keyboard shortcuts for find/replace functionality
 *
 * 遵循项目的 KeyboardRegistry 标准，通过注册键盘处理器来处理快捷键
 */
export const FindReplaceExtension = Extension.create({
  name: 'findReplace',

  addOptions() {
    return {
      store: null,
      audioEditorsStore: null,
      audioContentStore: null,
      audioRuntimeStore: null
    }
  },

  addStorage() {
    return {
      handlerIds: [], // 存储注册的处理器 ID，用于卸载
      unsubscribeAudioStore: null
    }
  },

  onCreate() {
    const store = this.options.store
    if (!store) {
      console.warn('[FindReplace] No store provided to extension')
      return
    }

    // 将 store 存储到 editor.storage 供键盘处理器访问
    this.editor.storage.findReplaceStore = store

    // 注意：新的 store 架构不再需要订阅编辑器注册事件
    // 如果需要在新编辑器出现时恢复高亮，可以使用 watch 或其他方式
    // TODO: 如果需要，可以使用 watch 来监听编辑器注册

    // 获取 KeyboardRegistry
    const registry = this.editor.storage.keyboardRegistry
    if (!registry) {
      console.warn('[FindReplace] KeyboardRegistry not found in editor.storage')
      return
    }

    // 注册键盘处理器
    const handlerIds = []

    // Mod+F: 打开查找面板 (高优先级，pre phase)
    const openFindReplaceId = Symbol('findReplace-open')
    registry.register({
      keys: 'Mod-F',
      handler: handleOpenFindReplace,
      phase: 'pre',
      priority: 100,
      id: openFindReplaceId
    })
    handlerIds.push(openFindReplaceId)

    // Mod+G: 下一个匹配
    const findNextId = Symbol('findReplace-next')
    registry.register({
      keys: 'Mod-G',
      handler: handleFindNext,
      phase: 'normal',
      priority: 50,
      id: findNextId
    })
    handlerIds.push(findNextId)

    // Shift+Mod+G: 上一个匹配
    const findPrevId = Symbol('findReplace-prev')
    registry.register({
      keys: 'Shift-Mod-G',
      handler: handleFindPrev,
      phase: 'normal',
      priority: 50,
      id: findPrevId
    })
    handlerIds.push(findPrevId)

    // Escape: 关闭面板 (normal phase，优先级中等)
    const closeFindReplaceId = Symbol('findReplace-close')
    registry.register({
      keys: 'Escape',
      handler: handleCloseFindReplace,
      phase: 'normal',
      priority: 60,
      id: closeFindReplaceId
    })
    handlerIds.push(closeFindReplaceId)

    // 存储处理器 ID
    this.storage.handlerIds = handlerIds
  },

  onDestroy() {
    // 清理订阅（新架构不需要）

    // 卸载键盘处理器
    const registry = this.editor.storage.keyboardRegistry
    if (registry && this.storage.handlerIds) {
      this.storage.handlerIds.forEach(id => {
        registry.unregister(id)
      })
    }

    // 清理 store 引用
    delete this.editor.storage.findReplaceStore
  },

  addProseMirrorPlugins() {
    return [
      createFindReplacePlugin(
        this.options.store, 
        this.options.audioEditorsStore,
        this.options.audioContentStore,
        this.options.audioRuntimeStore
      )
    ]
  },

  addCommands() {
    return {
      /**
       * Set active match index (expose as a command)
       */
      setActiveMatchIndex: (index) => ({ state, dispatch }) => {
        return setActiveMatchCommand(index)(state, dispatch)
      },

      /**
       * Perform search with given term and options
       */
      search: (searchTerm, options = {}) => ({ state, dispatch }) => {
        return searchCommand(searchTerm, options)(state, dispatch)
      },

      /**
       * Find next match
       */
      findNext: () => ({ state, dispatch, view }) => {
        const pluginState = getPluginState(state)
        if (!pluginState || pluginState.matches.length === 0) return false

        const store = this.options.store
        const audioEditorsStore = this.options.audioEditorsStore
        const audioRuntimeStore = this.options.audioRuntimeStore
        const nextIndex = (pluginState.activeIndex + 1) % pluginState.matches.length
        
        // 更新 store 和插件状态
        store.setActiveMatchIndex(nextIndex)
        setActiveMatchCommand(nextIndex)(state, dispatch)

        // 使用更新后的 state 来获取 match
        const newState = this.editor.state
        const newPluginState = getPluginState(newState)
        const match = newPluginState.matches[nextIndex]

        if (match) {
          switchToMatchTab(
            match, 
            audioEditorsStore, 
            audioRuntimeStore, 
            this.editor, 
            (newMatch) => {
              // tab 切换和高亮应用完成后，执行滚动
              focusAndScrollToMatch(newMatch || match, view, audioEditorsStore)
            }
          ).then(wasSwitched => {
            // 如果没有发生 tab 切换（即匹配项在当前激活的编辑器中），也执行滚动
            if (!wasSwitched) {
              focusAndScrollToMatch(match, view, audioEditorsStore)
            }
          })
        }
        
        return true
      },

      /**
       * Find previous match
       */
      findPrev: () => ({ state, dispatch, view }) => {
        const pluginState = getPluginState(state)
        if (!pluginState || pluginState.matches.length === 0) return false

        const store = this.options.store
        const audioEditorsStore = this.options.audioEditorsStore
        const audioRuntimeStore = this.options.audioRuntimeStore
        const prevIndex = pluginState.activeIndex <= 0
          ? pluginState.matches.length - 1
          : pluginState.activeIndex - 1

        // 更新 store 和插件状态
        store.setActiveMatchIndex(prevIndex)
        setActiveMatchCommand(prevIndex)(state, dispatch)

        // 使用更新后的 state 来获取 match
        const newState = this.editor.state
        const newPluginState = getPluginState(newState)
        const match = newPluginState.matches[prevIndex]

        if (match) {
          switchToMatchTab(
            match, 
            audioEditorsStore, 
            audioRuntimeStore, 
            this.editor, 
            (newMatch) => {
              focusAndScrollToMatch(newMatch || match, view, audioEditorsStore)
            }
          ).then(wasSwitched => {
            if (!wasSwitched) {
              focusAndScrollToMatch(match, view, audioEditorsStore)
            }
          })
        }
        
        return true
      },

      /**
       * Replace current match
       */
      replaceCurrent: (replaceTerm) => ({ state, dispatch, view }) => {
        const result = replaceCurrentCommand(replaceTerm)(state, dispatch, view)

        if (result) {
          // Store will be updated via plugin state change
          const store = this.options.store
          store.setReplaceTerm(replaceTerm)
        }

        return result
      },

      /**
       * Replace all matches
       */
      replaceAll: (replaceTerm) => ({ state, dispatch }) => {
        const store = this.options.store
        const audioEditorsStore = this.options.audioEditorsStore
        const audioRuntimeStore = this.options.audioRuntimeStore
        
        const result = replaceAllCommand(
          replaceTerm, 
          audioEditorsStore, 
          audioRuntimeStore, 
          store
        )(state, dispatch)

        if (result) {
          store.setReplaceTerm(replaceTerm)
          // 注意：store.reset() 会在异步替换完成后由 performReplaceAll 调用
        }

        return result
      },

      /**
       * Clear search and reset
       */
      clearSearch: () => ({ state, dispatch }) => {
        const store = this.options.store
        store.reset()
        
        return clearSearchCommand()(state, dispatch)
      }
    }
  },


  /**
   * Sync plugin state with store when it changes
   */
  onTransaction({ transaction }) {
    // 只在有 findReplace 相关的 metadata 时处理
    const meta = transaction.getMeta(findReplacePluginKey)
    if (!meta) return

    const { state } = this.editor
    const pluginState = getPluginState(state)

    if (pluginState) {
      const store = this.options.store

      // Update store matches if they changed
      if (pluginState.matches.length !== store.matchCount) {
        store.setMatches(pluginState.matches)
      }

      // Update active index if it changed
      if (pluginState.activeIndex !== store.activeMatchIndex) {
        store.setActiveMatchIndex(pluginState.activeIndex)
      }
    }
  }
})

/**
 * Create extension with store
 * @param {Object} store - Find/Replace store instance
 * @param {Object} audioEditorsStore - Audio editors store instance
 * @param {Object} audioContentStore - Audio content store instance
 * @param {Object} audioRuntimeStore - Audio runtime store instance
 */
export function createFindReplaceExtension(store, audioEditorsStore, audioContentStore, audioRuntimeStore) {
  return FindReplaceExtension.configure({
    store,
    audioEditorsStore,
    audioContentStore,
    audioRuntimeStore
  })
}
