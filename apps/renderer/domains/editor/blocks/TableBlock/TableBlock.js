/**
 * TableBlock 节点定义方案 (基于方案: 单元格内容为 inline* 的轻量块)
 * -------------------------------------------------------------------------
 * 目标：为 AI 功能（批量填充、区域分析）提供稳定、简洁的表格基础，同时保持核心编辑体验。
 * 核心原则：将单元格内容 (`tableCellContentBlock`) 降至最轻量，仅包含 `inline*` 内容。
 *
 * 1. table
 *    - 顶级表格节点。
 *    - attrs: { id, blockType: 'table', withHeaderRow: boolean }
 *    - content: 'tableRow+'
 *
 * 2. tableRow
 *    - 表格行节点。
 *    - content: '(tableHeader | tableCell)+'
 *
 * 3. tableHeader
 *    - 表头单元格节点。
 *    - attrs: { colspan, rowspan, colwidth, align, style } (继承 Tiptap TableHeader，并保留项目样式属性)
 *    - content: 'tableCellContentBlock' (通过 .configure() 在 EditorContext.vue 中设置)
 *
 * 4. tableCell
 *    - 普通单元格节点。
 *    - attrs: { colspan, rowspan, colwidth, align, style } (继承 Tiptap TableCell，并保留项目样式属性)
 *    - content: 'tableCellContentBlock' (通过 .configure() 在 EditorContext.vue 中设置)
 *
 * 5. tableCellContentBlock (新节点，定义在 TableCellContentBlock.js 中)
 *    - 轻量级单元格内容容器。
 *    - name: 'tableCellContentBlock'
 *    - content: 'inline*' (只允许文本和行内标记，如 bold, italic, link, images 理论上也属于 inline)
 *    - group: 'block' (逻辑上是块，但非常轻量，且仅用于单元格内部)
 *    - defining: true (将其视为一个独立的编辑单元)
 *    - draggable: false
 *    - selectable: true (确保内容可选)
 *    - attrs: { id (blockId), blockType: 'tableCellContent' }
 *    - DOM: <div class="table-cell-content-block" data-block-id="...">...content...</div>
 *           CSS 将应用 display:inline-block; white-space:pre-wrap; 等确保其行为。
 *
 * 继承与配置：
 * - TableBlock 扩展自 @tiptap/extension-table。
 * - TableHeader 和 TableCell 将通过 Tiptap 的 `configure` 方法，将其默认的 `content`
 *   (通常是 'block+') 修改为 'tableCellContentBlock'。
 * - `insertTable` 命令需要重写，以确保在创建单元格时，自动插入 `tableCellContentBlock`
 *   作为其内容。
 *
 * AI 功能集成考虑：
 * - 通过这种结构，AI 获取单元格数据时，只需定位到 tableCellContentBlock 并获取其 textContent 或
 *   序列化的内联内容。
 * - AI 回填数据时，直接修改 tableCellContentBlock 的内容。
 * - 复杂的 AI 状态（如加载中）将通过 Decorations 实现，不污染节点属性。
 * - 所有 AI 操作通过 ProseMirror 事务完成，保证可撤销性。
 */

import { Table } from '@tiptap/extension-table';
import { generateBlockId, generateUUID } from '../../../../shared/utils/idUtils'; // 确认路径是否正确
import { KeyboardRegistry } from '../../extensions/keyboard/KeyboardRegistry';
import { CrossBlockNavigatorRegistry } from '../../extensions/keyboard/CrossBlockNavigatorRegistry';
import { navigateIntoTable } from './tableNavigators';

// 使用统一的命令注册模块，而不是直接导入命令
import { registerAllTableCommands } from './commands/registerTableCommands';

// TODO: 考虑是否需要自定义的 NodeView，如果表格需要像其他块一样有拖拽手柄等
// import { VueNodeViewRenderer } from '@tiptap/vue-3';
// import TableBlockView from '../../components/Block/TableBlockView.vue'; // 假设的视图组件

