/**
 * 文本查找（PDF 文字层、网页正文共用）。PDF 文字层常有全角数字、行内断行和解析器插入的空白，
 * 网页正文也常见全角标点和换行断句；查找时忽略全半角、大小写和全部空白，上下文仍截自原文，
 * 便于模型直接引用。
 */

const DEFAULT_CONTEXT_CHARS = 120;

interface CompactText {
  readonly compact: string;
  /** compact 第 i 个字符对应原文的 [start, end)。 */
  readonly starts: readonly number[];
  readonly ends: readonly number[];
}

function compactText(text: string): CompactText {
  let compact = '';
  const starts: number[] = [];
  const ends: number[] = [];
  let index = 0;
  for (const char of text) {
    const next = index + char.length;
    const normalized = char.normalize('NFKC').toLowerCase().replace(/\s+/gu, '');
    for (const unit of normalized) {
      compact += unit;
      starts.push(index);
      ends.push(next);
    }
    index = next;
  }
  return { compact, starts, ends };
}

export function normalizeFindQuery(query: string): string {
  return query.normalize('NFKC').toLowerCase().replace(/\s+/gu, '');
}

export interface TextMatch {
  /** 原文 UTF-16 偏移，[start, end)。 */
  readonly start: number;
  readonly end: number;
  /** 命中处前后各约 contextChars 字的原文，换行压成空格。 */
  readonly context: string;
}

export function findInText(
  text: string,
  query: string,
  maxMatches: number,
  contextChars = DEFAULT_CONTEXT_CHARS,
): { readonly count: number; readonly matches: TextMatch[] } {
  const needle = normalizeFindQuery(query);
  if (!needle || !text) return { count: 0, matches: [] };
  const { compact, starts, ends } = compactText(text);
  const matches: TextMatch[] = [];
  let count = 0;
  for (let at = compact.indexOf(needle); at !== -1; at = compact.indexOf(needle, at + needle.length)) {
    count += 1;
    if (matches.length >= maxMatches) continue;
    const start = starts[at]!;
    const end = ends[at + needle.length - 1]!;
    const before = Math.max(0, start - contextChars);
    const after = Math.min(text.length, end + contextChars);
    const context = `${before > 0 ? '…' : ''}${text.slice(before, after)}${after < text.length ? '…' : ''}`
      .replace(/\s*\n\s*/gu, ' ');
    matches.push({ start, end, context });
  }
  return { count, matches };
}
