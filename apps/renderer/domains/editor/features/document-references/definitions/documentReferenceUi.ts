import type { DocumentReferenceCandidate, DocumentReferencePresentation } from '@app/schemas';
export interface DocumentReferenceUiPort {
  getProjectId(): string | null;
  query(keyword: string): Promise<readonly DocumentReferenceCandidate[]>;
  resolve(documentId: string): Promise<DocumentReferencePresentation>;
  readCached(documentId: string): DocumentReferencePresentation | null;
  subscribe(documentId: string, listener: () => void): () => void;
  mountPreview(documentId: string, element: HTMLElement, signal: AbortSignal): Promise<() => void>;
  renderIcon(nodeType: string, element: HTMLElement): () => void;
  open(presentation: DocumentReferencePresentation): Promise<void>;
  dispose(): void;
  report(error: unknown): void;
}
