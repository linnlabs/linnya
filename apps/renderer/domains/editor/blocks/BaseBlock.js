import { renderWorkspaceTextBlock } from '@linnya/markdown-document-core/workspace-presentation'
// src/renderer/extensions/blocks/BaseBlock.js

import { Node, mergeAttributes } from '@tiptap/core'
import { generateBlockId } from '../../../shared/utils/idUtils'

/**
 * BaseBlock 扩展
 * 默认的基础内容块，类似于段落，是其他块类型的基础
 */
export const BaseBlock = Node.create({
  name: 'baseBlock',
  
  // 设置为块级节点，可以包含内联内容
  group: `block`,
  content: 'inline*',  // 这表明它是一个textblock，可以包含内联内容，包括文本
  
  // 定义特性 - 增加priority属性
  defining: true,
  selectable: true,
  draggable: false,
  priority: 1000,
  
  // 添加选项
  addOptions() {
    return {
      HTMLAttributes: {
        class: 'base-block',
      },
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
        default: 'base',
        parseHTML: element => element.getAttribute('data-block-type') || 'base',
        renderHTML: attributes => ({
          'data-block-type': attributes.blockType,
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
      // 是否为空
      isEmpty: {
        default: true,
        parseHTML: element => element.getAttribute('data-is-empty') === 'true',
        renderHTML: attributes => ({
          'data-is-empty': attributes.isEmpty ? 'true' : 'false',
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
  
  // 定义节点的HTML结构 - 使用两层DOM结构
  renderHTML({ node }) {
    return renderWorkspaceTextBlock(node, document)
  },
  
  // 从HTML解析节点
  parseHTML() {
    return [
      {
        tag: 'div[data-node-type="baseBlock"]',
        priority: 60, // 给自定义结构稍高优先级（可选）
      },
      {
        tag: 'div[data-type="base-block"]',
        priority: 60, // 给自定义结构稍高优先级（可选）
      },
      {
        tag: 'p',
        priority: 55, // 比默认的 ProseMirror p 规则优先级高一点，确保我们的 BaseBlock 被使用
        getAttrs: (domNode) => {
          /**
           * 避免Word 表格粘贴乱
           *
           * Word 的表格单元格里通常用 <p class="MsoNormal"> 包裹文本。
           * 如果这里把 <p> 解析成 baseBlock（块节点），就会被塞进 tableCell 内部；
           * 但我们单元格 schema 是 `tableCellContentBlock+`，其内容是 `inline*`，不允许块节点，
           * 于是 ProseMirror 在粘贴时会触发结构纠错/提升，最终表现为表格结构被拆乱。
           *
           * 处理策略：在表格单元格（td/th）内，禁止 BaseBlock 兜底解析 <p>，
           * 让 `TableCellContentBlock.parseHTML()` 的 <p> 规则接管并把内容扁平化为 inline*。
           */
          const isInTableCell = domNode?.closest?.('td, th, [data-type="tableCell"], [data-type="tableHeader"]')
          if (isInTableCell) {
            return false
          }
          return {}
        },
      },

    ]
  },
  
  // 添加命令
  addCommands() {
    return {
      // 设置当前节点为BaseBlock
      setBaseBlock: () => ({ commands }) => {
        return commands.setNode(this.name)
      },
      
      // 占位符相关命令已移至 PlaceholderPlugin
      
      // 更新空状态
      updateEmptyState: (isEmpty) => ({ commands, state }) => {
        return commands.updateAttributes(this.name, { isEmpty })
      }
      
      // 查询相关命令已移至 BlockQueryCommands.js
    }
  },
  
  // 添加事件处理
  addProseMirrorPlugins() {
    const extension = this;
    
    return [];
  }
})

export default BaseBlock
