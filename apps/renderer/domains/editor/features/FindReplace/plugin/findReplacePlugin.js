import { Plugin, PluginKey } from 'prosemirror-state'
import { Decoration, DecorationSet } from 'prosemirror-view'

export const findReplacePluginKey = new PluginKey('findReplace')

/**
 * Match information structure
 * @typedef {Object} Match
 * @property {number} from - Start position
 * @property {number} to - End position
 * @property {string} text - Matched text
 * @property {string} [editorType] - Type of editor ('main' | 'notes' | 'summary' | 'transcript')
 * @property {string} [blockId] - Block ID (for sub-editors)
 * @property {object} [editor] - Editor instance (for sub-editors)
 */

/**
 * Find all matches in the main document
 * @param {Node} doc - ProseMirror document
 * @param {string} searchTerm - Search term
 * @param {Object} options - Search options
 * @returns {Match[]} Array of matches
 */
export function findMatchesInDoc(doc, searchTerm, options = {}) {
  const { matchCase = false, wholeWord = false, useRegex = false } = options
  const matches = []

  let pattern
  try {
    if (useRegex) {
      pattern = new RegExp(searchTerm, matchCase ? 'g' : 'gi')
    } else {
      // Escape regex special characters
      const escaped = searchTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const boundary = wholeWord ? '\\b' : ''
      pattern = new RegExp(`${boundary}${escaped}${boundary}`, matchCase ? 'g' : 'gi')
    }
  } catch (e) {
    // Invalid regex, return empty matches
    return []
  }

  // Scan document text
  doc.descendants((node, pos) => {
    if (node.isText) {
      const text = node.text
      let match
      // Reset lastIndex for global regex
      pattern.lastIndex = 0

      while ((match = pattern.exec(text)) !== null) {
        const from = pos + match.index
        const to = from + match[0].length
        matches.push({
          from,
          to,
          text: match[0],
          editorType: 'main'
        })

        // Prevent infinite loop for zero-width matches
        if (match.index === pattern.lastIndex) {
          pattern.lastIndex++
        }
      }
    }
  })

  return matches
}

/**
 * 从 HTML 中提取纯文本
 */
function extractTextFromHTML(html) {
  if (!html) return ''
  const div = document.createElement('div')
  div.innerHTML = html
  return div.textContent || div.innerText || ''
}

/**
 * 在纯文本中查找匹配项
 */
function findMatchesInText(text, searchTerm, options = {}) {
  if (!text || !searchTerm) return []
  
  const { matchCase = false, wholeWord = false, useRegex = false } = options
  const matches = []
  
  let pattern
  try {
    if (useRegex) {
      pattern = new RegExp(searchTerm, matchCase ? 'g' : 'gi')
    } else {
      const escaped = searchTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const boundary = wholeWord ? '\\b' : ''
      pattern = new RegExp(`${boundary}${escaped}${boundary}`, matchCase ? 'g' : 'gi')
    }
  } catch (e) {
    return []
  }
  
  let match
  while ((match = pattern.exec(text)) !== null) {
    matches.push({
      from: match.index,
      to: match.index + match[0].length,
      text: match[0]
    })
    if (match.index === pattern.lastIndex) {
      pattern.lastIndex++
    }
  }
  
  return matches
}

/**
 * Find all matches in the document and sub-editors
 * @param {Node} doc - ProseMirror document
 * @param {string} searchTerm - Search term
 * @param {Object} options - Search options
 * @param {Object} [audioEditorsStore] - Audio editors store instance
 * @param {Object} [audioContentStore] - Audio content store instance
 * @param {Object} [audioRuntimeStore] - Audio runtime store instance
 * @returns {Match[]} Array of matches
 */
