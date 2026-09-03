export type DocumentReferenceFocusStatus =
  | 'focused'
  | 'document-not-ready'
  | 'reference-not-found';

export interface DocumentReferenceFocusResult {
  status: DocumentReferenceFocusStatus;
}

export interface DocumentReferenceRuntimeHandler {
  documentType: string;
  /**
   * 当前文档类型的引用展示名，例如“节点引用”。
   */
  referenceLabel?: string;
  getCurrentDocumentId(): string | null;
  listReferenceIds(documentId: string): Promise<readonly string[]>;
  waitForDocumentReady(documentId: string, timeoutMs: number): Promise<boolean>;
  focusReference(args: {
    documentId: string;
    referenceId: string;
  }): Promise<DocumentReferenceFocusResult>;
}

export declare function registerDocumentReferenceRuntimeHandler(handler: DocumentReferenceRuntimeHandler): void;
export declare function unregisterDocumentReferenceRuntimeHandler(documentType: string): void;