export const TableBlock = Table.extend({
  name: 'table', // 使用 Tiptap 默认的 'table' 名称，便于与原生命令和插件集成

  // 保持 Tiptap Table 扩展原有的 selectable, resizable 等特性
  // selectable: true, // Table 扩展默认为 true
  // resizable: true, // Table 扩展默认为 true

  // 如果希望 TableBlock 作为一个整体可以被拖拽（像其他 RootBlock 的子块一样），
  // 并且其拖拽逻辑由外部的 BlockView.vue 处理，这里 draggable 应为 false。
  // 如果 TableBlock 自身处理拖拽，则可以设为 true，但这通常不与 RootBlock 结构兼容。
  draggable: false, 

  onCreate() {
    // 确保调用父级的 onCreate
    this.parent?.()?.onCreate?.apply(this);
    
    // 注册 Markdown 输入规则检查器
    if (!this.editor.storage.markdownBlockRulesRegistry) {
      this.editor.storage.markdownBlockRulesRegistry = { checkers: [] };
    }
    const markdownChecker = (state) => {
      const { $from } = state.selection;
      for (let i = $from.depth; i > 0; i--) {
        if ($from.node(i).type.name === 'table') return true;
      }
      return false;
    };
    this.markdownRuleChecker = markdownChecker;
    this.editor.storage.markdownBlockRulesRegistry.checkers.push(this.markdownRuleChecker);

    // 注册 Backspace 键盘事件处理器，并确保注册表存在
    if (!this.editor.storage.keyboardRegistry) {
      // 如果 KeyboardListener 还没创建它，我们自己创建
      this.editor.storage.keyboardRegistry = new KeyboardRegistry();
    }
    const backspaceHandler = ({ state }) => {
      const { selection } = state;
      const { $cursor } = selection;
      if ($cursor && $cursor.parentOffset === 0) {
        for (let i = $cursor.depth; i > 0; i--) {
          if ($cursor.node(i).type.name === 'table') {
            return true;
          }
        }
      }
      return false;
    };
    const entry = {
      keys: 'Backspace',
      handler: backspaceHandler,
      phase: 'pre',
      priority: 100,
      id: 'table-backspace-protection',
    };
    this.editor.storage.keyboardRegistry.register(entry);
    this.backspaceHandlerId = entry.id;

    // 注册跨块导航处理器
    if (!this.editor.storage.crossBlockNavigatorRegistry) {
      this.editor.storage.crossBlockNavigatorRegistry = new CrossBlockNavigatorRegistry();
    }
    this.editor.storage.crossBlockNavigatorRegistry.register('table', {
      onEnter: (context, blockInfo, target) => navigateIntoTable(context, blockInfo, target),
    });
  },

  onDestroy() {
    // 从 Markdown 注册表中移除检查器
    if (this.editor.storage.markdownBlockRulesRegistry && this.markdownRuleChecker) {
      const registry = this.editor.storage.markdownBlockRulesRegistry;
      registry.checkers = registry.checkers.filter(
        (checker) => checker !== this.markdownRuleChecker
      );
    }
    
    // 从键盘注册表中移除处理器
    if (this.editor.storage.keyboardRegistry && this.backspaceHandlerId) {
      this.editor.storage.keyboardRegistry.unregister(this.backspaceHandlerId);
    }

    // 注销跨块导航处理器
    if (this.editor.storage.crossBlockNavigatorRegistry) {
      this.editor.storage.crossBlockNavigatorRegistry.unregister('table');
    }

    // 确保调用父级的 onDestroy
    this.parent?.()?.onDestroy?.apply(this);
  },

  addOptions() {
    return {
      ...this.parent?.(),
      HTMLAttributes: {
        class: 'table-block'
      },
      cellContent: 'tableCellContentBlock'
    };
  },

  addAttributes() {
    return {
      // 继承 Tiptap Table 原有的属性 (例如 for resizable columns)
      // ...this.parent?.(), // Table 扩展本身没有太多直接的HTML属性，主要是通过节点结构和CSS控制

      // 添加项目标准的块属性
      id: {
        default: null, // generateBlockId() 现在在 command 中处理具体节点的创建
        parseHTML: element => element.getAttribute('data-block-id'), // 保持解析
        renderHTML: attributes => {
          if (attributes.id) {
            return { 'data-block-id': attributes.id };
          }
          return {};
        },
      },
      blockType: {
        default: 'table', 
        parseHTML: element => element.getAttribute('data-block-type') || 'table',
        renderHTML: attributes => ({
          'data-block-type': attributes.blockType,
        }),
      },
      // 表头语义属于持久化合同。后端 Markdown materializer 也会生成该属性，
      // 因此必须由生产 Editor schema 显式注册，不能依赖 nodeFromJSON 静默丢弃。
      withHeaderRow: {
        default: true,
        parseHTML: element => element.getAttribute('data-with-header-row') !== 'false',
        renderHTML: attributes => ({
          'data-with-header-row': attributes.withHeaderRow ? 'true' : 'false',
        }),
      },
    };
  },

  // Tiptap 的 Table 扩展已经处理了 renderHTML 和 parseHTML
  // 我们在这里扩展它，主要是为了添加自定义属性的渲染和解析逻辑
  // 但是，Tiptap Table 的 renderHTML 是为<table>元素准备的，
  // 如果我们想在外部包裹一个 div (像其他 BlockView 那样)，就需要更复杂的处理，
  // 或者依赖 NodeView。

  // renderHTML({ HTMLAttributes }) {
  //   // 调用父级的 renderHTML 获取基本的 <table> 结构
  //   // 但这比较复杂，因为父级的 renderHTML 直接返回 table 的 DOM 描述符
  //   // 我们需要将其与我们的自定义属性合并
  //   // 对于 Table 这种复杂结构，直接依赖父类的渲染，并通过 addAttributes 注入我们的属性是更简单的方式
  //   return ['table', mergeAttributes(this.options.HTMLAttributes, HTMLAttributes), ['tbody', 0]];
  // },

  // parseHTML() {
  //   return [
  //     {
  //       // 匹配带有我们自定义属性的 table
  //       tag: \`table[data-block-type="${this.name}"]\`, 
  //     },
  //     // 也要能解析普通的 table (如果父类 parseHTML 不够用)
  //     // ...this.parent?.().parseHTML, // 确保能解析 Tiptap Table 的标准结构
  //   ];
  // },

  // 如果需要自定义的 NodeView 来包裹表格，并提供拖拽手柄等，在这里添加
  // addNodeView() {
  //   return VueNodeViewRenderer(TableBlockView); // 假设创建了 TableBlockView.vue
  // }

  addCommands() {
    // 获取父级命令
    const parentCommands = this.parent?.();
    
    // 使用注册模块注册所有表格命令
    return registerAllTableCommands(parentCommands);
  },
});

export default TableBlock;