function findMatches(doc, searchTerm, options = {}, audioEditorsStore = null, audioContentStore = null, audioRuntimeStore = null) {
  if (!searchTerm) return []

  const matches = []
  
  if (!audioEditorsStore || !audioContentStore || !audioRuntimeStore) {
    // 没有 stores，只搜索主文档
    return findMatchesInDoc(doc, searchTerm, options)
  }

  // 收集已注册的子编辑器
  const subEditors = audioEditorsStore.getAllEditors
  const registeredTabs = new Set()
  const editorsByBlock = {} // { blockId: { editorType: editor } }
  
  subEditors.forEach(({ blockId, editorType, editor }) => {
    registeredTabs.add(`${blockId}-${editorType}`)
    if (!editorsByBlock[blockId]) editorsByBlock[blockId] = {}
    editorsByBlock[blockId][editorType] = editor
  })
  
  // 收集所有 block 状态
  const allBlockIds = new Set([
    ...Object.keys(audioContentStore.contents),
    ...Object.keys(audioRuntimeStore.runtimes)
  ])
  const blockStatesMap = {}
  allBlockIds.forEach(blockId => {
    blockStatesMap[blockId] = {
      ...audioContentStore.getContent(blockId),
      ...audioRuntimeStore.getRuntime(blockId)
    }
  })

  // 遍历主文档，按文档顺序收集匹配
  let currentPos = 0
  doc.descendants((node, pos) => {
    // 1. 如果是文本节点，在主编辑器中搜索
    if (node.isText) {
      const text = node.text
      let pattern
      try {
        const { matchCase = false, wholeWord = false, useRegex = false } = options
        if (useRegex) {
          pattern = new RegExp(searchTerm, matchCase ? 'g' : 'gi')
        } else {
          const escaped = searchTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
          const boundary = wholeWord ? '\\b' : ''
          pattern = new RegExp(`${boundary}${escaped}${boundary}`, matchCase ? 'g' : 'gi')
        }
      } catch (e) {
        return
      }

      let match
      pattern.lastIndex = 0
      while ((match = pattern.exec(text)) !== null) {
        matches.push({
          from: pos + match.index,
          to: pos + match.index + match[0].length,
          text: match[0],
          editorType: 'main',
          documentOrder: currentPos++
        })
        if (match.index === pattern.lastIndex) {
          pattern.lastIndex++
        }
      }
    }
    
    // 2. 如果是 audioBlock 节点，插入其子编辑器的匹配
    if (node.type.name === 'audioBlock') {
      const blockId = node.attrs.id
      if (!blockId) return
      
      // 按顺序搜索子编辑器：notes -> transcript -> summary
      const editorTypes = ['notes', 'transcript', 'summary']
      
      editorTypes.forEach(editorType => {
        const key = `${blockId}-${editorType}`
        
        // 检查是否有已激活的编辑器
        if (editorsByBlock[blockId]?.[editorType]) {
          const editor = editorsByBlock[blockId][editorType]
          const subMatches = findMatchesInDoc(editor.state.doc, searchTerm, options)
          subMatches.forEach(match => {
            matches.push({
              ...match,
              editorType,
              blockId,
              editor,
              documentOrder: currentPos++
            })
          })
        } else if (blockStatesMap[blockId]) {
          // 未激活的编辑器，从状态中搜索
          const state = blockStatesMap[blockId]
          
          if (editorType === 'notes' && state.notesContent) {
            const text = extractTextFromHTML(state.notesContent)
            const textMatches = findMatchesInText(text, searchTerm, options)
            textMatches.forEach(match => {
              matches.push({
                ...match,
                editorType: 'notes',
                blockId,
                editor: null,
                isInactive: true,
                documentOrder: currentPos++
              })
            })
          } else if (editorType === 'summary' && state.summaryContent) {
            const text = extractTextFromHTML(state.summaryContent)
            const textMatches = findMatchesInText(text, searchTerm, options)
            textMatches.forEach(match => {
              matches.push({
                ...match,
                editorType: 'summary',
                blockId,
                editor: null,
                isInactive: true,
                documentOrder: currentPos++
              })
            })
          } else if (editorType === 'transcript' && state.transcriptContent) {
            const transcriptContent = state.transcriptContent
            if (typeof transcriptContent === 'string') {
              const tMatches = findMatchesInText(transcriptContent, searchTerm, options)
              tMatches.forEach(tm => {
                matches.push({ 
                  ...tm, 
                  editorType: 'transcript', 
                  blockId, 
                  editor: null, 
                  isInactive: true,
                  documentOrder: currentPos++
                })
              })
            } else if (transcriptContent?.type === 'transcriptDocument' && Array.isArray(transcriptContent.content)) {
              transcriptContent.content.forEach((segmentNode, segmentIndex) => {
                if (!segmentNode || !Array.isArray(segmentNode.content)) return
                let textCol = ''
                let translationCol = ''
                segmentNode.content.forEach((child) => {
                  if (child?.type === 'transcriptText' && Array.isArray(child.content)) {
                    textCol = child.content.map(n => n.text || '').join('')
                  } else if (child?.type === 'transcriptTranslation' && Array.isArray(child.content)) {
                    translationCol = child.content.map(n => n.text || '').join('')
                  }
                })
                
                const textMatches = findMatchesInText(textCol, searchTerm, options)
                textMatches.forEach(tm => {
                  matches.push({
                    from: 0,
                    to: 0,
                    text: tm.text,
                    editorType: 'transcript',
                    blockId,
                    editor: null,
                    isInactive: true,
                    transcriptMatchData: { segmentIndex, columnType: 'text' },
                    documentOrder: currentPos++
                  })
                })
                
                if (translationCol) {
                  const trMatches = findMatchesInText(translationCol, searchTerm, options)
                  trMatches.forEach(tm => {
                    matches.push({
                      from: 0,
                      to: 0,
                      text: tm.text,
                      editorType: 'transcript',
                      blockId,
                      editor: null,
                      isInactive: true,
                      transcriptMatchData: { segmentIndex, columnType: 'translation' },
                      documentOrder: currentPos++
                    })
                  })
                }
              })
            }
          }
        }
      })
    }
  })

  // matches 已经按照文档顺序收集，documentOrder 字段确保了正确的排序
  // 但为了稳定性，我们还是按 documentOrder 排一次序
  matches.sort((a, b) => (a.documentOrder ?? 0) - (b.documentOrder ?? 0))

  return matches
}

