import type {
  DocumentPreviewPresentation,
  DocumentPreviewTarget,
} from '../definitions/documentPreview';

export function isSameDocumentPreviewTarget(
  shown: DocumentPreviewTarget | undefined,
  next: DocumentPreviewTarget
): boolean {
  return shown?.documentId === next.documentId && shown.projectId === next.projectId;
}

/** 重新读取后画面是否不变：正文由修订键代表，不深比较可能很大的正文和内联图片。 */
export function isSameDocumentPreview(
  shown: DocumentPreviewPresentation,
  next: DocumentPreviewPresentation
): boolean {
  return (
    isSameDocumentPreviewTarget(shown.target, next.target) &&
    JSON.stringify(shown.presentation) === JSON.stringify(next.presentation) &&
    shown.preview.status === next.preview.status &&
    shown.preview.title === next.preview.title &&
    shown.preview.nodeType === next.preview.nodeType &&
    shown.preview.content?.revisionKey === next.preview.content?.revisionKey &&
    shown.preview.content?.summary === next.preview.content?.summary
  );
}
