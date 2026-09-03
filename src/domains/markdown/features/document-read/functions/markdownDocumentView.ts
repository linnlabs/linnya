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

function buildBodyFromBlocksRef(blocks: readonly FlattenedMarkdownBlock[]): string {
  return blocks
    .map((block) => {
      // Markdown 前导空格可能表达列表嵌套；这里只去掉行尾空白。
      const text = block.text.trimEnd();
      return `[${block.ref}] ${text}`;
    })
    .join('\n\n');
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
  const windowResult = sliceTextWindow(
    buildBodyFromBlocksRef(blocks),
    offsetChars,
    maxChars,
    addTruncatedSuffix,
  );
  const meta: DocumentViewMeta = {
    documentId,
    docType: 'markdown',
    offsetChars,
    truncatedByChars: windowResult.truncated,
    totalTextLength: windowResult.totalLength,
    nextOffset: windowResult.nextOffset,
  };

  return {
    documentViewText: buildDocumentView(meta, windowResult.text),
    bodyWindowText: windowResult.text,
    totalTextLength: windowResult.totalLength,
    truncatedByChars: windowResult.truncated,
    nextOffset: windowResult.nextOffset,
  };
}
