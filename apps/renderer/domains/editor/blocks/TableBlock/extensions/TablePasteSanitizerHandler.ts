/**
 * TablePasteSanitizerHandler.ts
 *
 * 目标：当从外部（Word/网页/Excel）粘贴表格时，经常会带入原有的边框、字体、颜色等“表现层样式”，
 * 导致粘贴出来的表格外观与我们“新建表格”的默认样式不一致。
 *
 * 这里做一次“输入端清洗”：
 * - 仅在剪贴板 HTML 片段中包含 <table> 时接管；
 * - 清理 table 子树内的 style / border / width / font 等属性，以及片段中的 <style> 标签；
 * - 走 ProseMirror 原生粘贴管线（transformPastedHTML/transformPasted），在解析前/解析后分别做清洗与归一化，
 *   最终样式由 table.css 控制。
 *
 * 注意：
 * - 这是根因修复：源头是 HTML 解析会忠实保留 inline styles；因此要在进入解析器前去掉。
 * - 不做“防御性补丁”：只处理明确的表格粘贴场景，不影响普通富文本粘贴。
 *
 * 归属：
 * - 该 handler 属于 TableBlock feature 的一部分，必须与 TableBlock 同模块维护，避免跨 feature 依赖。
 */
import type { Schema } from '@tiptap/pm/model';
import { Fragment, Node as PMNode, Slice } from '@tiptap/pm/model';
import { createNormalizedTableCellContentBlock } from '../commands/tableCellContentNormalization.js';

function unwrapElementKeepChildren(el: Element): void {
  const parent = el.parentNode;
  if (!parent) return;

  while (el.firstChild) {
    parent.insertBefore(el.firstChild, el);
  }
  parent.removeChild(el);
}

function normalizeTextForEmptyCheck(text: string): string {
  // Word 表格里常见的空内容是 &nbsp;，解析后会变成 \u00A0
  return (
    text
      // NBSP
      .replace(/\u00A0/g, ' ')
      // 零宽/不可见字符（Word/Excel 粘贴时非常常见，会导致“看起来空但 textContent 非空”）
      .replace(/[\u200B\u200C\u200D\u2060\uFEFF\u200E\u200F]/g, '')
      // 规整空白
      .replace(/\s+/g, ' ')
      .trim()
  );
}

// 注意：HTML 清洗路径只做“去样式”，不再做任何“裁剪空行/空列”的结构性修改，
// 以避免误删用户确实复制的空白行/列（例如选择区域包含外围空列/空行）。

function removeTrailingPlaceholdersInTableCells(tableEl: HTMLTableElement): void {
  /**
   * 根因解释（你问“为什么去除样式前正常”）：
   * - Word/Excel 的 HTML 表格单元格里经常会塞“占位段落/换行”（比如末尾的 <br>、空 <p>、NBSP），
   *   同时用 style/CSS 控制它们不影响视觉布局（例如高度、行距、display 等）。
   * - 我们为了统一样式会移除 style，这些“占位”就会显形，表现为“多出来一行空白/看起来像空白行列”。
   *
   * 正确做法：
   * - 不去裁剪表格行列结构；
   * - 只清理单元格内部“末尾占位”（等价于移除文字末尾的换行符号/占位节点），保持数据不变。
   */
  const cells = Array.from(tableEl.querySelectorAll('td,th'));
  for (const cell of cells) {
    while (cell.lastChild) {
      const last = cell.lastChild;

      // 1) 末尾纯空白文本节点（常由源码换行/缩进产生）
      if (last.nodeType === Node.TEXT_NODE) {
        const text = normalizeTextForEmptyCheck(last.textContent ?? '');
        if (text.length === 0) {
          cell.removeChild(last);
          continue;
        }
        break;
      }

      // 2) 末尾 <br>
      if (last.nodeType === Node.ELEMENT_NODE) {
        const el = last as Element;
        if (el.tagName === 'BR') {
          el.remove();
          continue;
        }

        // 3) 末尾空段落/空容器（Word/Excel 常见：<p>&nbsp;</p> / <div><br></div>）
        if ((el.tagName === 'P' || el.tagName === 'DIV') && !el.querySelector('img, table')) {
          const text = normalizeTextForEmptyCheck(el.textContent ?? '');
          const hasMeaningfulChildElement = !!el.querySelector('img, svg, video, iframe, canvas, table');
          if (!hasMeaningfulChildElement && text.length === 0) {
            el.remove();
            continue;
          }
        }
      }

      break;
    }
  }
}

