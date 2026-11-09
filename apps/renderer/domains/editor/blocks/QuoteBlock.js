import { renderWorkspaceTextBlock } from '@linnya/markdown-document-core/workspace-presentation'
import { Node, mergeAttributes } from '@tiptap/core'
import { DOMParser as PMDOMParser } from '@tiptap/pm/model'
import { generateBlockId } from '../../../shared/utils/idUtils'

// 展开 <blockquote> 内的 <p>/<div>，过滤纯空白，返回 Fragment
const parseInlineContent = (domNode, schema) => {
  const fragment = document.createDocumentFragment();

  const appendChildNodes = (node) => {
    node.childNodes.forEach(child => {
      // 1: element, 3: text
      if (child.nodeType === 1 && ['P', 'DIV'].includes(child.nodeName)) {
        appendChildNodes(child);
      } else if (child.nodeType === 3 && !child.textContent.trim()) {
        // 跳过纯空白文本
      } else {
        fragment.appendChild(child.cloneNode(true));
      }
    });
  };

  appendChildNodes(domNode);

  return PMDOMParser.fromSchema(schema)
    .parseSlice(fragment, { preserveWhitespace: 'full' })
    .content;
};

/**
 * QuoteBlock 扩展
 * 实现引用块功能，支持 Markdown 语法 > 
 */
export const QuoteBlock = Node.create({
  name: 'quoteBlock',
  
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
        class: 'quote-block',
      },
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
        default: 'quote',
        parseHTML: element => element.getAttribute('data-block-type') || 'quote',
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
      // 缩进级别
      indent: {
        default: 0,
        parseHTML: element => parseInt(element.getAttribute('data-indent') || '0', 10),
        // renderHTML 已移除，将在主 renderHTML 方法中处理
      },
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
  
  // 定义节点的HTML结构
  renderHTML({ node }) {
    return renderWorkspaceTextBlock(node, document)
  },
  
  // 从HTML解析节点
  parseHTML() {
    return [
      {
        tag: 'div[data-node-type="quoteBlock"]',
      },
      {
        tag: 'div[data-type="quote-block"]',
      },
      {
        tag: 'blockquote',
        priority: 50,
        getContent: (domNode, schema) => parseInlineContent(domNode, schema),
      },
    ]
  },
  
  // 添加命令
  addCommands() {
    return {
      // 设置当前节点为引用块
      setQuoteBlock: () => ({ commands }) => {
        return commands.setNode(this.name);
      },
      
      // 更新空状态
      updateEmptyState: (isEmpty) => ({ commands }) => {
        return commands.updateAttributes(this.name, { isEmpty });
      }
    };
  },
  
  // 添加键盘快捷键
  addKeyboardShortcuts() {
    return {
      'Mod-Alt-9': () => this.editor.commands.toggleQuoteBlock(),
    }
  },
})

export default QuoteBlock
