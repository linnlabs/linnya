import type { DocumentPreviewResult, DocumentReferencePresentation } from '@app/schemas';
export interface DocumentPreviewTarget {
  readonly documentId: string;
  readonly projectId: string;
}
export interface DocumentPreviewPresentation {
  readonly target: DocumentPreviewTarget;
  readonly presentation: DocumentReferencePresentation;
  readonly preview: DocumentPreviewResult;
}
