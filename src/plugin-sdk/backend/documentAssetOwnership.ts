import { releaseDocumentAssetOwnership as release } from 'src/app-hosts/linnya/application/document-assets';
import { requireDocumentAssetDatabase } from './documentAssetRuntimeDatabase';

export function releaseDocumentAssetOwnership(input: { readonly database: unknown; readonly documentId: string; readonly assetIds: readonly string[] }): void {
  release(requireDocumentAssetDatabase(input.database), input.documentId, input.assetIds);
}
