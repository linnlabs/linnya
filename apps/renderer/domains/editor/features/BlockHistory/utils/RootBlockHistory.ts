
import { Node, mergeAttributes } from '@tiptap/core'
import { NODE_GROUPS } from '../../../extensions/core/schema'

/**
 * RootBlockHistory 扩展
 * 
 * 专门用于右侧历史版本的只读展示。
 * 结构与主编辑器 RootBlock 完全一致，但不挂载交互式 NodeView。
 */
export const RootBlockHistory = Node.create({
  name: 'rootBlock',
  
  // 分组保持一致，方便样式和选择器复用
  group: NODE_GROUPS.BLOCK_CONTAINER,
  // ⚠️ 注意：这里不再直接使用 NODE_GROUPS.BLOCK_CONTENT
  // 历史视图仅支持一部分块类型（文本 / 标题 / 列表 / 引用 / 代码），
  // 为了避免 schema 在解析 content expression 时去寻找不存在的节点类型
  //（例如 horizontalRuleBlock / imageBlock / audioBlock），
  // 这里手动列出历史视图允许的子节点类型。
  //
  // 这样既不破坏主编辑器的 Schema，又能保证 History Editor 自己的 Schema 是闭合的。
  content: 'baseBlock|headingBlock|listItemBlock|quoteBlock|codeBlock{1}',
  
  // 基础属性
  priority: 50,
  defining: true,
  // selectable: true, // 历史视图不需要选中块
  
  // 复用属性定义，确保渲染出的 HTML 包含 data-id, color 等所有视觉属性
  addAttributes() {
    return {
      // 唯一ID属性
      id: {
        default: null,
        parseHTML: element => element.getAttribute('data-id'),
        renderHTML: attributes => {
          if (!attributes.id) return {}
          return {
            'data-id': attributes.id,
          }
        }
      },
      // 历史版本保留完整批注实体，但不把内容复制到 DOM。
      annotations: {
        default: [],
        rendered: false,
      },
      // 位置属性
      position: {
        default: null,
        parseHTML: element => {
          const pos = element.getAttribute('data-position')
          return pos ? parseInt(pos, 10) : null
        },
        renderHTML: attributes => {
          if (attributes.position === null) return {}
          return {
            'data-position': attributes.position,
          }
        }
      },
      // 拖拽状态 (历史视图永远为 false)
      isDragging: {
        default: false,
        parseHTML: element => element.getAttribute('data-dragging') === 'true',
        renderHTML: attributes => {
          if (!attributes.isDragging) return {}
          return {
            'data-dragging': 'true',
          }
        }
      },
      // 背景颜色
      backgroundColor: {
        default: null,
        parseHTML: element => element.getAttribute('data-background-color') || null,
        renderHTML: attributes => {
          if (!attributes.backgroundColor) return {}
          return {
            'data-background-color': attributes.backgroundColor,
          }
        }
      },
      // 文字颜色
      textColor: {
        default: null,
        parseHTML: element => element.getAttribute('data-text-color') || null,
        renderHTML: attributes => {
          if (!attributes.textColor) return {}
          return {
            'data-text-color': attributes.textColor,
          }
        }
      }
    }
  },
  
  // 核心区别：不使用 addNodeView()
  // 而是直接依靠 renderHTML 输出符合 .root-block-outer / .root-block 结构的 DOM
  
  renderHTML({ HTMLAttributes }) {
    // 结构必须完全匹配 Block.css / block-layout.css 的选择器
    // .root-block-outer (data-node-type="rootBlockOuter")
    //   -> .root-block (data-node-type="rootBlock")
    //      -> content (0)
    
    return ['div', 
      mergeAttributes(
        { 
          class: 'root-block-outer', 
          'data-node-type': 'rootBlockOuter' 
        }, 
        HTMLAttributes
      ), 
      ['div', 
        { 
          class: 'root-block', 
          'data-node-type': 'rootBlock' 
        }, 
        0
      ]
    ]
  },
  
  parseHTML() {
    return [
      {
        tag: 'div.root-block-outer[data-id]',
      }
    ]
  }
})
