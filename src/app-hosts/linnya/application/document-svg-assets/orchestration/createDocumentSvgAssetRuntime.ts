import { ManagedSvgAssetError } from 'src/domains/assets/features/managed-svg-asset';
import {
  DocumentSvgAssetRuntimeError,
  type DocumentSvgAssetRuntimeDependencies,
  type DocumentSvgAssetRuntimePort,
} from '../definitions/documentSvgAssetRuntime';

export function createDocumentSvgAssetRuntime(
  dependencies: DocumentSvgAssetRuntimeDependencies
): DocumentSvgAssetRuntimePort {
  return {
    async adoptCanonicalSvg(input) {
      try {
        const asset = await dependencies.svgAssets.adoptCanonicalSvg({
          canonicalSvg: input.canonicalSvg,
          contentHash: input.contentHash,
        });
        dependencies.ownership.ensureOwnership({
          documentId: input.documentId,
          assetId: asset.assetId,
          usageHint: input.usageHint,
        });
        return asset;
      } catch (error) {
        throw projectDocumentSvgFailure(error, input.documentId, null);
      }
    },
    async readOwnedSvg(input) {
      try {
        if (!dependencies.ownership.hasOwnership(input)) {
          throw new DocumentSvgAssetRuntimeError(
            'asset_not_owned',
            input.documentId,
            input.assetId
          );
        }
        return await dependencies.svgAssets.readManagedSvg({ assetId: input.assetId });
      } catch (error) {
        throw projectDocumentSvgFailure(error, input.documentId, input.assetId);
      }
    },
  };
}

function projectDocumentSvgFailure(
  error: unknown,
  documentId: string,
  assetId: string | null
): DocumentSvgAssetRuntimeError {
  if (error instanceof DocumentSvgAssetRuntimeError) return error;
  if (error instanceof ManagedSvgAssetError) {
    switch (error.failure) {
      case 'invalid_canonical_content':
        return new DocumentSvgAssetRuntimeError(
          'invalid_canonical_content',
          documentId,
          assetId
        );
      case 'content_limit_exceeded':
        return new DocumentSvgAssetRuntimeError('content_limit_exceeded', documentId, assetId);
      case 'asset_unavailable':
        return new DocumentSvgAssetRuntimeError(
          'managed_asset_unavailable',
          documentId,
          assetId
        );
      case 'integrity_failed':
        return new DocumentSvgAssetRuntimeError(
          'managed_asset_integrity_failed',
          documentId,
          assetId
        );
      case 'storage_conflict':
        return new DocumentSvgAssetRuntimeError('storage_conflict', documentId, assetId);
    }
  }
  return new DocumentSvgAssetRuntimeError('store_unavailable', documentId, assetId);
}