/**
 * Create decorations for matches
 * @param {Node} doc - ProseMirror document (main editor)
 * @param {Match[]} matches - Array of matches
 * @param {number} activeIndex - Index of active match
 * @returns {Object} Object containing main decorations and sub-editor decorations
 */
function createDecorations(doc, matches, activeIndex) {
  const mainDecorations = []
  const subEditorDecorations = {} // { blockId-editorType: [decorations] }

  matches.forEach((match, index) => {
    const isActive = index === activeIndex
    const decoration = Decoration.inline(match.from, match.to, {
      class: isActive ? 'find-replace-match-active' : 'find-replace-match',
      'data-match-index': index
    })

    if (match.editorType === 'main') {
      mainDecorations.push(decoration)
    } else {
      // 子编辑器的装饰
      const key = `${match.blockId}-${match.editorType}`
      if (!subEditorDecorations[key]) {
        subEditorDecorations[key] = []
      }
      subEditorDecorations[key].push(decoration)
    }
  })

  return {
    main: DecorationSet.create(doc, mainDecorations),
    subEditors: subEditorDecorations
  }
}

/**
 * Apply decorations to sub-editors
 * @param {Object} subEditorDecorations - Sub-editor decorations
 */
function applySubEditorDecorations(subEditorDecorations) {
  for (const key in subEditorDecorations) {
    const [blockId, editorType] = key.split('-')
    const decorations = subEditorDecorations[key]
    
    // 找到对应的编辑器实例并应用装饰
    // 这需要通过 audioStore 来获取编辑器实例
    // 实际应用会在命令中处理
  }
}

/**
 * Create the find/replace ProseMirror plugin
 * @param {Object} store - Pinia store instance
 * @param {Object} [audioEditorsStore] - Audio editors store instance
 * @param {Object} [audioContentStore] - Audio content store instance
 * @param {Object} [audioRuntimeStore] - Audio runtime store instance
 * @returns {Plugin} ProseMirror plugin
 */
