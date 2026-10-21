import type { MarkdownCitationToken } from '../definitions/markdownCitationToken';
import { isCanonicalCitationRef } from '../../reference/functions/citationRef';

const CITATION_GROUP_PATTERN = /\\?\[@([^\]]+?)\\?\]/g;

interface TextRange {
  readonly start: number;
  readonly end: number;
}

function countRun(text: string, start: number, character: string): number {
  let end = start;
  while (text[end] === character) end += 1;
  return end - start;
}

interface CodeFence {
  readonly marker: '`' | '~';
  readonly length: number;
  readonly suffix: string;
  readonly lineEnd: number;
}

function readCodeFence(markdown: string, start: number): CodeFence | null {
  if (start > 0 && markdown[start - 1] !== '\n') return null;
  const newline = markdown.indexOf('\n', start);
  const lineEnd = newline === -1 ? markdown.length : newline + 1;
  const line = markdown.slice(start, newline === -1 ? markdown.length : newline);
  const match = /^( {0,3})(`{3,}|~{3,})(.*)$/.exec(line);
  if (!match) return null;
  const markerRun = match[2];
  const marker = markerRun?.[0];
  if (marker !== '`' && marker !== '~') return null;
  return { marker, length: markerRun.length, suffix: match[3] ?? '', lineEnd };
}

function findFenceEnd(markdown: string, fence: CodeFence): number {
  let lineStart = fence.lineEnd;
  while (lineStart < markdown.length) {
    const candidate = readCodeFence(markdown, lineStart);
    if (candidate && candidate.marker === fence.marker &&
      candidate.length >= fence.length && candidate.suffix.trim().length === 0) {
      return candidate.lineEnd;
    }
    const newline = markdown.indexOf('\n', lineStart);
    if (newline === -1) break;
    lineStart = newline + 1;
  }
  return markdown.length;
}

function isEscaped(text: string, index: number): boolean {
  let slashCount = 0;
  for (let cursor = index - 1; cursor >= 0 && text[cursor] === '\\'; cursor -= 1) {
    slashCount += 1;
  }
  return slashCount % 2 === 1;
}

function isInsideRanges(index: number, ranges: readonly TextRange[]): boolean {
  return ranges.some(range => index >= range.start && index < range.end);
}

function findInlineCodeEnd(markdown: string, start: number, delimiterLength: number): number | null {
  let cursor = start + delimiterLength;
  while (cursor < markdown.length) {
    // 行内代码允许软换行，但不跨空段或块级 fence 吞掉后面的正文。
    if (markdown[cursor] === '\n' && /^\n[\t ]*\r?\n/.test(markdown.slice(cursor))) return null;
    if (readCodeFence(markdown, cursor)) return null;
    if (markdown[cursor] !== '`') {
      cursor += 1;
      continue;
    }
    // code span 中的反斜杠和 <!-- 都是字面内容，不改变闭合 delimiter 的含义。
    const length = countRun(markdown, cursor, '`');
    if (length === delimiterLength) return cursor + length;
    cursor += length;
  }
  return null;
}

/**
 * 按词法顺序接纳保护区，而不是分别扫描代码和注释后再合并。
 * 先进入的结构拥有其内部文字：注释内反引号不能配到正文，代码内 <!-- 也不能开启注释。
 */
function collectProtectedRanges(markdown: string): readonly TextRange[] {
  const ranges: TextRange[] = [];
  let cursor = 0;
  while (cursor < markdown.length) {
    const fence = readCodeFence(markdown, cursor);
    if (fence) {
      const end = findFenceEnd(markdown, fence);
      ranges.push({ start: cursor, end });
      cursor = end;
      continue;
    }
    if (markdown.startsWith('<!--', cursor) && !isEscaped(markdown, cursor)) {
      const closing = markdown.indexOf('-->', cursor + 4);
      const end = closing === -1 ? markdown.length : closing + 3;
      ranges.push({ start: cursor, end });
      cursor = end;
      continue;
    }
    if (markdown[cursor] === '`' && !isEscaped(markdown, cursor)) {
      const delimiterLength = countRun(markdown, cursor, '`');
      const end = findInlineCodeEnd(markdown, cursor, delimiterLength);
      if (end !== null) {
        ranges.push({ start: cursor, end });
        cursor = end;
      } else {
        cursor += delimiterLength;
      }
      continue;
    }
    cursor += 1;
  }
  return ranges;
}

function parseRefs(group: string): readonly string[] {
  const refs: string[] = [];
  const seen = new Set<string>();
  for (const part of group.split(/[;,]/)) {
    const ref = part.trim().replace(/^@/, '').replace(/\\+$/g, '');
    if (!isCanonicalCitationRef(ref) || seen.has(ref)) continue;
    seen.add(ref);
    refs.push(ref);
  }
  return refs;
}

function isCanonicalCitationGroup(group: string): boolean {
  const parts = group.split(/[;,]/).map(part =>
    part.trim().replace(/^@/, '').replace(/\\+$/g, '')
  );
  return parts.length > 0 && parts.every(isCanonicalCitationRef);
}

/**
 * 解析 Markdown 正文中的 Citation token，严格复用 canonical Base58 ref 合同。
 * fenced code、inline code 与 HTML comment 中的 token 不创建引用事实。
 */
export function parseMarkdownCitationTokens(markdown: string): readonly MarkdownCitationToken[] {
  const protectedRanges = collectProtectedRanges(markdown);
  const tokens: MarkdownCitationToken[] = [];
  let match: RegExpExecArray | null;

  CITATION_GROUP_PATTERN.lastIndex = 0;
  while ((match = CITATION_GROUP_PATTERN.exec(markdown)) !== null) {
    if (isInsideRanges(match.index, protectedRanges)) continue;
    const refs = parseRefs(match[1] ?? '');
    if (refs.length === 0) continue;
    tokens.push({
      start: match.index,
      end: match.index + match[0].length,
      raw: match[0],
      refs,
    });
  }
  return tokens;
}

export function extractCanonicalCitationRefs(markdown: string): readonly string[] {
  const refs: string[] = [];
  const seen = new Set<string>();
  for (const token of parseMarkdownCitationTokens(markdown)) {
    for (const ref of token.refs) {
      if (seen.has(ref)) continue;
      seen.add(ref);
      refs.push(ref);
    }
  }
  return refs;
}

/**
 * 找出正文中完整但不符合 canonical ref 合同的 citation-like token。
 * 与正式解析器共享 code/comment 保护范围，示例与注释不会阻塞文档写入。
 */
export function findInvalidMarkdownCitationTokens(markdown: string): readonly string[] {
  const protectedRanges = collectProtectedRanges(markdown);
  const invalid: string[] = [];
  let match: RegExpExecArray | null;

  CITATION_GROUP_PATTERN.lastIndex = 0;
  while ((match = CITATION_GROUP_PATTERN.exec(markdown)) !== null) {
    if (isInsideRanges(match.index, protectedRanges)) continue;
    if (!isCanonicalCitationGroup(match[1] ?? '')) invalid.push(match[0]);
  }
  return invalid;
}
