import type { DocumentPreviewTarget } from '../definitions/documentPreview';
export function assertDocumentPreviewScope(
  target: DocumentPreviewTarget,
  currentProjectId: string | null
): void {
  if (target.projectId !== currentProjectId) throw new Error('文档不在当前项目，无法预览');
}