export function createFindReplacePlugin(store, audioEditorsStore = null, audioContentStore = null, audioRuntimeStore = null) {
  return new Plugin({
    key: findReplacePluginKey,

    state: {
      init() {
        return {
          decorations: DecorationSet.empty,
          subEditorDecorations: {},
          matches: [],
          activeIndex: -1,
          audioEditorsStore,
          audioContentStore,
          audioRuntimeStore
        }
      },

      apply(tr, pluginState, oldState, newState) {
        // Get metadata from transaction
        const meta = tr.getMeta(findReplacePluginKey)

        if (meta) {
          // Update from command
          const { searchTerm, options, activeIndex } = meta

          if (searchTerm !== undefined) {
            // Perform new search
            const matches = findMatches(
              newState.doc, 
              searchTerm, 
              options, 
              pluginState.audioEditorsStore,
              pluginState.audioContentStore,
              pluginState.audioRuntimeStore
            )
            const newActiveIndex = activeIndex !== undefined ? activeIndex : (matches.length > 0 ? 0 : -1)
            const decorations = createDecorations(newState.doc, matches, newActiveIndex)

            // 应用子编辑器装饰
            applySubEditorDecorationsToEditors(
              decorations.subEditors, 
              matches, 
              newActiveIndex, 
              pluginState.audioEditorsStore,
              store
            )

            return {
              decorations: decorations.main,
              subEditorDecorations: decorations.subEditors,
              matches,
              activeIndex: newActiveIndex,
              audioEditorsStore: pluginState.audioEditorsStore,
              audioContentStore: pluginState.audioContentStore,
              audioRuntimeStore: pluginState.audioRuntimeStore
            }
          } else if (activeIndex !== undefined) {
            // Just update active index
            const decorations = createDecorations(newState.doc, pluginState.matches, activeIndex)
            
            // 应用子编辑器装饰
            applySubEditorDecorationsToEditors(
              decorations.subEditors, 
              pluginState.matches, 
              activeIndex, 
              pluginState.audioEditorsStore,
              store
            )

            return {
              ...pluginState,
              decorations: decorations.main,
              subEditorDecorations: decorations.subEditors,
              activeIndex
            }
          }
        }

        // Map decorations through document changes
        if (tr.docChanged) {
          // Re-search if document changed to update positions
          if (store.searchTerm) {
            const matches = findMatches(
              newState.doc, 
              store.searchTerm, 
              {
                matchCase: store.matchCase,
                wholeWord: store.wholeWord,
                useRegex: store.useRegex
              },
              pluginState.audioEditorsStore,
              pluginState.audioContentStore,
              pluginState.audioRuntimeStore
            )

            // Try to maintain active match position
            let newActiveIndex = pluginState.activeIndex
            if (newActiveIndex >= matches.length) {
              newActiveIndex = matches.length > 0 ? matches.length - 1 : -1
            }

            const decorations = createDecorations(newState.doc, matches, newActiveIndex)
            
            // 应用子编辑器装饰
            applySubEditorDecorationsToEditors(
              decorations.subEditors, 
              matches, 
              newActiveIndex, 
              pluginState.audioEditorsStore,
              store
            )

            return {
              decorations: decorations.main,
              subEditorDecorations: decorations.subEditors,
              matches,
              activeIndex: newActiveIndex,
              audioEditorsStore: pluginState.audioEditorsStore,
              audioContentStore: pluginState.audioContentStore,
              audioRuntimeStore: pluginState.audioRuntimeStore
            }
          }
        }

        return pluginState
      }
    },

    props: {
      decorations(state) {
        return this.getState(state)?.decorations
      }
    }
  })
}

/**
 * Apply decorations to sub-editors
 * @param {Object} subEditorDecorations - Sub-editor decorations { blockId-editorType: [decorations] }
 * @param {Array} matches - All matches
 * @param {number} globalActiveIndex - Global active match index
 * @param {Object} audioEditorsStore - Audio editors store instance
 * @param {Object} store - find/replace store for term/options
  */
