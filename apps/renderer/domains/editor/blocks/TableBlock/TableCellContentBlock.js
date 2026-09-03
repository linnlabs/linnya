//src/renderer/features/TableBlock/TableCellContentBlock.js

import { Node } from '@tiptap/core';
import { mergeAttributes } from '@tiptap/core';
import { DOMParser as PMDOMParser, Fragment } from '@tiptap/pm/model';
import { generateBlockId } from '../../../../shared/utils/idUtils';

/**
 * 解析 DOM 节点为“仅内联”的 Fragment，用于 tableCellContentBlock。
 *
 * 说明（Word 表格粘贴乱）：
 * - Word 的表格单元格里通常是 `<p class="MsoNormal">...</p>`；
 * - 我们的 `BaseBlock.parseHTML()` 会把 `<p>` 解析成 `baseBlock`（块级节点）；
 * - 但 `tableCellContentBlock` 的 schema 是 `inline*`，不允许嵌套 `baseBlock` 这类块节点；
 * - 结果 ProseMirror 会在粘贴时做结构“纠错/提升”，导致表格内容被拆乱。
 *
 * 这里把 parseSlice 得到的结果做一次“扁平化”：
 * - 内联节点（text/marks/hardBreak/...）直接保留；
 * - 块节点（如 baseBlock/headingBlock/...）只取它们的 `content`（通常就是 inline*）；
 * - 多个块之间用 hardBreak 连接（尽量保留段落语义，但不引入块结构）。
 *
 * @param {HTMLElement} domNode
 * @param {import('@tiptap/pm/model').Schema} schema
 * @returns {import('@tiptap/pm/model').Fragment}
 */
function parseInlineFragmentFromDom(domNode, schema) {
  const parser = PMDOMParser.fromSchema(schema);
  const slice = parser.parseSlice(domNode, { preserveWhitespace: 'full' });

  const inlineNodes = [];
  const hardBreakType = schema.nodes.hardBreak || null;

  /**
   * 将任意节点“下压”为内联序列。
   * @param {import('@tiptap/pm/model').Node} node
   */
  const pushInlineFromNode = (node) => {
    if (!node) return;

    // 直接是内联节点（text / hardBreak / emoji / mention / marks 等）
    if (node.isInline) {
      inlineNodes.push(node);
      return;
    }

    // 块节点：只取其内容，继续递归下压
    if (node.isBlock || node.isTextblock) {
      node.forEach((child) => pushInlineFromNode(child));
      return;
    }

    // 其他节点类型（理论上不会出现在这里），忽略
  };

  // slice.content 可能包含：
  // - 直接内联（例如 <span>、纯文本）
  // - 一个 baseBlock（来自 <p> 规则）
  // - 多个 baseBlock（例如 <div><p>..</p><p>..</p></div>）
  let blockCount = 0;
  slice.content.forEach((node) => {
    const isBlockLike = node.isBlock || node.isTextblock;

    if (isBlockLike) {
      if (blockCount > 0 && hardBreakType) {
        // 多段之间用换行分隔，避免把段落结构带入 inline* 容器
        inlineNodes.push(hardBreakType.create());
      }
      blockCount += 1;
    }

    pushInlineFromNode(node);
  });

  return Fragment.fromArray(inlineNodes);
}

