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

function collectFencedCodeRanges(markdown: string): readonly TextRange[] {
  const ranges: TextRange[] = [];
  let open: { readonly start: number; readonly marker: '`' | '~'; readonly length: number } | null =
    null;
  let lineStart = 0;

  while (lineStart <= markdown.length) {
    const newlineIndex = markdown.indexOf('\n', lineStart);
    const lineEnd = newlineIndex === -1 ? markdown.length : newlineIndex + 1;
    const line = markdown.slice(lineStart, newlineIndex === -1 ? markdown.length : newlineIndex);
    const match = /^( {0,3})(`{3,}|~{3,})(.*)$/.exec(line);

    if (match) {
      const markerRun = match[2];
      const marker = markerRun[0] as '`' | '~';
      if (!open) {
        open = { start: lineStart, marker, length: markerRun.length };
      } else if (
        open.marker === marker &&
        markerRun.length >= open.length &&
        (match[3] ?? '').trim().length === 0
      ) {
        ranges.push({ start: open.start, end: lineEnd });
        open = null;
      }
    }

    if (newlineIndex === -1) break;
    lineStart = newlineIndex + 1;
  }

  if (open) ranges.push({ start: open.start, end: markdown.length });
  return ranges;
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

function collectInlineCodeRanges(
  markdown: string,
  fencedRanges: readonly TextRange[]
): readonly TextRange[] {
  const ranges: TextRange[] = [];
  let cursor = 0;

  while (cursor < markdown.length) {
    if (isInsideRanges(cursor, fencedRanges)) {
      const containingRange = fencedRanges.find(
        range => cursor >= range.start && cursor < range.end
      );
      cursor = containingRange?.end ?? cursor + 1;
      continue;
    }
    if (markdown[cursor] !== '`' || isEscaped(markdown, cursor)) {
      cursor += 1;
      continue;
    }

    const delimiterLength = countRun(markdown, cursor, '`');
    let closingStart = cursor + delimiterLength;
    while (closingStart < markdown.length) {
      if (isInsideRanges(closingStart, fencedRanges)) break;
      const candidate = markdown.indexOf('`', closingStart);
      if (candidate === -1 || isInsideRanges(candidate, fencedRanges)) break;
      if (isEscaped(markdown, candidate)) {
        closingStart = candidate + 1;
        continue;
      }
      const candidateLength = countRun(markdown, candidate, '`');
      if (candidateLength === delimiterLength) {
        ranges.push({ start: cursor, end: candidate + candidateLength });
        cursor = candidate + candidateLength;
        closingStart = -1;
        break;
      }
      closingStart = candidate + candidateLength;
    }
    if (closingStart !== -1) cursor += delimiterLength;
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
 * fenced code 与 inline code 只属于文档示例，不能创建引用事实。
 */
export function parseMarkdownCitationTokens(markdown: string): readonly MarkdownCitationToken[] {
  const fencedRanges = collectFencedCodeRanges(markdown);
  const protectedRanges = [
    ...fencedRanges,
    ...collectInlineCodeRanges(markdown, fencedRanges),
  ].sort((left, right) => left.start - right.start);
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
 * 与正式解析器共享 fenced/inline code 保护范围，代码示例不会阻塞文档写入。
 */
export function findInvalidMarkdownCitationTokens(markdown: string): readonly string[] {
  const fencedRanges = collectFencedCodeRanges(markdown);
  const protectedRanges = [
    ...fencedRanges,
    ...collectInlineCodeRanges(markdown, fencedRanges),
  ].sort((left, right) => left.start - right.start);
  const invalid: string[] = [];
  let match: RegExpExecArray | null;

  CITATION_GROUP_PATTERN.lastIndex = 0;
  while ((match = CITATION_GROUP_PATTERN.exec(markdown)) !== null) {
    if (isInsideRanges(match.index, protectedRanges)) continue;
    if (!isCanonicalCitationGroup(match[1] ?? '')) invalid.push(match[0]);
  }
  return invalid;
}
