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

function skipLinkWhitespace(markdown: string, start: number): number | null {
  let cursor = start;
  let newlines = 0;
  while (cursor < markdown.length && /[ \t\r\n]/.test(markdown[cursor])) {
    if (markdown[cursor] === '\n' && ++newlines > 1) return null;
    cursor += 1;
  }
  return cursor;
}

/** 这里只读取词法边界，不解码 URL；原始 destination 和 title 必须逐字保留。 */
function readLinkDestinationEnd(markdown: string, start: number): number | null {
  let cursor = start;
  if (markdown[cursor] === '<') {
    for (cursor += 1; cursor < markdown.length; cursor += 1) {
      const character = markdown[cursor];
      if (character === '\n' || character === '\r' || character === '<') return null;
      if (character === '>') return cursor + 1;
      if (character === '\\' && cursor + 1 < markdown.length) cursor += 1;
    }
    return null;
  }

  let depth = 0;
  for (; cursor < markdown.length; cursor += 1) {
    const character = markdown[cursor];
    const code = markdown.charCodeAt(cursor);
    if (character === ' ' || code < 0x20 || code === 0x7f) break;
    if (character === '\\' && cursor + 1 < markdown.length) {
      if (markdown[cursor + 1] === ' ') break;
      cursor += 1;
      continue;
    }
    if (character === '(' && ++depth > 32) return null;
    if (character === ')') {
      if (depth === 0) break;
      depth -= 1;
    }
  }
  return cursor > start && depth === 0 ? cursor : null;
}

function readLinkTitleEnd(markdown: string, start: number): number | null {
  const opener = markdown[start];
  if (opener !== '"' && opener !== "'" && opener !== '(') return null;
  const closer = opener === '(' ? ')' : opener;
  for (let cursor = start + 1; cursor < markdown.length; cursor += 1) {
    const character = markdown[cursor];
    if (character === closer) return cursor + 1;
    if (opener === '(' && character === '(') return null;
    if (character === '\n' && /^\n[\t ]*\r?\n/.test(markdown.slice(cursor))) return null;
    if (character === '\\' && cursor + 1 < markdown.length) cursor += 1;
  }
  return null;
}

function readInlineLinkEnd(markdown: string, parenthesis: number): number | null {
  const start = skipLinkWhitespace(markdown, parenthesis + 1);
  if (start === null) return null;
  if (markdown[start] === ')') return start + 1;
  const destinationEnd = readLinkDestinationEnd(markdown, start);
  if (destinationEnd === null) return null;
  const afterDestination = skipLinkWhitespace(markdown, destinationEnd);
  if (afterDestination === null) return null;
  if (markdown[afterDestination] === ')') return afterDestination + 1;
  if (afterDestination === destinationEnd) return null;
  const titleEnd = readLinkTitleEnd(markdown, afterDestination);
  if (titleEnd === null) return null;
  const afterTitle = skipLinkWhitespace(markdown, titleEnd);
  return afterTitle !== null && markdown[afterTitle] === ')' ? afterTitle + 1 : null;
}

function readAutolinkEnd(markdown: string, start: number): number | null {
  if (markdown[start] !== '<' || isEscaped(markdown, start)) return null;
  // CommonMark URI autolink；不引入裸 URL 自动 linkify 或把普通尖括号正文当链接。
  const scheme = /^[a-zA-Z][a-zA-Z\d+.-]{1,31}:/.exec(markdown.slice(start + 1, start + 35));
  if (!scheme) return null;
  for (let cursor = start + 1 + scheme[0].length; cursor < markdown.length; cursor += 1) {
    const character = markdown[cursor];
    if (character === '>') return cursor + 1;
    if (character === '<' || /[\s\u0000-\u001f]/.test(character)) return null;
  }
  return null;
}

function skipHorizontalSpace(markdown: string, start: number): number {
  let cursor = start;
  while (markdown[cursor] === ' ' || markdown[cursor] === '\t' || markdown[cursor] === '\r') cursor += 1;
  return cursor;
}