function applySubEditorDecorationsToEditors(subEditorDecorations, matches, globalActiveIndex, audioEditorsStore, store) {
  if (!audioEditorsStore) return

  const allSubEditors = audioEditorsStore.getAllEditors

  // 遍历所有已注册的子编辑器，同步高亮状态
  allSubEditors.forEach(instance => {
    const { blockId, editorType, editor: editorInstance } = instance
    const key = `${blockId}-${editorType}`

    if (!editorInstance || editorInstance.isDestroyed || !editorInstance.commands) {
      return // 跳过无效的编辑器实例
    }

    // 检查当前搜索结果是否包含该编辑器的高亮
    if (subEditorDecorations[key]) {
      const editorMatches = matches.filter(m => m.blockId === blockId && m.editorType === editorType)
      
      if (editorMatches.length === 0) return

      let matchesForApply = editorMatches
      const hasPlaceholder = editorMatches.some(m => m.from === 0 && m.to === 0)

      if (hasPlaceholder && store?.searchTerm) {
        try {
          const options = {
            matchCase: store.matchCase,
            wholeWord: store.wholeWord,
            useRegex: store.useRegex
          }
          const recalculated = findMatchesInDoc(editorInstance.state.doc, store.searchTerm, options)
          matchesForApply = recalculated.map(m => ({ ...m, blockId, editorType, editor: editorInstance }))
        } catch (e) {
          matchesForApply = editorMatches
        }
      }

      // 只有当全局 active match 属于此编辑器时，才计算 localActiveIndex
      let localActiveIndex = -1
      if (globalActiveIndex >= 0 && globalActiveIndex < matches.length) {
        const activeMatch = matches[globalActiveIndex]
        if (activeMatch.blockId === blockId && activeMatch.editorType === editorType) {
          const editorMatchesInGlobal = matches.filter(m => m.blockId === blockId && m.editorType === editorType)
          const relativeIndex = editorMatchesInGlobal.indexOf(activeMatch)
          
          if (relativeIndex !== -1 && relativeIndex < matchesForApply.length) {
            localActiveIndex = relativeIndex
          } else if (matchesForApply.length > 0) {
            // 回退：如果找不到相对索引，但 active match 确实在此编辑器中，则高亮第一个
            localActiveIndex = 0
          }
        }
      }
      
      if (editorInstance.commands.applyFindReplaceHighlights) {
        editorInstance.commands.applyFindReplaceHighlights(matchesForApply, localActiveIndex)
      }

    } else {
      // 当前搜索结果不包含该编辑器，清除其高亮
      if (editorInstance.commands.clearFindReplaceHighlights) {
        editorInstance.commands.clearFindReplaceHighlights()
      }
    }
  })
}

/**
 * Command: Update search term and find matches
 */
export function searchCommand(searchTerm, options = {}) {
  return (state, dispatch) => {
    if (dispatch) {
      const tr = state.tr.setMeta(findReplacePluginKey, {
        searchTerm,
        options
      })
      dispatch(tr)
    }
    return true
  }
}

/**
 * Command: Set active match index
 */
export function setActiveMatchCommand(index) {
  return (state, dispatch) => {
    if (dispatch) {
      const tr = state.tr.setMeta(findReplacePluginKey, {
        activeIndex: index
      })
      dispatch(tr)
    }
    return true
  }
}

/**
 * Command: Replace current match
 */
export function replaceCurrentCommand(replaceTerm) {
  return (state, dispatch, view) => {
    const pluginState = findReplacePluginKey.getState(state)
    if (!pluginState || pluginState.activeIndex < 0) return false

    const match = pluginState.matches[pluginState.activeIndex]
    if (!match) return false

    if (dispatch) {
      if (match.editorType === 'main') {
        // 主编辑器的替换
        const tr = state.tr.replaceWith(match.from, match.to, state.schema.text(replaceTerm))
        dispatch(tr)
      } else {
        // 子编辑器的替换
        if (match.editor && !match.editor.isDestroyed) {
          const tr = match.editor.state.tr.replaceWith(
            match.from, 
            match.to, 
            match.editor.state.schema.text(replaceTerm)
          )
          match.editor.view.dispatch(tr)
        }
      }

      // Re-search after replace will happen automatically via docChanged
    }
    return true
  }
}

/**
 * 激活一个未激活的子编辑器并等待其初始化
 * @param {string} blockId - Block ID
 * @param {string} editorType - Editor type
 * @param {Object} audioEditorsStore - Audio editors store instance
 * @param {Object} audioRuntimeStore - Audio runtime store instance
 * @returns {Promise<Object|null>} 返回编辑器实例或 null
 */
async function activateAndWaitForEditor(blockId, editorType, audioEditorsStore, audioRuntimeStore) {
  // 切换到目标 tab
  audioRuntimeStore.updateRuntime(blockId, { activeTab: editorType })
  
  // 等待 Vue 渲染
  await new Promise(resolve => setTimeout(resolve, 100))
  
  // 等待编辑器实例注册（最多等待 2 秒）
  let attempts = 0
  while (attempts < 20) {
    const instances = audioEditorsStore.getAllEditors
    const found = instances.find(
      inst => inst.blockId === blockId && inst.editorType === editorType
    )
    if (found && found.editor && found.editor.view && found.editor.view.state) {
      return found.editor
    }
    await new Promise(resolve => setTimeout(resolve, 100))
    attempts++
  }
  
  return null
}

/**
 * Command: Replace all matches
 * 注意：这个命令会异步执行，因为需要激活未激活的编辑器
 */
