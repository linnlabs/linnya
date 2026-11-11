/**
 * 深搜交接原文：从子 Agent 实际读到的正文里按定位短语截取，每源最多两段、每段约 600 字。
 * 程序只截取、不改写；短语找不到就如实列出，并退回正文开头，不让父 Agent 以为看到的是被引用的那段。
 */

import { DEEP_WEB_EXCERPT_CHARS, DEEP_WEB_MAX_EXCERPTS } from '@app/schemas';
import { findInText } from 'src/shared/text/findInText';

/** 子 Agent 对同一来源的一次读取结果文字：网页窗口、PDF 页文字、查找上下文或搜索摘要。 */
export interface SourceText {
  readonly text: string;
  /** 查找上下文与搜索摘要只是片段，定位时排在完整窗口之后，也不作开头回退的首选。 */
  readonly fragment: boolean;
  /** 这段从来源开头读起（窗口偏移 0 或 PDF 第 1 页）；回退时优先用最后一次这样的读取。 */
  readonly fromStart?: boolean;
}

export interface SourceExcerpt {
  readonly text: string;
  readonly located: 'anchor' | 'start';
  readonly anchor?: string;
  readonly page?: number;
}

export interface LocatedExcerpts {
  readonly excerpts: readonly SourceExcerpt[];
  readonly unmatchedAnchors: readonly string[];
}

/** 定位点前保留约三分之一窗口的上文。 */
const LEAD_RATIO = 1 / 3;
const PAGE_MARKER = /\[Page (\d+)(?::[^\]]*)?\]/gu;

function pageAt(text: string, position: number): number | undefined {
  let page: number | undefined;
  for (const match of text.matchAll(PAGE_MARKER)) {
    if ((match.index ?? 0) > position) break;
    page = Number(match[1]);
  }
  return page;
}

/** 截取 [start, start+width)，不拆开 UTF-16 代理对，并在两端被截断时加省略号。 */
function cut(text: string, start: number, width: number): string {
  let from = Math.max(0, start);
  let to = Math.min(text.length, from + width);
  const first = text.charCodeAt(from);
  if (first >= 0xdc00 && first <= 0xdfff) from += 1;
  const last = text.charCodeAt(to - 1);
  if (to < text.length && last >= 0xd800 && last <= 0xdbff) to -= 1;
  return `${from > 0 ? '…' : ''}${text.slice(from, to).trim()}${to < text.length ? '…' : ''}`;
}

export function locateSourceExcerpts(input: {
  readonly texts: readonly SourceText[];
  readonly anchors: readonly string[];
  readonly width?: number;
  readonly maxExcerpts?: number;
}): LocatedExcerpts {
  const width = input.width ?? DEEP_WEB_EXCERPT_CHARS;
  const maxExcerpts = input.maxExcerpts ?? DEEP_WEB_MAX_EXCERPTS;
  const ordered = [...input.texts.filter(text => !text.fragment), ...input.texts.filter(text => text.fragment)]
    .filter(text => text.text.trim().length > 0);
  const excerpts: SourceExcerpt[] = [];
  /** 已截取的区间（按文本下标），第二个短语落在已截取段内时不重复截。 */
  const taken: { readonly text: number; readonly start: number; readonly end: number }[] = [];
  const unmatchedAnchors: string[] = [];

  for (const anchor of input.anchors.slice(0, maxExcerpts)) {
    let located = false;
    for (let index = 0; index < ordered.length && !located; index += 1) {
      const source = ordered[index]!.text;
      const [match] = findInText(source, anchor, 1, 0).matches;
      if (!match) continue;
      located = true;
      if (taken.some(range => range.text === index && match.start >= range.start && match.end <= range.end)) break;
      const span = match.end - match.start;
      const start = span >= width ? match.start : Math.max(0, match.start - Math.floor((width - span) * LEAD_RATIO));
      const page = pageAt(source, match.start);
      taken.push({ text: index, start, end: start + width });
      excerpts.push({
        text: cut(source, start, width),
        located: 'anchor',
        anchor,
        ...(page !== undefined ? { page } : {}),
      });
    }
    if (!located) unmatchedAnchors.push(anchor);
  }

  const fallback = [...ordered].reverse().find(text => !text.fragment && text.fromStart) ?? ordered[0];
  if (excerpts.length === 0 && fallback) {
    const source = fallback.text;
    const page = pageAt(source, 0);
    excerpts.push({ text: cut(source, 0, width), located: 'start', ...(page !== undefined ? { page } : {}) });
  }
  return { excerpts, unmatchedAnchors };
}
