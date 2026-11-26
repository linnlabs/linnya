import type { Node as ProseMirrorNode } from '@tiptap/pm/model';

/** 短格判定的上限：不超过这个视觉宽度（em）的单行文字不断行。 */
export const COMPACT_TABLE_CELL_MAX_EM = 8;

function isWideCodePoint(code: number): boolean {
  return (code >= 0x2E80 && code <= 0x9FFF) // CJK 部首、假名、汉字、全角标点
    || (code >= 0xAC00 && code <= 0xD7AF) // 韩文音节
    || (code >= 0xF900 && code <= 0xFAFF) // CJK 兼容汉字
    || (code >= 0xFE30 && code <= 0xFE4F) // CJK 兼容形式
    || (code >= 0xFF00 && code <= 0xFFEF) // 全角 ASCII 与半全角形式
    || code >= 0x1F000; // 表情等补充平面符号
}

/**
 * 按字符类别估算单行文字的视觉宽度（单位 em）：中日韩与全角 1em，数字 0.6em（全表等宽数字），
 * 空格 0.3em，其余西文 0.55em。只用于“是不是短标签”的判定，不追求排版精度。
 */
export function estimateTableTextWidthEm(text: string): number {
  let width = 0;
  for (const character of text) {
    const code = character.codePointAt(0) ?? 0;
    if (isWideCodePoint(code)) width += 1;
    else if (code >= 0x30 && code <= 0x39) width += 0.6;
    else if (character === ' ') width += 0.3;
    else width += 0.55;
  }
  return width;
}

/** 单行且不超过 8em 的文字是短格；空格同样算短格，空列不会被撑到长文本最小宽度。 */
export function isCompactTableCellText(text: string): boolean {
  return !text.includes('\n') && estimateTableTextWidthEm(text) <= COMPACT_TABLE_CELL_MAX_EM;
}

/**
 * 正式 schema 节点判定：只有一个内容块、只含文字（可带行内 mark）。
 * 换行、公式、文档引用、列引用等行内节点宽度无法从文字估算，一律按长格处理。
 */
export function isCompactTableCellNode(cell: ProseMirrorNode): boolean {
  if (cell.childCount > 1) return false;
  let text = '';
  let plain = true;
  cell.descendants(node => {
    if (!plain) return false;
    if (node.isText) {
      text += node.text ?? '';
      return false;
    }
    if (node.isInline) {
      plain = false;
      return false;
    }
    return true;
  });
  return plain && isCompactTableCellText(text);
}

/** 只读 HTML（PDF 快照）里允许出现在短格中的行内 mark 元素。 */
const PLAIN_INLINE_TAGS = new Set(['STRONG', 'EM', 'B', 'I', 'S', 'DEL', 'U', 'CODE', 'A', 'MARK', 'SUB', 'SUP', 'SPAN']);

/**
 * 只读 HTML 判定，与节点判定同一规则：一个内容块、只有文字和行内 mark。
 * 带 class 的 span 是公式、引用等行内节点的外壳，按长格处理。
 */
export function isCompactTableCellElement(cell: Element): boolean {
  const blocks = Array.from(cell.children).filter(child => child.classList.contains('table-cell-content-block'));
  if (blocks.length > 1) return false;
  const content = blocks[0] ?? cell;
  for (const element of Array.from(content.querySelectorAll('*'))) {
    if (!PLAIN_INLINE_TAGS.has(element.tagName.toUpperCase())) return false;
    if (element.tagName.toUpperCase() === 'SPAN' && element.hasAttribute('class')) return false;
  }
  return isCompactTableCellText(content.textContent ?? '');
}
