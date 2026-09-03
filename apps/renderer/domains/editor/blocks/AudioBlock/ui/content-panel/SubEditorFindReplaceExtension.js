/**
 * 子编辑器查找替换扩展
 * 为 NotesTab 和 SummaryTab 的独立编辑器提供查找替换高亮支持
 */
import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from 'prosemirror-state'
import { Decoration, DecorationSet } from 'prosemirror-view'

const subEditorFindReplaceKey = new PluginKey('subEditorFindReplace')

/**
 * 创建子编辑器查找替换插件
 */
function createSubEditorFindReplacePlugin() {
  return new Plugin({
    key: subEditorFindReplaceKey,
    
    state: {
      init() {
        return {
          decorations: DecorationSet.empty,
          matches: [],
          activeIndex: -1
        }
      },
      
      apply(tr, pluginState) {
        // 从事务元数据获取查找替换信息
        const meta = tr.getMeta(subEditorFindReplaceKey)
        
        if (meta) {
          const { matches, activeIndex } = meta
          
          if (matches !== undefined) {
            // 创建装饰
            const decorations = matches.map((match, index) => {
              const isActive = index === activeIndex
              return Decoration.inline(match.from, match.to, {
                class: isActive ? 'find-replace-match-active' : 'find-replace-match',
                'data-match-index': index
              })
            })
            
            const decoSet = DecorationSet.create(tr.doc, decorations)
            
            return {
              decorations: decoSet,
              matches,
              activeIndex: activeIndex ?? -1
            }
          }
        }
        
        // 文档变化时映射装饰
        if (tr.docChanged) {
          return {
            ...pluginState,
            decorations: pluginState.decorations.map(tr.mapping, tr.doc)
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
 * 子编辑器查找替换扩展
 */
export const SubEditorFindReplaceExtension = Extension.create({
  name: 'subEditorFindReplace',
  
  addProseMirrorPlugins() {
    return [createSubEditorFindReplacePlugin()]
  },
  
  addCommands() {
    return {
      /**
       * 应用查找替换高亮
       */
      applyFindReplaceHighlights: (matches, activeIndex) => ({ state, dispatch }) => {
        if (dispatch) {
          const tr = state.tr.setMeta(subEditorFindReplaceKey, {
            matches,
            activeIndex
          })
          dispatch(tr)
        }
        return true
      },
      
      /**
       * 清除查找替换高亮
       */
      clearFindReplaceHighlights: () => ({ state, dispatch }) => {
        if (dispatch) {
          const tr = state.tr.setMeta(subEditorFindReplaceKey, {
            matches: [],
            activeIndex: -1
          })
          dispatch(tr)
        }
        return true
      }
    }
  }
})

