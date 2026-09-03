/**
 * PlainTextMarkdownHandler.js
 * 
 * 纯文本 Markdown 粘贴处理器
 * 当粘贴纯文本 Markdown 语法（如从侧边栏复制）时，自动解析并转换为块结构
 * 
 * 工作流程：
 * 1. 检测粘贴的是否为纯文本（无 HTML）
 * 2. 检测文本是否包含 Markdown 语法
 * 3. 使用 WASM 解析器将 Markdown 转换为块事件
 * 4. 将块事件转换为 ProseMirror 节点并插入
 */

import { parseMarkdownToBlocksByStreaming } from '../../../../shared/services/markdownService';
import { PastePriority } from './PasteRegistry';
import { TextSelection } from 'prosemirror-state';
import { blockEventToRootBlockNode } from '../../services/markdownRuntime';

/**
 * 检测文本是否包含 Markdown 语法
 * @param {string} text - 要检测的文本
 * @returns {boolean} 是否包含 Markdown 语法
 */
function containsMarkdownSyntax(text) {
  // 检测常见的 Markdown 语法标记
  const markdownPatterns = [
    /^#{1,6}\s/m,           // 标题: # 开头
    /^\*\s/m,               // 无序列表: * 开头
    /^-\s/m,                // 无序列表: - 开头
    /^\d+\.\s/m,            // 有序列表: 1. 开头
    /^>\s/m,                // 引用: > 开头
    /```/,                  // 代码块: ```
    /\*\*.+\*\*/,           // 粗体: **text**
    /\*.+\*/,               // 斜体: *text*
    /~~.+~~/,               // 删除线: ~~text~~
    /`[^`]+`/,              // 行内代码: `code`
    /\[.+\]\(.+\)/,         // 链接: [text](url)
    /^---$/m,               // 分隔线: ---
  ];

  return markdownPatterns.some(pattern => pattern.test(text));
}

/**
 * 判断剪贴板 HTML 是否“足够富”，应优先让默认 HTML 解析接管（根因修复）
 *
 * 根因：
 * - 许多外部应用（Notion/网页/文档）会同时提供 text/html + text/plain；
 * - 若我们在存在高质量 HTML 时仍强行用纯文本走 Markdown 解析，就会丢失 HTML 里携带的富信息
 *   （例如：强调/链接/颜色/复杂列表/嵌套结构等）。
 *
 * 这里的规则（不做防御性补丁）：
 * - 只要 HTML 看起来像“真实富文本结构”（ul/ol/li/blockquote/pre/code/heading/table 等），
 *   就不接管，交回 ProseMirror 默认粘贴链路；
 * - 仅当 HTML 为空/非常弱（例如只是一层 div 包裹纯文本）时，才考虑用纯文本 Markdown 解析。
 */
function isRichHtml(html) {
  if (!html || typeof html !== 'string') return false;
  const trimmed = html.trim();
  if (trimmed === '') return false;

  // 明确的富文本结构标签：一旦命中，优先相信 HTML
  const richTagRe = /<(ul|ol|li|h[1-6]|blockquote|pre|code|table|tr|td|th|hr|img|a|strong|em|del|s|mark|ins|sub|sup)\b/i;
  if (richTagRe.test(trimmed)) return true;

  // Notion/Office 常见的结构化片段标记（出现即视为富文本）
  const richAttrRe = /(data-notion|notion-clipboard|class="notion|MsoNormal|mso-)/i;
  if (richAttrRe.test(trimmed)) return true;

  return false;
}

/**
 * 纯文本 Markdown 粘贴处理器
 */
export const plainTextMarkdownHandler = {
  name: 'PlainTextMarkdownHandler',
  priority: PastePriority.NORMAL, // 普通优先级

  /**
   * 判断是否可以处理该粘贴事件
   */
  canHandle: (event, context) => {
    if (!event.clipboardData) {
      return false;
    }

    const types = event.clipboardData.types;

    // 必须包含纯文本
    const hasPlainText = types.includes('text/plain');
    if (!hasPlainText) {
      return false;
    }

    /**
     * 代码块内粘贴：必须让默认逻辑把“纯文本”插入到 codeBlock 内部。
     *
     * 根因：
     * - 本处理器会把文本当成 Markdown 解析为“块”，并按 rootBlock 级别插入；
     * - 但 codeBlock 的预期行为是：把内容作为纯文本插入当前 codeBlock 的文本内容中；
     * - 如果在 codeBlock 内仍触发本处理器，就会出现“粘贴被挤到代码块外，变成独立一行”的现象。
     */
    const { selection } = context;
    const $from = selection.$from;
    for (let depth = $from.depth; depth > 0; depth--) {
      if ($from.node(depth).type.name === 'codeBlock') {
        return false;
      }
    }

    /**
     * HTML 优先（根因修复）
     *
     * 过去的策略：只要纯文本像 Markdown，就会抢占处理，即使 HTML 已经提供了更高质量的富文本结构。
     * 这会导致从 Notion/网页粘贴进来时“格式丢失”（因为 Notion 的 text/plain 通常不携带所有格式信息）。
     *
     * 新策略：
     * - 若存在“明显富文本”HTML，则直接放弃接管，让默认 HTML 解析保真；
     * - 表格仍然交给表格清洗/默认链路；
     * - 仅当 HTML 缺失或非常弱时，才用纯文本 Markdown 解析做增强（例如某些来源只给了 plain 的列表语法）。
     */
    const hasHtml = types.includes('text/html');
    if (hasHtml) {
      const html = event.clipboardData.getData('text/html') || '';
      // 表格场景：交给默认 HTML 解析（或表格专用逻辑），避免误判
      if (/<table[\s>]/i.test(html) || /<tr[\s>]/i.test(html) || /<td[\s>]/i.test(html)) {
        return false;
      }
      // 明显富文本：不接管，避免覆盖更高质量的 HTML
      if (isRichHtml(html)) {
        return false;
      }
    }

    // 不应该有文件（如果有文件，让其他处理器处理）
    const hasFiles = types.includes('Files') && event.clipboardData.files.length > 0;
    if (hasFiles) {
      console.log('[PlainTextMarkdown] 包含文件，交给其他处理器');
      return false;
    }

    // 获取纯文本内容并检测是否包含 Markdown 语法
    const text = event.clipboardData.getData('text/plain');
    const hasMark = containsMarkdownSyntax(text);
    
    if (hasMark) {
      console.log('[PlainTextMarkdown] 检测到 Markdown 语法，将处理');
    }

    return hasMark;
  },

  /**
   * 处理粘贴事件
   */
  handle: async (event, context) => {
    try {
      const { view, editor } = context;

      // 获取纯文本内容
      const text = event.clipboardData.getData('text/plain');
      if (!text || text.trim() === '') {
        console.log('[PlainTextMarkdown] 文本内容为空');
        return false;
      }

      console.log('[PlainTextMarkdown] 开始处理纯文本 Markdown:', text.substring(0, 200));

      // 阻止默认粘贴行为
      event.preventDefault();

      // 1. Markdown -> 块事件 (使用 WASM 解析器)
      let blockEvents;
      try {
        // 使用 StreamingParser（功能更全，且能区分 bullet / ordered）
        blockEvents = await parseMarkdownToBlocksByStreaming(text);
        console.log('[PlainTextMarkdown] WASM(Streaming) 解析结果:', blockEvents);
      } catch (error) {
        console.error('[PlainTextMarkdown] WASM 解析失败:', error);
        // 回退：直接插入为纯文本
        editor.commands.insertContent(text);
        return true;
      }

      if (!blockEvents || blockEvents.length === 0) {
        console.log('[PlainTextMarkdown] 没有解析到块事件，回退到纯文本插入');
        editor.commands.insertContent(text);
        return true;
      }

      // 2. 块事件 -> ProseMirror 节点
      const { state } = view;
      const { schema, selection } = state;
      const nodes = [];

      for (const blockEvent of blockEvents) {
        console.log('[PlainTextMarkdown] 处理块事件:', blockEvent);
        const node = blockEventToRootBlockNode(blockEvent, schema);
        if (node) {
          nodes.push(node);
        }
      }

      if (nodes.length === 0) {
        console.log('[PlainTextMarkdown] 没有生成任何节点，回退到纯文本插入');
        editor.commands.insertContent(text);
        return true;
      }

      // 3. 插入到编辑器
      const tr = state.tr;
      
      // 删除当前选区（如果有）
      if (!selection.empty) {
        tr.deleteSelection();
      }

      /**
       * 插入位置（根因修复）
       *
       * 现象：过去直接用 selection.$from.pos（通常在 contentBlock 内部，深度=2）插入 rootBlock，
       * ProseMirror 会把不合法的插入“推”到块外，表现为粘贴落到下一个块。
       *
       * 目标：粘贴应从“光标位置”开始：
       * - 光标在块首：插入到当前 rootBlock 之前
       * - 光标在块中：先把当前 rootBlock 在光标处拆成左右两块，再在中间插入
       * - 光标在块尾：插入到当前 rootBlock 之后
       */
      const mappedFromPos = tr.mapping.map(selection.from);
      const $from = tr.doc.resolve(mappedFromPos);
      let insertPos = mappedFromPos;

      // 只在固定结构 doc -> rootBlock -> contentBlock（深度2）下做精确处理
      if ($from.depth === 2) {
        const rootStartPos = $from.before(1);
        const rootEndPos = $from.after(1);

        const parentOffset = $from.parentOffset;
        const parentContentSize = $from.parent.content.size;

        const isAtStart = parentOffset === 0;
        const isAtEnd = parentOffset === parentContentSize;
        const isInMiddle = !isAtStart && !isAtEnd;

        if (isAtStart) {
          // 块首：插入到当前 rootBlock 之前
          insertPos = rootStartPos;
        } else if (isAtEnd) {
          // 块尾：插入到当前 rootBlock 之后
          insertPos = rootEndPos;
        } else if (isInMiddle) {
          // 块中：先在光标处拆分 rootBlock，让“右半块”下移
          const schema = tr.doc.type.schema;
          const rootNode = $from.node(1);
          const currentContentNode = $from.parent;

          // 拆分后新块的内容类型：listItemBlock 保持列表；其他场景按现有 SplitCommands 逻辑回落到 baseBlock
          let newContentBlockType = schema.nodes.baseBlock;
          let newContentBlockAttrs = { id: generateBlockId(), blockType: 'base' };

          if (currentContentNode.type.name === 'listItemBlock') {
            newContentBlockType = schema.nodes.listItemBlock;
            newContentBlockAttrs = {
              ...currentContentNode.attrs,
              id: generateBlockId(),
              blockType: 'listItem',
              // 与 SplitCommands 一致：拆分出的“下半块”不继承 start，
              // 让有序列表编号能由装饰插件自动 +1。
              start: null,
            };
          }

          const typesAfter = [
            {
              type: schema.nodes.rootBlock,
              attrs: { ...(rootNode.attrs || {}), id: generateRootBlockId() },
            },
            {
              type: newContentBlockType,
              attrs: newContentBlockAttrs,
            },
          ];

          tr.split(mappedFromPos, 2, typesAfter);
          // 拆分发生在 mappedFromPos，拆分后该 pos 变成 rootBlock 之间的边界
          insertPos = mappedFromPos;
        }
      }

      // 批量插入节点 - 按顺序插入，每次更新位置
      for (const node of nodes) {
        tr.insert(insertPos, node);
        // 更新下一个插入位置：当前位置 + 刚插入节点的大小
        insertPos += node.nodeSize;
      }

      // 粘贴后将光标放到插入内容末尾，符合用户预期的继续输入体验
      try {
        tr.setSelection(TextSelection.near(tr.doc.resolve(insertPos)));
      } catch (e) {
        // 选区设置失败不影响插入结果
      }

      view.dispatch(tr);

      console.log(`[PlainTextMarkdown] ✅ 成功插入 ${nodes.length} 个块`);
      return true;

    } catch (error) {
      console.error('[PlainTextMarkdown] ❌ 处理失败:', error);
      // 回退：使用默认处理
      return false;
    }
  }
};

export default plainTextMarkdownHandler;
