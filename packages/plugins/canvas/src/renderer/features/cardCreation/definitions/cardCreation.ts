import type { DocumentImageAsset, DocumentReferenceCandidate } from '@app/schemas';
import type { CanvasCommitResult, CanvasImportImageRequest, CanvasPoint } from '@plugin/canvas/shared';
export interface CanvasCardCreationPort {
  importImage(input: CanvasImportImageRequest): Promise<CanvasCommitResult>;
  prepareImage(documentId: string, bytesBase64: string): Promise<DocumentImageAsset>;
  queryDocuments(keyword: string): Promise<readonly DocumentReferenceCandidate[]>;
}
export interface CanvasCreationTarget { readonly point: CanvasPoint; readonly documentId: string; readonly viewId: string }
