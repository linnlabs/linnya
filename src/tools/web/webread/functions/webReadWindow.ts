/**
 * 在已保存的网页正文快照里取一段或查找。快照最多 WEB_READ_MAX_CAPTURE_CHARS 字，单次只返回
 * 有界窗口；模型用 next_offset 续读、用 find 跳到关键词附近，重读不重新抓取。
 */

import { findInText } from 'src/shared/text/findInText';

/** 窗口末尾往回找换行的最大回退比例：只在最后 20% 内回退，避免窗口过短。 */
const LINE_BREAK_BACKOFF_RATIO = 0.2;
const FIND_MAX_CONTEXTS = 20;
const FIND_CONTEXT_CHARS = 200;

export class WebReadWindowError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WebReadWindowError';
  }
}

export interface WebTextWindow {
  readonly offset: number;
  readonly end: number;
  readonly totalChars: number;
  readonly nextOffset?: number;
  readonly content: string;
}

export function sliceWebTextWindow(full: string, offset: number, maxChars: number): WebTextWindow {
  if (offset > 0 && offset >= full.length) {
    throw new WebReadWindowError(
      `[WEB_READ_OFFSET_OUT_OF_RANGE] offset ${offset} is at or past the end of the saved text (${full.length} characters). Use the next_offset from the previous result, or find to locate a passage.`,
    );
  }
  let end = Math.min(full.length, offset + maxChars);
  if (end < full.length) {
    const floor = end - Math.floor(maxChars * LINE_BREAK_BACKOFF_RATIO);
    const lineBreak = full.lastIndexOf('\n', end - 1);
    if (lineBreak >= Math.max(floor, offset + 1)) end = lineBreak + 1;
    const last = full.charCodeAt(end - 1);
    // 不拆开 UTF-16 代理对。
    if (last >= 0xd800 && last <= 0xdbff) end -= 1;
  }
  return {
    offset,
    end,
    totalChars: full.length,
    ...(end < full.length ? { nextOffset: end } : {}),
    content: full.slice(offset, end),
  };
}

export interface WebTextFindResult {
  readonly hitCount: number;
  readonly matches: readonly { readonly offset: number; readonly context: string }[];
  readonly truncated: boolean;
}

export function findInWebText(full: string, query: string): WebTextFindResult {
  const found = findInText(full, query, FIND_MAX_CONTEXTS, FIND_CONTEXT_CHARS);
  return {
    hitCount: found.count,
    matches: found.matches.map(match => ({ offset: match.start, context: match.context })),
    truncated: found.matches.length < found.count,
  };
}