function sanitizeTableDom(tableEl: HTMLTableElement): void {
  /**
   * 清理原则：
   * - 只清理“表现层”信息：style / border / width / font 等；
   * - 不改结构：不改 tr/td/th 的层级，不改文本内容；
   * - 保留语义标签（如 <b>/<strong>）本身，因为那属于内容语义而不是样式表。
   */
  const stack: Element[] = [tableEl];
  while (stack.length > 0) {
    const el = stack.pop();
    if (!el) continue;

    // colgroup/col 主要用于布局（列宽等），对我们表格默认样式无意义；移除可减少 Word/网页布局残留
    if (el.tagName === 'COLGROUP' || el.tagName === 'COL') {
      el.remove();
      continue;
    }

    // 1) 检查隐藏元素（在移除 style 前执行）：display:none, visibility:hidden, height:0
    // 如果元素本身就是为了隐藏内容，直接移除它，避免去除 style 后内容现形（导致“多出内容”）
    const style = el.getAttribute('style') || '';
    if (style) {
      if (
        /display:\s*none/i.test(style) ||
        /visibility:\s*hidden/i.test(style) ||
        /height:\s*0(px|pt|cm|in|%)?/i.test(style)
      ) {
        el.remove();
        continue;
      }
    }

    // 2) 删除 inline style：边框、字体、颜色等通常都在这里
    if (el.hasAttribute('style')) {
      el.removeAttribute('style');
    }

    // 3) 删除常见的表现属性（尤其是 Word/HTML 表格的边框与宽高）
    const attrsToRemove = [
      'border',
      'cellpadding',
      'cellspacing',
      'width',
      'height',
      'bgcolor',
      'align',
      'valign',
      'color',
      'face',
      'size',
      'nowrap',
    ];
    for (const attr of attrsToRemove) {
      if (el.hasAttribute(attr)) {
        el.removeAttribute(attr);
      }
    }

    // 4) 清理 Word/Office 常见的命名空间节点（例如 <o:p>），避免脏节点影响解析
    // 改为 unwrap 而不是 remove，防止误删内容（如 <o:p> 内可能有文本，虽不常见）
    if (el.tagName.includes(':')) {
      unwrapElementKeepChildren(el);
      continue;
    }

    // 5) 继续遍历子元素
    for (const child of Array.from(el.children)) {
      stack.push(child);
    }
  }

  // 5) 清理 <font> 标签（只保留其子节点）
  const fonts = Array.from(tableEl.querySelectorAll('font'));
  for (const fontEl of fonts) {
    unwrapElementKeepChildren(fontEl);
  }

  // 6) 清理单元格末尾占位（等价于移除“文字末尾的换行符号/占位节点”）
  removeTrailingPlaceholdersInTableCells(tableEl);
}

function extractStartEndFragment(html: string): string {
  const startMarker = '<!--StartFragment-->';
  const endMarker = '<!--EndFragment-->';
  const start = html.indexOf(startMarker);
  const end = html.indexOf(endMarker);
  if (start !== -1 && end !== -1 && end > start) {
    return html.slice(start + startMarker.length, end);
  }
  return html;
}