export function replaceAllCommand(replaceTerm, audioEditorsStore, audioRuntimeStore, findReplaceStore) {
  return (state, dispatch) => {
    const pluginState = findReplacePluginKey.getState(state)
    if (!pluginState || pluginState.matches.length === 0) return false

    if (dispatch) {
      // 立即启动异步替换流程
      performReplaceAll(state, dispatch, pluginState, replaceTerm, audioEditorsStore, audioRuntimeStore, findReplaceStore)
    }
    return true
  }
}

/**
 * 执行全部替换的异步流程
 */
async function performReplaceAll(state, dispatch, pluginState, replaceTerm, audioEditorsStore, audioRuntimeStore, findReplaceStore) {
  // 分组匹配：主编辑器和各个子编辑器
  const mainMatches = []
  const subEditorMatches = {} // { 'blockId-editorType': matches[] }
  const allSubEditorKeys = new Set() // 所有需要处理的子编辑器

  pluginState.matches.forEach(match => {
    if (match.editorType === 'main') {
      mainMatches.push(match)
    } else {
      const key = `${match.blockId}-${match.editorType}`
      if (!subEditorMatches[key]) {
        subEditorMatches[key] = []
      }
      subEditorMatches[key].push(match)
      allSubEditorKeys.add(key)
    }
  })

  // 获取搜索选项
  const searchOptions = {
    matchCase: findReplaceStore?.matchCase ?? false,
    wholeWord: findReplaceStore?.wholeWord ?? false,
    useRegex: findReplaceStore?.useRegex ?? false
  }
  const searchTerm = findReplaceStore?.searchTerm ?? ''

  // 1. 替换主编辑器的匹配项
  if (mainMatches.length > 0) {
    let tr = state.tr
    const reversedMatches = [...mainMatches].reverse()
    reversedMatches.forEach(match => {
      tr = tr.replaceWith(match.from, match.to, state.schema.text(replaceTerm))
    })
    dispatch(tr)
  }

  // 2. 逐个激活并替换每个子编辑器
  // 这样可以确保在任何时刻只有一个子编辑器是激活的，避免切换时销毁其他编辑器
  if (audioEditorsStore && audioRuntimeStore && allSubEditorKeys.size > 0) {
    for (const key of allSubEditorKeys) {
      const lastDashIndex = key.lastIndexOf('-')
      const blockId = key.substring(0, lastDashIndex)
      const editorType = key.substring(lastDashIndex + 1)
      
      // 激活这个编辑器（如果未激活）
      const runtime = audioRuntimeStore.getRuntime(blockId)
      const currentTab = runtime?.activeTab
      if (currentTab !== editorType) {
        // 需要切换
        const editor = await activateAndWaitForEditor(blockId, editorType, audioEditorsStore, audioRuntimeStore)
        if (!editor) {
          continue
        }
      }
      
      // 现在这个编辑器应该是激活的，从 audioEditorsStore 获取最新实例
      const instances = audioEditorsStore.getAllEditors
      const found = instances.find(
        inst => inst.blockId === blockId && inst.editorType === editorType
      )
      
      if (!found || !found.editor || found.editor.isDestroyed) {
        continue
      }
      
      const editor = found.editor
      
      // 重新搜索以获取最新位置
      let matchesForReplace = []
      if (searchTerm) {
        const realMatches = findMatchesInDoc(editor.state.doc, searchTerm, searchOptions)
        matchesForReplace = realMatches
      }
      
      if (matchesForReplace.length > 0) {
        let tr = editor.state.tr
        const reversedMatches = [...matchesForReplace].reverse()
        reversedMatches.forEach(match => {
          tr = tr.replaceWith(match.from, match.to, editor.state.schema.text(replaceTerm))
        })
        
        editor.view.dispatch(tr)
        
        // 给一点时间让替换生效
        await new Promise(resolve => setTimeout(resolve, 50))
      }
    }
  }
  
  // 3. 替换完成后，清理搜索状态
  if (findReplaceStore) {
    findReplaceStore.reset()
  }
}

/**
 * Command: Clear search
 */
export function clearSearchCommand() {
  return (state, dispatch) => {
    if (dispatch) {
      const tr = state.tr.setMeta(findReplacePluginKey, {
        searchTerm: '',
        options: {}
      })
      dispatch(tr)
    }
    return true
  }
}

/**
 * Get current plugin state
 */
export function getPluginState(state) {
  return findReplacePluginKey.getState(state)
}
