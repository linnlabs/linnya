import type { DocumentReferenceCandidate, DocumentReferencePresentation, DocumentPreviewResult } from '@app/schemas';
export interface DocumentReferenceUiPort {
  getProjectId(): string | null;
  query(keyword: string): Promise<readonly DocumentReferenceCandidate[]>;
  resolve(documentId: string): Promise<DocumentReferencePresentation>;
  readCached(documentId: string): DocumentReferencePresentation | null;
  subscribe(documentId: string, listener: () => void): () => void;
  preview(documentId: string): Promise<DocumentPreviewResult>;
  renderIcon(nodeType: string, element: HTMLElement): () => void;
  recoveryAction(presentation: DocumentReferencePresentation): { readonly label: string; activate(): Promise<void> } | null;
  open(presentation: DocumentReferencePresentation): Promise<void>;
  readDetailRenderer(presentation: DocumentReferencePresentation): ((element: HTMLElement) => Promise<() => void>) | null;
  renderDetail(element: HTMLElement, markdown: string): Promise<() => void>;
  dispose(): void;
  report(error: unknown): void;
}
