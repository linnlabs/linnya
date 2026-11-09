import { renderWorkspaceTextBlock, workspaceListNumbers } from '@linnya/markdown-document-core/workspace-presentation'
import { Node, mergeAttributes } from '@tiptap/core'
import { DOMParser as PMDOMParser } from '@tiptap/pm/model'
import { generateBlockId } from '../../../shared/utils/idUtils'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

// 解析 <li> 内内容，展开常见的 <p>/<div> 包裹并过滤空白，返回 Fragment
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
 * ListItemBlock 扩展
 * 实现无序列表项功能，支持 Markdown 语法（- 和 *）
 */
export const ListItemBlock = Node.create({
  name: 'listItemBlock',
  
  // 设置为块级节点，可以包含内联内容
  content: 'inline*',
  
  // 定义特性
  defining: true,
  selectable: true,
  draggable: false,
  isolating: false,
  
  // 添加选项
  addOptions() {
    return {
      HTMLAttributes: {
        class: 'list-item-block',
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
        default: 'listItem',
        parseHTML: element => element.getAttribute('data-block-type') || 'listItem',
        renderHTML: attributes => ({
          'data-block-type': attributes.blockType,
        })
      },
      // 列表项类型 (bullet 或 future: ordered, task)
      listType: {
        default: 'bullet',
        parseHTML: element => element.getAttribute('data-list-type') || 'bullet',
        renderHTML: attributes => ({
          'data-list-type': attributes.listType,
        })
      },
      // 嵌套级别
      level: {
        default: 0,
        parseHTML: element => parseInt(element.getAttribute('data-list-level') || '0', 10),
        renderHTML: attributes => ({
          'data-list-level': attributes.level,
        })
      },
      // 有序列表起始号（仅对 listType==='ordered' 有意义）
      // 语义：
      //   null  → 跟随上一项 +1（或在新 run 起点默认从 1 开始）
      //   N>=0   → 在“此处”重起一个新的有序段，从 N 开始
      // 用户在 baseBlock 中输入 “5. ” 触发 ordered 转换时，会被赋值为 5；
      // Enter 拆分出的新项不会继承（见 SplitCommands），保持 null。
      start: {
        default: null,
        parseHTML: element => {
          const raw = element.getAttribute('data-list-start')
          if (raw === null || raw === '') return null
          const n = parseInt(raw, 10)
          return Number.isFinite(n) && n >= 0 ? n : null
        },
        renderHTML: attributes => {
          if (typeof attributes.start === 'number' && attributes.start >= 0) {
            return { 'data-list-start': String(attributes.start) }
          }
          return {}
        }
      },
      // Markdown 来源 marker；旧文档未保存时保持 canonical 导出，不猜原始写法。
      marker: {
        default: null,
        parseHTML: element => element.getAttribute('data-list-marker'),
        renderHTML: attributes => attributes.marker ? { 'data-list-marker': attributes.marker } : {},
      },
      // 来源中相邻列表项的间隔。旧文档没有这一事实时仍按松散列表导出。
      separatorBefore: {
        default: null,
        parseHTML: element => element.getAttribute('data-list-separator'),
        renderHTML: attributes => attributes.separatorBefore ? { 'data-list-separator': attributes.separatorBefore } : {},
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
  renderHTML({ HTMLAttributes, node }) {
    return renderWorkspaceTextBlock(node, document, mergeAttributes(this.options.HTMLAttributes, HTMLAttributes))
  },
  
  // 从HTML解析节点
  parseHTML() {
    return [
      {
        tag: 'div[data-node-type="listItemBlock"]',
      },
      {
        tag: 'div[data-type="list-item-block"]',
      },
      {
        tag: 'li',
        // 注意：粘贴 HTML 时，<li> 的父容器可能是 <ul> 或 <ol>
        // - <ul> -> bullet
        // - <ol> -> ordered
        getAttrs: (node) => {
          const el = node;
          const parentTag = el?.parentElement?.tagName;
          const listType = parentTag === 'OL' ? 'ordered' : 'bullet';
          return { listType };
        },
        getContent: (domNode, schema) => parseInlineContent(domNode, schema),
      },
    ]
  },
  
  // 添加键盘快捷键
  addKeyboardShortcuts() {
    return {
      'Mod-Alt-8': () => this.editor.commands.toggleListItem(),
    }
  },

  /**
   * 有序列表编号（根因修复 + start 语义）
   *
   * 说明：
   * - 我们的列表项是“一个列表项 = 一个 rootBlock”，并非 <ol><li> 的嵌套结构；
   * - CSS counter 无法在“兄弟块”之间可靠地做分段 reset；
   * - 因此这里用 ProseMirror 插件在每次文档变化时扫描 rootBlock 序列，
   *   给 ordered listItemBlock 渲染一个不可编辑的 widget 显示编号（不写入文档）。
   *
   * 编号策略：
   *   1) 若上一项不是同级 ordered（或被 baseBlock/heading 等打断）→ 新 run 起点，
   *      使用 attrs.start ?? 1 作为本项编号。
   *   2) 若 attrs.start >= 0 → 显式重起：本项编号 = start，后续兄弟跟随 +1。
   *   3) 否则跟随上一项 +1。
   *   4) 同 level 内连续；遇到更深 level 时重置更深计数器。
   */
  addProseMirrorPlugins() {
    const pluginKey = new PluginKey('orderedListNumbering')

    const buildDecorations = (doc, schema) => {
      const decorations = []
      for (const entry of workspaceListNumbers(doc)) {
        const level = entry.level
        const orderedIndex = String(entry.value)
        const widgetPos = entry.rootPosition + 2
        const rootBlockId = entry.rootId
        decorations.push(
          Decoration.widget(
            widgetPos,
            () => {
              const el = document.createElement('span')
              el.className = `ordered-list-number level-${level}`
              el.setAttribute('data-ordered-index', orderedIndex)
              // 点号后保留一个空格：更符合 Markdown/常见编辑器的编号展示习惯
              el.textContent = `${orderedIndex}. `
              el.setAttribute('contenteditable', 'false')
              el.setAttribute('aria-hidden', 'true')
              return el
            },
            {
              key: `ordered-list-number-${rootBlockId}`,
              side: -1,
              ignoreSelection: true,
            },
          ),
        )
      }

      return DecorationSet.create(doc, decorations)
    }

    return [
      new Plugin({
        key: pluginKey,
        state: {
          init: (_config, state) => buildDecorations(state.doc, state.schema),
          apply: (tr, oldDecorations, _oldState, newState) => {
            // 文档未变化时直接映射，避免不必要重算
            if (!tr.docChanged) {
              return oldDecorations.map(tr.mapping, tr.doc)
            }
            return buildDecorations(newState.doc, newState.schema)
          },
        },
        props: {
          decorations: (state) => pluginKey.getState(state),
        },
      }),
    ]
  },
})

export default ListItemBlock
