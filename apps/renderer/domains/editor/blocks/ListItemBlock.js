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
      //   N>0   → 在“此处”重起一个新的有序段，从 N 开始
      // 用户在 baseBlock 中输入 “5. ” 触发 ordered 转换时，会被赋值为 5；
      // Enter 拆分出的新项不会继承（见 SplitCommands），保持 null。
      start: {
        default: null,
        parseHTML: element => {
          const raw = element.getAttribute('data-list-start')
          if (raw === null || raw === '') return null
          const n = parseInt(raw, 10)
          return Number.isFinite(n) && n > 0 ? n : null
        },
        renderHTML: attributes => {
          if (typeof attributes.start === 'number' && attributes.start > 0) {
            return { 'data-list-start': String(attributes.start) }
          }
          return {}
        }
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
    // 创建外层元素
    const outer = document.createElement('div')
    // 外层容器主要用于：
    // - 承载占位符（PlaceholderPlugin 会把 data-placeholder / is-empty 等挂在外层）
    // - 承载装饰元素（如 ::before 的列表符号/编号），避免污染正文颜色
    // - 作为 CSS counter 的作用域节点（有序列表编号在这里做 counter-increment）
    outer.className = `list-item-block-outer level-${node.attrs.level} list-type-${node.attrs.listType}`
    outer.setAttribute('data-node-type', 'listItemBlockOuter')
    // 让样式层能在外层直接判断 listType / level（跨 rootBlock 编号需要）
    outer.setAttribute('data-list-type', node.attrs.listType)
    outer.setAttribute('data-list-level', node.attrs.level)
    
    // 将 level 渲染为 data-indent 以供 placeholder CSS 使用
    outer.setAttribute('data-indent', node.attrs.level);
    
    // ++ 文字颜色继承策略：仅将文字色应用到外层容器（用于控制装饰元素） ++
    // 背景色由 RootBlock 控制（保持圆角）
    // 注意：不再直接设置 color 样式，而是设置 CSS 变量，
    // 防止文本内容意外继承块颜色（文本颜色应完全由 Mark 控制）。
    if (node.attrs.textColor) {
      outer.setAttribute('data-text-color', node.attrs.textColor);
      const textCssVar = `--block-text-${node.attrs.textColor.replace('_text', '')}`;
      // 设置一个局部变量，供伪元素（如列表点、引用线）使用，而不影响主文本
      outer.style.setProperty('--local-block-text-color', `var(${textCssVar})`);
    }
    // ++ 颜色继承策略结束 ++
    
    // 创建内层元素，这次它将直接作为 contentDOM
    const inner = document.createElement('div')
    // 合并传入的 HTMLAttributes 和我们定义的 class、属性
    const mergedAttributes = mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
      class: `list-item-block editor-block level-${node.attrs.level}`,
      'data-node-type': 'listItemBlock',
      'data-type': 'list-item-block',
      'data-block-id': node.attrs.id,
      'data-list-type': node.attrs.listType,
      'data-list-level': node.attrs.level
    });
    // 应用所有属性到 inner 元素
    Object.entries(mergedAttributes).forEach(([key, value]) => {
      inner.setAttribute(key, value);
    });
    
    // 设置其他属性
    if (node.attrs.blockType) {
      inner.setAttribute('data-block-type', node.attrs.blockType)
    }
    
    // 将 level 渲染为 data-indent 以供文本缩进（虽然这里没有单独的文本缩进，但保持一致性）
    inner.setAttribute('data-indent', node.attrs.level);
    
    if (node.attrs.textAlign && node.attrs.textAlign !== 'left') {
      inner.style.textAlign = node.attrs.textAlign
    }
    
    // 设置是否为空
    const isEmpty = node.content.size === 0
    inner.setAttribute('data-is-empty', isEmpty ? 'true' : 'false')
    
    // 组装DOM结构
    outer.appendChild(inner)
    
    // 返回 DOM 和 contentDOM
    return {
      dom: outer,
      contentDOM: inner
    }
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
   *   2) 若 attrs.start > 0 → 显式重起：本项编号 = start，后续兄弟跟随 +1。
   *   3) 否则跟随上一项 +1。
   *   4) 同 level 内连续；遇到更深 level 时重置更深计数器。
   */
  addProseMirrorPlugins() {
    const pluginKey = new PluginKey('orderedListNumbering')

    const buildDecorations = (doc, schema) => {
      const decorations = []
      const listItemType = schema.nodes.listItemBlock

      // level 目前约束在 0~3（和现有 Tab/Shift+Tab 行为一致）
      const counters = [0, 0, 0, 0]
      const resetCounters = () => {
        counters[0] = 0
        counters[1] = 0
        counters[2] = 0
        counters[3] = 0
      }
      // 标记“当前位置上一项是同 level 的 ordered 项”——否则视为新 run 起点
      // 注意：单纯按“上一个 rootBlock 是 ordered listItem”不够精细，level 也需要匹配，
      // 否则同 ordered 段中切换 level 时无法继续编号。这里用每个 level 维护“是否在 run 中”。
      const inRunByLevel = [false, false, false, false]

      // doc -> rootBlock -> contentBlock（固定结构）
      doc.forEach((rootBlockNode, rootBlockPos) => {
        if (!rootBlockNode || rootBlockNode.type.name !== 'rootBlock') {
          resetCounters()
          inRunByLevel[0] = false
          inRunByLevel[1] = false
          inRunByLevel[2] = false
          inRunByLevel[3] = false
          return
        }

        const contentNode = rootBlockNode.firstChild
        const isOrderedListItem =
          !!contentNode &&
          contentNode.type === listItemType &&
          contentNode.attrs &&
          contentNode.attrs.listType === 'ordered'

        if (!isOrderedListItem) {
          // 任何非 ordered listItem 都打断所有层级的 run
          resetCounters()
          inRunByLevel[0] = false
          inRunByLevel[1] = false
          inRunByLevel[2] = false
          inRunByLevel[3] = false
          return
        }

        const rawLevel = typeof contentNode.attrs.level === 'number' ? contentNode.attrs.level : 0
        const level = Math.max(0, Math.min(3, rawLevel))
        const explicitStartRaw = contentNode.attrs.start
        const explicitStart =
          typeof explicitStartRaw === 'number' && Number.isFinite(explicitStartRaw) && explicitStartRaw > 0
            ? Math.floor(explicitStartRaw)
            : null

        // 决定本项编号
        let currentNumber
        if (explicitStart !== null) {
          // 显式重起（包括用户输入 “5. ” 这种情况）
          currentNumber = explicitStart
        } else if (!inRunByLevel[level]) {
          // 新 run 起点：默认从 1 开始
          currentNumber = 1
        } else {
          // 跟随上一项 +1
          currentNumber = counters[level] + 1
        }

        counters[level] = currentNumber
        inRunByLevel[level] = true
        // 进入更深层级前先把更深 counter / run 状态清掉
        for (let i = level + 1; i <= 3; i += 1) {
          counters[i] = 0
          inRunByLevel[i] = false
        }

        const orderedIndex = String(currentNumber)

        // contentNode 在 rootBlock 的第一个子节点位置：rootBlockPos + 1
        // 在 listItemBlock 的内容起始位置插入一个“编号 DOM”，避免使用 ::before 被 overflow 裁切
        const contentPos = rootBlockPos + 1
        const widgetPos = contentPos + 1
        const rootBlockId = typeof rootBlockNode.attrs?.id === 'string' ? rootBlockNode.attrs.id : String(rootBlockPos)
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
      })

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
