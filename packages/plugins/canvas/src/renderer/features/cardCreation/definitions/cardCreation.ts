import type { DocumentImageAsset, DocumentReferenceCandidate } from '@app/schemas';
export interface CanvasCardCreationPort {
  prepareImage(documentId: string, bytesBase64: string): Promise<DocumentImageAsset>;
  queryDocuments(keyword: string): Promise<readonly DocumentReferenceCandidate[]>;
}
export type CanvasPreparedImage = Pick<
  DocumentImageAsset,
  'assetId' | 'displayWidth' | 'displayHeight'
>;
