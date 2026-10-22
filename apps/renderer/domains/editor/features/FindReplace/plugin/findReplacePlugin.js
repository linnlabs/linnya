import { Plugin, PluginKey } from 'prosemirror-state'
import { Decoration, DecorationSet } from 'prosemirror-view'

export const findReplacePluginKey = new PluginKey('findReplace')

/**
 * 在主 Markdown Editor 文档中查找匹配项。
 * AudioBlock 退出生产 schema 后，FindReplace 不再维护第二套子编辑器搜索模型。
 */
export function findMatchesInDoc(doc, searchTerm, options = {}) {
  if (!searchTerm) return []

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
  } catch {
    return []
  }

  doc.descendants((node, pos, parent, index) => {
    // 原子块通过 Tiptap renderText 暴露可读文字；只产生一个整块定位结果，禁止将数据属性当行内文字替换。
    if (!node.isText && node.isAtom && node.type.spec.toText) {
      pattern.lastIndex = 0
      const match = pattern.exec(node.type.spec.toText({ node, pos, parent, index, range: { from: pos, to: pos + node.nodeSize } }))
      if (match) matches.push({ from: pos, to: pos + node.nodeSize, text: match[0], editorType: 'main', replaceable: false })
      return false
    }
    if (!node.isText) return

    pattern.lastIndex = 0
    let match
    while ((match = pattern.exec(node.text)) !== null) {
      const from = pos + match.index
      matches.push({
        from,
        to: from + match[0].length,
        text: match[0],
        editorType: 'main',
      })
      if (match.index === pattern.lastIndex) pattern.lastIndex += 1
    }
  })

  return matches
}

function createDecorations(doc, matches, activeIndex) {
  const decorations = matches.map((match, index) => {
    const attrs = {
      class: index === activeIndex ? 'find-replace-match-active' : 'find-replace-match',
      'data-match-index': index,
    }
    return match.replaceable === false ? Decoration.node(match.from, match.to, attrs) : Decoration.inline(match.from, match.to, attrs)
  })
  return DecorationSet.create(doc, decorations)
}

export function createFindReplacePlugin(store) {
  return new Plugin({
    key: findReplacePluginKey,
    state: {
      init() {
        return {
          decorations: DecorationSet.empty,
          matches: [],
          activeIndex: -1,
        }
      },
      apply(tr, pluginState, _oldState, newState) {
        const meta = tr.getMeta(findReplacePluginKey)
        if (meta?.searchTerm !== undefined) {
          const matches = findMatchesInDoc(newState.doc, meta.searchTerm, meta.options)
          const activeIndex = meta.activeIndex ?? (matches.length > 0 ? 0 : -1)
          return {
            decorations: createDecorations(newState.doc, matches, activeIndex),
            matches,
            activeIndex,
          }
        }

        if (meta?.activeIndex !== undefined) {
          return {
            ...pluginState,
            decorations: createDecorations(newState.doc, pluginState.matches, meta.activeIndex),
            activeIndex: meta.activeIndex,
          }
        }

        if (tr.docChanged && store.searchTerm) {
          const matches = findMatchesInDoc(newState.doc, store.searchTerm, {
            matchCase: store.matchCase,
            wholeWord: store.wholeWord,
            useRegex: store.useRegex,
          })
          const activeIndex = pluginState.activeIndex >= matches.length
            ? (matches.length > 0 ? matches.length - 1 : -1)
            : pluginState.activeIndex
          return {
            decorations: createDecorations(newState.doc, matches, activeIndex),
            matches,
            activeIndex,
          }
        }

        return pluginState
      },
    },
    props: {
      decorations(state) {
        return this.getState(state)?.decorations
      },
    },
  })
}

export function searchCommand(searchTerm, options = {}) {
  return (state, dispatch) => {
    if (dispatch) {
      dispatch(state.tr.setMeta(findReplacePluginKey, { searchTerm, options }))
    }
    return true
  }
}

export function setActiveMatchCommand(index) {
  return (state, dispatch) => {
    if (dispatch) {
      dispatch(state.tr.setMeta(findReplacePluginKey, { activeIndex: index }))
    }
    return true
  }
}

export function replaceCurrentCommand(replaceTerm) {
  return (state, dispatch) => {
    const pluginState = findReplacePluginKey.getState(state)
    const match = pluginState?.matches[pluginState.activeIndex]
    if (!match || match.replaceable === false) return false

    if (dispatch) {
      dispatch(state.tr.replaceWith(match.from, match.to, replaceTerm ? state.schema.text(replaceTerm) : null))
    }
    return true
  }
}

export function replaceAllCommand(replaceTerm) {
  return (state, dispatch) => {
    const pluginState = findReplacePluginKey.getState(state)
    const replaceable = pluginState?.matches.filter(match => match.replaceable !== false) ?? []
    if (replaceable.length === 0) return false

    if (dispatch) {
      let tr = state.tr
      for (const match of [...replaceable].reverse()) {
        tr = tr.replaceWith(match.from, match.to, replaceTerm ? state.schema.text(replaceTerm) : null)
      }
      dispatch(tr.setMeta(findReplacePluginKey, { searchTerm: '', options: {} }))
    }
    return true
  }
}

export function clearSearchCommand() {
  return (state, dispatch) => {
    if (dispatch) {
      dispatch(state.tr.setMeta(findReplacePluginKey, { searchTerm: '', options: {} }))
    }
    return true
  }
}

export function getPluginState(state) {
  return findReplacePluginKey.getState(state)
}