function normalizeTextForMeaningfulCheck(text: string): string {
  return (
    text
      .replace(/\u00A0/g, ' ')
      .replace(/[\u200B\u200C\u200D\u2060\uFEFF\u200E\u200F]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
  );
}

function hasMeaningfulNonTableContent(body: HTMLElement): boolean {
  /**
   * 判断“表格之外是否存在有意义的内容”。
   *
   * 说明（中文）：
   * - 目标是修复“外部来源复制带表格文章时只剩表格”的根因：我们不能一刀切只保留 table。
   * - 但 Word/Excel 依旧会在 table 外塞大量空段落/占位节点，因此这里需要区分“真实正文”与“垃圾空白”。
   * - 判定口径：
   *   - 若 table 外存在任意明显的内容元素（p/ul/ol/h1..h6/blockquote/img 等）且其文本非空，则视为有意义；
   *   - 或 table 外纯文本（剔除空白/NBSP/零宽字符）长度达到阈值，也视为有意义。
   */

  // 1) 收集所有 table，后续在遍历时跳过其子树
  const tables = new Set(Array.from(body.querySelectorAll('table')));

  // 2) 判断 table 外是否存在“明显的内容元素”
  const contentEls = Array.from(
    body.querySelectorAll('p, h1, h2, h3, h4, h5, h6, ul, ol, blockquote, pre, img, figure, hr')
  );
  for (const el of contentEls) {
    if (el.closest('table')) continue;
    if (el.tagName === 'IMG' || el.tagName === 'HR') {
      // 图像/分隔线属于有意义内容
      return true;
    }
    const text = normalizeTextForMeaningfulCheck(el.textContent ?? '');
    if (text.length > 0) {
      return true;
    }
  }

  // 3) 最后兜底：计算 table 外的纯文本长度
  const walker = body.ownerDocument.createTreeWalker(body, NodeFilter.SHOW_TEXT);
  let textLen = 0;
  let current: Node | null = walker.nextNode();
  while (current) {
    const parentEl = current.parentElement;
    if (parentEl && parentEl.closest('table')) {
      current = walker.nextNode();
      continue;
    }
    // 跳过脚本/样式等
    if (parentEl && (parentEl.tagName === 'SCRIPT' || parentEl.tagName === 'STYLE')) {
      current = walker.nextNode();
      continue;
    }
    // 仅统计非空白文本
    const t = normalizeTextForMeaningfulCheck(current.textContent ?? '');
    if (t.length > 0) {
      textLen += t.length;
      // 阈值：有一定正文长度即可判定为“有意义”
      if (textLen >= 20) return true;
    }
    current = walker.nextNode();
  }

  // 如果 table 外没有任何实质文本/内容元素，则认为没有有意义内容
  void tables; // 保留 tables 的语义（已用于 closest('table') 判断），避免未来误删
  return false;
}

/**
 * 解析前：清洗粘贴 HTML（仅在包含 <table> 时调用）
 */
export function sanitizePastedTableHtml(rawHtml: string): string {
  if (typeof rawHtml !== 'string' || rawHtml.length === 0) return rawHtml;

  const html = extractStartEndFragment(rawHtml);
  if (!/<table[\s>]/i.test(html)) return rawHtml;

  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');

  // Word/网页片段可能自带 <style>，会通过 class 选择器继续污染表格样式，必须移除
  const styleEls = Array.from(doc.querySelectorAll('style'));
  for (const el of styleEls) el.remove();

  const tables = Array.from(doc.body.querySelectorAll('table'));
  if (tables.length === 0) return rawHtml;

  for (const table of tables) {
    sanitizeTableDom(table);

    // 归一化文本节点中的 NBSP（避免解析后残留“看似空但实际有内容”的空白）
    const walker = doc.createTreeWalker(table, NodeFilter.SHOW_TEXT);
    let current: Node | null = walker.nextNode();
    while (current) {
      const t = current.textContent ?? '';
      // 仅替换 NBSP/零宽字符，不改动普通文本
      const replaced = t
        .replace(/\u00A0/g, ' ')
        .replace(/[\u200B\u200C\u200D\u2060\uFEFF\u200E\u200F]/g, '');
      if (replaced !== t) {
        current.textContent = replaced;
      }
      current = walker.nextNode();
    }
  }

  /**
   * 关键分流（根因级解释）：
   *
   * - 外部来源（Word/网页/Excel）：片段里常夹带大量“非 table 的垃圾 DOM”（空段落、布局占位、命名空间节点等），
   *   会导致粘贴后出现“表格外多空白块/多空行”。因此旧策略是“只返回 table 自身”。✅
   *
   * - 内部来源（Linnya 自己的富复制/导出）：我们会在 HTML 外层包一层 `data-linnya-copy-scope` 标记，
   *   其内容（段落/列表/标题）同样是用户需要的；如果仍然“只返回 table”，就会出现：
   *   「粘贴整段内容时只剩表格」——这是真实丢数据，不是垃圾清理。❌
   *
   * 结论：
   * - 若检测到内部标记，则保留整个片段（仅对 table 子树做去样式/归一化）；
   * - 否则保持旧行为（仅返回 table），避免外部粘贴污染。
   */
  const isInternalRichCopy =
    doc.body.querySelector('[data-linnya-copy-scope]') !== null ||
    doc.body.querySelector('[data-scope="conversation-message"]') !== null;

  // 1) 内部富复制：必须保留全文（仅对 table 子树做去样式/归一化）
  if (isInternalRichCopy) {
    return doc.body.innerHTML;
  }

  // 2) 外部来源：如果表格之外存在“有意义的正文内容”，也必须保留全文
  if (hasMeaningfulNonTableContent(doc.body)) {
    return doc.body.innerHTML;
  }

  // 3) 外部来源且表格外均为垃圾/空白：保持旧行为，仅保留表格本体
  return tables.map((t) => t.outerHTML).join('');
}

function fragmentContainsTable(fragment: Fragment): boolean {
  let found = false;
  fragment.descendants((node) => {
    if (node.type.name === 'table') {
      found = true;
      return false;
    }
    return !found;
  });
  return found;
}

function isNodeEffectivelyEmptyInline(node: PMNode): boolean {
  // 只用于 tableCellContentBlock：判断其内容是否仅由空白文本 / hardBreak 组成
  let hasMeaningful = false;
  node.descendants((child) => {
    if (child.type.name === 'hardBreak') {
      return false;
    }
    if (child.isText) {
      const text = normalizeTextForEmptyCheck(child.text ?? '');
      if (text.length > 0) {
        hasMeaningful = true;
        return false;
      }
      return false;
    }
    // 其他 inline 节点（例如 mention/emoji 等）视为有意义内容
    if (child.isInline) {
      hasMeaningful = true;
      return false;
    }
    return false;
  });
  return !hasMeaningful;
}

function normalizeNodeForTablePaste(node: PMNode, schema: Schema): PMNode {
  // 归一化 tableCellContentBlock：空内容不要保留 hardBreak/空白文本，避免撑高行高
  if (node.type.name === 'tableCellContentBlock') {
    if (isNodeEffectivelyEmptyInline(node)) {
      return node.type.create(node.attrs, Fragment.empty, node.marks);
    }
    return node;
  }

  if (node.isLeaf) return node;

  const children: PMNode[] = [];
  node.forEach((child) => {
    children.push(normalizeNodeForTablePaste(child, schema));
  });

  /**
   * 关键兜底（解决“偶发某个单元格边还保留原始样式”）：
   *
   * 我们的 `CustomTableCell/CustomTableHeader` 会把 HTML 的 style 属性解析到节点 attrs.style，
   * 并在渲染时再输出到 DOM。
   *
   * 即便 transformPastedHTML 已移除绝大多数 style，也可能因为 Office 的复杂 DOM（命名空间节点/嵌套结构）
   * 造成极少数 style 漏网，最终表现为“偶发单元格边框仍是原样式”。
   *
   * 因此在解析后的 Slice 层做一次最终归一化：强制清空 tableCell/tableHeader 的 attrs.style，
   * 让外部样式没有任何落地通道，确保表格外观始终走我们自己的 CSS。
   */
  if (node.type.name === 'tableCell' || node.type.name === 'tableHeader') {
    const nextAttrs = { ...(node.attrs || {}), style: null };
    const nextCellNode = node.type.create(nextAttrs, Fragment.fromArray(children), node.marks);
    const normalizedCellContent = createNormalizedTableCellContentBlock({
      schema,
      cellNode: nextCellNode,
    });

    if (!normalizedCellContent) {
      return nextCellNode;
    }

    return node.type.create(nextAttrs, normalizedCellContent.contentBlock, node.marks);
  }

  return node.type.create(node.attrs, Fragment.fromArray(children), node.marks);
}

/**
 * 解析后：对 Slice 做结构归一化（仅在 Slice 中包含 table 时生效）
 */
export function normalizePastedTableSlice(slice: Slice, schema: Schema): Slice {
  if (!slice || !schema) return slice;
  if (!fragmentContainsTable(slice.content)) return slice;

  const normalizedChildren: PMNode[] = [];
  slice.content.forEach((node) => {
    normalizedChildren.push(normalizeNodeForTablePaste(node, schema));
  });
  const content = Fragment.fromArray(normalizedChildren);
  return new Slice(content, slice.openStart, slice.openEnd);
}
