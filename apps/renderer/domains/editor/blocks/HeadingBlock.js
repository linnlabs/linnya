import { renderWorkspaceTextBlock } from '@linnya/markdown-document-core/workspace-presentation'
// src/renderer/extensions/blocks/HeadingBlock.js

import { Node, mergeAttributes } from '@tiptap/core'
import { generateBlockId } from '../../../shared/utils/idUtils'

/**
 * HeadingBlock 扩展
 * 实现六级标题功能，支持 Markdown 语法
 */
export const HeadingBlock = Node.create({
  name: 'headingBlock',
  
  // 设置为块级节点，可以包含内联内容
  content: 'inline*',
  
  // 定义特性
  defining: true,
  selectable: true,
  draggable: false,
  
  // 添加选项
  addOptions() {
    return {
      HTMLAttributes: {
        class: 'heading-block',
      },
      levels: [1, 2, 3, 4, 5, 6],
      // 占位符已移至 PlaceholderPlugin
    }
  },
  
  // 添加属性
  addAttributes() {
    return {
      // 块的唯一ID
      id: {
        default: () => generateBlockId(),
        parseHTML: (element) => element.getAttribute('data-block-id') || generateBlockId(),
        renderHTML: attributes => ({
          'data-block-id': attributes.id,
        })
      },
      // 块的类型标识
      blockType: {
        default: 'heading',
        parseHTML: element => element.getAttribute('data-block-type') || 'heading',
        renderHTML: attributes => ({
          'data-block-type': attributes.blockType,
        })
      },
      // 标题级别
      level: {
        default: 1,
        parseHTML: element => {
          const level = parseInt(element.getAttribute('data-heading-level') || element.tagName.replace(/[^\d]/g, ''), 10)
          return level && this.options.levels.includes(level) ? level : 1
        },
        renderHTML: attributes => ({
          'data-heading-level': attributes.level,
          class: `heading-level-${attributes.level}`
        })
      },
      // 文本对齐
      textAlign: {
        default: 'left',
        parseHTML: element => element.style.textAlign || 'left',
        renderHTML: attributes => {
          if (attributes.textAlign === 'left') {
            return {}
          }
          
          return {
            style: `text-align: ${attributes.textAlign}`,
          }
        }
      },
      // 新增：缩进级别
      indent: {
        default: 0,
        parseHTML: element => parseInt(element.getAttribute('data-indent') || '0', 10),
        // renderHTML 已移除，将在主 renderHTML 方法中处理
      },
      // 占位符属性已移至 PlaceholderPlugin
      // 是否可折叠
      collapsible: {
        default: false,
        parseHTML: element => element.getAttribute('data-collapsible') === 'true',
        renderHTML: attributes => ({
          'data-collapsible': attributes.collapsible ? 'true' : 'false',
        })
      },
      // 是否已折叠
      collapsed: {
        default: false,
        parseHTML: element => element.getAttribute('data-collapsed') === 'true',
        renderHTML: attributes => ({
          'data-collapsed': attributes.collapsed ? 'true' : 'false',
        })
      },
      // 块背景色（如：red_bg, blue_bg, null 为无颜色）
      backgroundColor: {
        default: null,
        parseHTML: element => element.getAttribute('data-bg-color') || null,
        renderHTML: attributes => {
          if (attributes.backgroundColor) {
            return { 'data-bg-color': attributes.backgroundColor };
          }
          return {};
        }
      },
      // 块文字色（如：red_text, blue_text, null 为无颜色）
      textColor: {
        default: null,
        parseHTML: element => element.getAttribute('data-text-color') || null,
        renderHTML: attributes => {
          if (attributes.textColor) {
            return { 'data-text-color': attributes.textColor };
          }
          return {};
        }
      }
    }
  },
  
  // 定义节点的HTML结构
  renderHTML({ node }) {
    return renderWorkspaceTextBlock(node, document)
  },
  
  // 从HTML解析节点
  parseHTML() {
    return [
      {
        tag: 'div[data-node-type="headingBlock"]',
      },
      {
        tag: 'div[data-type="heading-block"]',
      },
      ...this.options.levels.map(level => ({
        tag: `h${level}`,
        getAttrs: node => ({ level }),
      })),
    ]
  },
  
  // 添加命令
  addCommands() {
    return {
      // 命令已移至 ConversionCommands.js
    }
  },
  
  // 添加键盘快捷键
  addKeyboardShortcuts() {
    return {
      'Mod-Alt-1': () => this.editor.commands.toggleHeading({ level: 1 }),
      'Mod-Alt-2': () => this.editor.commands.toggleHeading({ level: 2 }),
      'Mod-Alt-3': () => this.editor.commands.toggleHeading({ level: 3 }),
      'Mod-Alt-4': () => this.editor.commands.toggleHeading({ level: 4 }),
      'Mod-Alt-5': () => this.editor.commands.toggleHeading({ level: 5 }),
      'Mod-Alt-6': () => this.editor.commands.toggleHeading({ level: 6 }),
    }
  },
})

export default HeadingBlock