/**
 * TableCellContentBlock 节点定义
 * -------------------------------------------------------------------------
 * 类型：Node (Tiptap 节点)
 * 名称：'tableCellContentBlock'
 *
 * 目标：
 * - 作为表格单元格 (tableCell / tableHeader) 内部唯一的内容容器。
 * - 提供一个极简的、专注于内联内容 (inline*) 的编辑环境。
 * - 为 AI 功能（如数据提取、内容回填）提供清晰、一致的内容访问点。
 *
 * Schema 定义：
 * - name: 'tableCellContentBlock'
 * - content: 'inline*'
 *   - 只允许包含文本 (text) 和行内标记 (marks like bold, italic, link)。
 *   - 不允许嵌套其他块级节点 (如 paragraph, codeBlock 等)。
 *   - 用户可以通过 Shift+Enter (产生 <br>) 在视觉上换行。
 * - group: 'block'
 *   - 逻辑上是一个块级单位，这样 tableCell/tableHeader 的 content schema ('tableCellContentBlock')
 *     才能正确解析和验证 (因为 tableCell/tableHeader 通常期望其内容为 'block+' 或类似)。
 * - defining: true
 *   - 将其视为一个独立的编辑单元。当光标在其内部时，外部节点的边界不会轻易被跨越。
 *   - 这也有助于确保在复制粘贴或拖拽时，它作为一个整体被处理。
 * - draggable: false
 *   - 单元格内容块本身不期望能被拖拽。表格单元格的拖拽是更复杂的问题。
 * - selectable: true
 *   - 确保节点本身和其内容可选。
 * - code: false (Tiptap 默认为 false，意味着它不是一个代码块)
 * - isolating: false (通常不需要隔离，除非有非常特殊的剪切/粘贴或历史记录需求)
 *
 * 属性 (attrs):
 * - id:
 *   - 类型: string
 *   - 用途: 遵循项目标准的块 ID，用于唯一标识。
 *   - 默认值: 调用 generateBlockId() 生成。
 * - blockType:
 *   - 类型: string
 *   - 用途: 明确块类型，便于调试、样式化或特定逻辑处理。
 *   - 默认值: 'tableCellContent' (或类似的，用于清晰区分)。
 *
 * HTML 渲染 (renderHTML / toDOM):
 * - 标签: 'div' (或 'p'，但 'div' 更通用作为无语义容器)
 * - class: 'table-cell-content-block' (用于 CSS 样式化)
 * - data-attributes: 'data-block-id', 'data-block-type' (将节点属性渲染到 DOM)
 * - contentDOM: 渲染为该 'div' 元素本身 (用 0 表示)。
 * - CSS 建议:
 *   .table-cell-content-block {
 *     display: inline-block; // 或 block，取决于期望的填充行为
 *     width: 100%;           // 确保填满单元格宽度
 *     min-height: 1em;       // 避免空块塌陷
 *     white-space: pre-wrap; // 保留空白符序列和换行符，允许自动换行
 *     word-wrap: break-word; // 或 overflow-wrap: break-word，处理长单词或URL
 *     vertical-align: top;   // 与单元格内容对齐
 *     padding: 2px 4px;      // 适当的内边距，提升编辑体验
 *     outline: none;         // 移除焦点时的默认轮廓，由自定义样式控制
 *   }
 *
 * HTML 解析 (parseHTML / parseDOM):
 * - 主要匹配 <div class="table-cell-content-block" data-block-type="tableCellContent">
 * - 可能需要提供从普通 <p> 或 <div> (例如从外部粘贴的内容) 到 tableCellContentBlock 的转换规则，
 *   但这需要小心处理，以避免意外转换。对于 MVP，主要依赖编辑器内部创建。
 *
 * 命令 (Commands) / 快捷键 (KeyboardShortcuts):
 * - 初期可能不需要定义特殊的命令或快捷键。
 * - 如果需要处理 Enter 键（例如，如果未来允许内部创建段落），则会在这里添加。
 *   但当前 'inline*' 内容模型下，Enter 键通常由更高层或浏览器默认行为处理（可能插入<br>）。
 */
