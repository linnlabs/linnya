import type { FlattenedMarkdownBlock } from '../../../shared/markdownBlockProjection';

/** 与 DocumentView 正文同时生成的块范围，不从展示用 ref 字符串反推身份。 */
export interface MarkdownDocumentViewBlockRange {
  readonly block: FlattenedMarkdownBlock;
  readonly startOffset: number;
  readonly refEndOffset: number;
  readonly contentOffset: number;
  readonly endOffset: number;
}

export interface MarkdownDocumentViewWindow {
  /** 未附加截断提示或 XML 包装的实际正文。 */
  readonly text: string;
  readonly startOffset: number;
  readonly endOffset: number;
  readonly blockRanges: readonly MarkdownDocumentViewBlockRange[];
}
