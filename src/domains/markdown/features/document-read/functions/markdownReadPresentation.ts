/**
 * @file markdownReadPresentation.ts
 * @description 从同一正文窗口及块范围构建 UI presentation，不反解析展示字符串。
 */

import type { WorkspaceDocumentReadPresentation } from '@app/schemas';
import type { MarkdownDocumentViewWindow } from '../definitions/markdownDocumentViewWindow';

export function buildMarkdownReadPresentation(params: {
  readonly window: MarkdownDocumentViewWindow;
  readonly viewMode: 'preview' | 'base';
  readonly viewLabel: string;
}): WorkspaceDocumentReadPresentation {
  const { window, viewMode, viewLabel } = params;
  // 字符窗口从块中间开始，或末尾只取得半个 ref 时，保留原始片段并明确显示为文本。
  // 这是已知窗口边界，不是未知块校验失败后的 fallback；块身份始终来自真实展平结果。
  if (window.blockRanges.some((range) => (
    range.startOffset < window.startOffset || range.refEndOffset > window.endOffset
  ))) {
    return { kind: 'text', text: window.text };
  }
  return {
    kind: 'blocks',
    viewMode,
    viewLabel,
    items: window.blockRanges.map((range) => ({
      id: range.block.blockId,
      ordinal: range.block.index,
      text: window.text.slice(
        Math.min(range.contentOffset, window.endOffset) - window.startOffset,
        Math.min(range.endOffset, window.endOffset) - window.startOffset,
      ),
    })),
  };
}