export const TableCellContentBlock = Node.create({
  name: 'tableCellContentBlock',
  
  // 内容模型：只允许内联内容
  content: 'inline*',
  
  // 分组：逻辑上是块，以便能被 tableCell/tableHeader 的 'block+' content 接受
  group: 'block',
  
  // 视为独立编辑单元
  defining: true,
  
  // 不可拖拽
  draggable: false,
  
  // 可选择
  selectable: true,

  // 不是代码块
  code: false,

  // 通常不隔离
  isolating: false,

  addAttributes() {
    return {
      id: {
        default: () => generateBlockId(),
        parseHTML: element => element.getAttribute('data-block-id') || generateBlockId(),
        renderHTML: attributes => ({ 'data-block-id': attributes.id }),
      },
      blockType: {
        default: 'tableCellContent',
        parseHTML: element => element.getAttribute('data-block-type') || 'tableCellContent',
        renderHTML: attributes => ({ 'data-block-type': attributes.blockType }),
      },
      // 可根据需要添加其他属性，如 textAlign，但初期保持简单
      // textAlign: {
      //   default: 'left',
      //   parseHTML: element => element.style.textAlign || 'left',
      //   renderHTML: attributes => attributes.textAlign && attributes.textAlign !== 'left' ? { style: `text-align: ${attributes.textAlign}` } : {},
      // },
    };
  },

  addOptions() {
    return {
      HTMLAttributes: {
        class: 'table-cell-content-block', // 用于 CSS 样式和 parseHTML 匹配
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: `div[data-block-type="${this.name}"]`,
        priority: 100,
      },
      {
        tag: `div[data-block-type="tableCellContent"]`,
        priority: 100,
      },
      {
        tag: 'p',
        priority: 50,
        getAttrs: (domNode) => {
          // 只有当父元素是表格单元格时才解析
          const isInTableCell = domNode.closest('td, th, [data-type="tableCell"], [data-type="tableHeader"]');
          if (!isInTableCell) {
            return false;
          }
          return {};
        },
        // 关键：只返回“内联内容”，避免把 <p> 解析成 baseBlock 再嵌进 inline* 容器
        getContent: (domNode, schema) => parseInlineFragmentFromDom(domNode, schema),
      },
      {
        tag: 'div:not([data-block-type])',
        priority: 40,
        getAttrs: (domNode) => {
          // 只有当父元素是表格单元格时才解析
          const isInTableCell = domNode.closest('td, th, [data-type="tableCell"], [data-type="tableHeader"]');
          if (!isInTableCell) {
            return false;
          }
          
          // 避免重复解析我们自己的结构
          if (domNode.classList.contains(this.options.HTMLAttributes.class) && 
              domNode.getAttribute('data-block-id')) {
            return false; 
          }
          return {};
        },
        // 同样保证只返回内联内容（Word 有时会用 div 包 p）
        getContent: (domNode, schema) => parseInlineFragmentFromDom(domNode, schema),
      },
    ];
  },

  renderHTML({ HTMLAttributes, node }) {
    // HTMLAttributes 来自 addAttributes() 和 addOptions() 的合并
    // node.attrs 包含实际节点的属性值
    return ['div',
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        // 确保 data-attributes 从节点属性正确渲染
        'data-block-id': node.attrs.id,
        'data-block-type': node.attrs.blockType,
        // 如果有 textAlign 属性，也在这里处理
        // style: node.attrs.textAlign && node.attrs.textAlign !== 'left' ? `text-align: ${node.attrs.textAlign};` : null,
      }),
      0 // 0 表示这个 'div' 元素本身就是 contentDOM
    ];
  },

  // 在 'inline*' 内容模型下，通常不需要为这个节点本身添加特定的键盘快捷键来处理 Enter 等。
  // Shift+Enter 插入 <br> 的行为通常由 Tiptap 的 HardBreak 扩展处理 (如果已注册)。
  // 普通 Enter 键在 'inline*' 内容中若无特定处理，可能无效或行为取决于父节点或浏览器的默认。
  // 由于这是在 tableCell 内部，Enter 键通常用于单元格间的导航（由 TableKeyboardShortcut 扩展处理）。
  // addKeyboardShortcuts() {
  //   return {
  //     // 'Mod-Enter': () => this.editor.commands.splitBlock().run(), // 示例：如果想强制分裂
  //   };
  // }
});

export default TableCellContentBlock; 
