import type { DocumentPreviewContent } from '@app/schemas';

/** 卡片只露出开头一屏；正文上限按字符截在段落边界，避免为一张卡解析整篇长文。 */
export const CANVAS_DOCUMENT_PREVIEW_BODY_LIMIT = 6000;
export type CanvasDocumentPreviewBody = NonNullable<DocumentPreviewContent['detail']>;

export function canvasDocumentPreviewBody(
  detail: DocumentPreviewContent['detail']
): CanvasDocumentPreviewBody | undefined {
  if (!detail || !detail.text.trim()) return undefined;
  if (detail.text.length <= CANVAS_DOCUMENT_PREVIEW_BODY_LIMIT) return detail;
  const head = detail.text.slice(0, CANVAS_DOCUMENT_PREVIEW_BODY_LIMIT);
  const paragraph = head.lastIndexOf('\n\n');
  return { format: detail.format, text: paragraph > 0 ? head.slice(0, paragraph) : head };
}