function readReferenceDestinationRange(markdown: string, start: number): TextRange | null {
  if (start > 0 && markdown[start - 1] !== '\n') return null;
  let cursor = start;
  while (markdown[cursor] === ' ' && cursor - start < 4) cursor += 1;
  if (cursor - start > 3 || markdown[cursor] !== '[') return null;
  const labelStart = ++cursor;
  while (cursor < markdown.length && markdown[cursor] !== ']') {
    if (markdown[cursor] === '[' || markdown[cursor] === '\n') return null;
    if (markdown[cursor] === '\\' && cursor + 1 < markdown.length) cursor += 1;
    cursor += 1;
  }
  if (!markdown.slice(labelStart, cursor).trim() || markdown[cursor + 1] !== ':') return null;
  const destinationStart = skipLinkWhitespace(markdown, cursor + 2);
  if (destinationStart === null) return null;
  const destinationEnd = readLinkDestinationEnd(markdown, destinationStart);
  if (destinationEnd === null) return null;
  const afterDestination = skipHorizontalSpace(markdown, destinationEnd);
  const newline = markdown[afterDestination] === '\n';
  const titleStart = newline ? skipHorizontalSpace(markdown, afterDestination + 1) : afterDestination;
  const titleEnd = titleStart > destinationEnd ? readLinkTitleEnd(markdown, titleStart) : null;
  if (titleEnd !== null) {
    const afterTitle = skipHorizontalSpace(markdown, titleEnd);
    if (afterTitle === markdown.length || markdown[afterTitle] === '\n') {
      return { start: destinationStart, end: titleEnd };
    }
  }
  // 下一行不是 title 时，它仍是正文；不能把后续段落一并隐藏。
  return newline || afterDestination === markdown.length
    ? { start: destinationStart, end: destinationEnd } : null;
}

/**
 * 按词法顺序接纳 code、comment 与链接目的区，而不是分别扫描后再合并。
 * 先进入的结构拥有其内部文字；label 仍是正文，destination/title 则不能创建引用。
 */
function collectProtectedRanges(markdown: string): readonly TextRange[] {
  const ranges: TextRange[] = [];
  const labels: Array<{ readonly image: boolean; containsLink: boolean }> = [];
  let cursor = 0;
  while (cursor < markdown.length) {
    const fence = readCodeFence(markdown, cursor);
    if (fence) {
      const end = findFenceEnd(markdown, fence);
      ranges.push({ start: cursor, end });
      labels.length = 0;
      cursor = end;
      continue;
    }
    const reference = labels.length === 0 ? readReferenceDestinationRange(markdown, cursor) : null;
    if (reference) {
      ranges.push(reference);
      labels.length = 0;
      cursor = reference.end;
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
    const autolinkEnd = readAutolinkEnd(markdown, cursor);
    if (autolinkEnd !== null) {
      ranges.push({ start: cursor, end: autolinkEnd });
      cursor = autolinkEnd;
      continue;
    }
    if (!isEscaped(markdown, cursor)) {
      if (markdown[cursor] === '[') labels.push({
        image: markdown[cursor - 1] === '!' && !isEscaped(markdown, cursor - 1),
        containsLink: false,
      });
      if (markdown[cursor] === ']') {
        const label = labels.pop();
        if (label && (label.image || !label.containsLink) && markdown[cursor + 1] === '(') {
          const end = readInlineLinkEnd(markdown, cursor + 1);
          if (end !== null) {
            // label 是可见正文，只有 destination/title 不参与 ref 接纳与回投。
            // Markdown link 不能再包含 link；image 则可以位于 link label 中。
            if (!label.image) labels.forEach(parent => { parent.containsLink = true; });
            ranges.push({ start: cursor + 1, end });
            cursor = end;
            continue;
          }
        }
      }
    }
    if (markdown[cursor] === '\n' && /^\n[\t ]*\r?\n/.test(markdown.slice(cursor))) labels.length = 0;
    cursor += 1;
  }
  return ranges;
}

interface CitationGroup {
  readonly start: number;
  readonly end: number;
  readonly raw: string;
  readonly group: string;
}

function collectCitationGroups(markdown: string): readonly CitationGroup[] {
  const groups: CitationGroup[] = [];
  const scan = (start: number, end: number) => {
    const text = markdown.slice(start, end);
    let match: RegExpExecArray | null;
    CITATION_GROUP_PATTERN.lastIndex = 0;
    while ((match = CITATION_GROUP_PATTERN.exec(text)) !== null) {
      groups.push({
        start: start + match.index, end: start + match.index + match[0].length,
        raw: match[0], group: match[1] ?? '',
      });
    }
  };
  let cursor = 0;
  for (const range of collectProtectedRanges(markdown)) {
    // 保护区里的半个 [@ 不能配到区外的 ]，否则一个 URL/示例会吞掉后续正文引用。
    scan(cursor, range.start);
    cursor = range.end;
  }
  scan(cursor, markdown.length);
  return groups;
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
 * code、HTML comment 与链接 destination/title 中的 token 不创建引用事实。
 */
export function parseMarkdownCitationTokens(markdown: string): readonly MarkdownCitationToken[] {
  const tokens: MarkdownCitationToken[] = [];
  for (const group of collectCitationGroups(markdown)) {
    const refs = parseRefs(group.group);
    if (refs.length === 0) continue;
    tokens.push({ start: group.start, end: group.end, raw: group.raw, refs });
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
 * 与正式解析器共享词法保护范围，示例、注释和链接目的区不会阻塞文档写入。
 */
export function findInvalidMarkdownCitationTokens(markdown: string): readonly string[] {
  return collectCitationGroups(markdown)
    .filter(group => !isCanonicalCitationGroup(group.group))
    .map(group => group.raw);
}
