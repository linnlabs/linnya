import type { DocumentReferenceCandidate, DocumentReferencePresentation } from '@app/schemas';
export interface DocumentReferenceUiPort {
  getProjectId(): string | null;
  query(keyword: string): Promise<readonly DocumentReferenceCandidate[]>;
  resolve(documentId: string): Promise<DocumentReferencePresentation>;
  readCached(documentId: string): DocumentReferencePresentation | null;
  subscribe(documentId: string, listener: () => void): () => void;
  /** onReady：首屏排好后通知，浮层据此露出。 */
  mountPreview(
    documentId: string,
    element: HTMLElement,
    signal: AbortSignal,
    onReady: () => void
  ): Promise<() => void>;
  renderIcon(nodeType: string, element: HTMLElement): () => void;
  open(presentation: DocumentReferencePresentation): Promise<void>;
  dispose(): void;
  report(error: unknown): void;
}
