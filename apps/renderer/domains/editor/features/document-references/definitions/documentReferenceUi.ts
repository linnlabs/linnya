import type { DocumentReferenceCandidate, DocumentReferencePresentation, DocumentPreviewResult } from '@app/schemas';
export interface DocumentReferenceUiPort {
  getProjectId(): string | null;
  query(keyword: string): Promise<readonly DocumentReferenceCandidate[]>;
  resolve(documentId: string): Promise<DocumentReferencePresentation>;
  readCached(documentId: string): DocumentReferencePresentation | null;
  subscribe(documentId: string, listener: () => void): () => void;
  preview(documentId: string): Promise<DocumentPreviewResult>;
  open(presentation: DocumentReferencePresentation): Promise<void>;
  renderDetail(element: HTMLElement, markdown: string): Promise<() => void>;
  dispose(): void;
  report(error: unknown): void;
}
