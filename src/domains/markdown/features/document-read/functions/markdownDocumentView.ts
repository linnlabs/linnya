/**
 * @file markdownDocumentView.ts
 * @description 将 Markdown 文档块投影为带稳定 ref 的结构化 DocumentView。
 */

import type { DocumentViewMeta } from '@app/schemas';
import {
  buildDocumentView,
  sliceTextWindow,
} from '@app/schemas';
import {
  flattenMarkdownDocumentBlocks,
  type FlattenedMarkdownBlock,
} from '../../../shared/markdownBlockProjection';
import type {
  MarkdownDocumentViewBlockRange,
  MarkdownDocumentViewWindow,
} from '../definitions/markdownDocumentViewWindow';

function buildBodyFromBlocksRef(blocks: readonly FlattenedMarkdownBlock[]): {
  readonly text: string;
  readonly blockRanges: readonly MarkdownDocumentViewBlockRange[];
} {
  const parts: string[] = [];
  const blockRanges: MarkdownDocumentViewBlockRange[] = [];
  let offset = 0;
  for (const block of blocks) {
    if (parts.length > 0) offset += 2;
    // Markdown 前导空格可能表达列表嵌套；这里只去掉行尾空白。
    const prefix = `[${block.ref}]`;
    const part = `${prefix} ${block.text.trimEnd()}`;
    blockRanges.push({
      block,
      startOffset: offset,
      refEndOffset: offset + prefix.length,
      contentOffset: offset + prefix.length + 1,
      endOffset: offset + part.length,
    });
    parts.push(part);
    offset += part.length;
  }
  return { text: parts.join('\n\n'), blockRanges };
}

export interface BuildMarkdownDocumentViewOptions {
  readonly documentId: string;
  readonly preFlattenedBlocks?: readonly FlattenedMarkdownBlock[];
  readonly offsetChars?: number;
  readonly maxChars?: number;
  readonly addTruncatedSuffix?: boolean;
}

export interface MarkdownDocumentViewResult {
  readonly documentViewText: string;
  /** 当前字符窗口的纯正文；Citation 窗口匹配不得扫描 XML 包装或截断提示。 */
  readonly bodyWindowText: string;
  readonly presentationWindow: MarkdownDocumentViewWindow;
  readonly totalTextLength: number;
  readonly truncatedByChars: boolean;
  readonly nextOffset: number | null;
}

export function buildMarkdownDocumentView(
  content: unknown,
  options: BuildMarkdownDocumentViewOptions,
): MarkdownDocumentViewResult {
  const {
    documentId,
    preFlattenedBlocks,
    offsetChars = 0,
    maxChars = 4000,
    addTruncatedSuffix = true,
  } = options;
  const blocks = preFlattenedBlocks
    ?? flattenMarkdownDocumentBlocks(content);
  const body = buildBodyFromBlocksRef(blocks);
  const windowResult = sliceTextWindow(
    body.text,
    offsetChars,
    maxChars,
    false,
  );
  const windowStart = Math.max(0, Math.min(offsetChars, body.text.length));
  const windowEnd = windowStart + windowResult.text.length;
  // 截断提示只属于 observation；它的右括号不能补全被切断的块 ref。
  const displayText = windowResult.truncated && addTruncatedSuffix
    ? `${windowResult.text}... [truncated]`
    : windowResult.text;
  const meta: DocumentViewMeta = {
    documentId,
    docType: 'markdown',
    offsetChars,
    truncatedByChars: windowResult.truncated,
    totalTextLength: windowResult.totalLength,
    nextOffset: windowResult.nextOffset,
  };

  return {
    documentViewText: buildDocumentView(meta, displayText),
    bodyWindowText: windowResult.text,
    presentationWindow: {
      text: windowResult.text,
      startOffset: windowStart,
      endOffset: windowEnd,
      blockRanges: body.blockRanges.filter((range) => (
        range.startOffset < windowEnd && range.endOffset > windowStart
      )),
    },
    totalTextLength: windowResult.totalLength,
    truncatedByChars: windowResult.truncated,
    nextOffset: windowResult.nextOffset,
  };
}
