import type {
  ManagedSvgAssetRuntimePort,
  MaterializedManagedSvgAsset,
} from 'src/domains/assets/features/managed-svg-asset';
import type { DocumentAssetOwnershipPort } from '../../document-assets';

export type DocumentSvgAsset = MaterializedManagedSvgAsset;

export interface DocumentSvgAssetRuntimePort {
  adoptCanonicalSvg(input: {
    readonly documentId: string;
    readonly canonicalSvg: string;
    readonly contentHash: string;
    readonly usageHint: string;
  }): Promise<DocumentSvgAsset>;
  readOwnedSvg(input: {
    readonly documentId: string;
    readonly assetId: string;
  }): Promise<DocumentSvgAsset>;
}

export interface DocumentSvgAssetRuntimeDependencies {
  readonly svgAssets: ManagedSvgAssetRuntimePort;
  readonly ownership: DocumentAssetOwnershipPort;
}

export type DocumentSvgAssetRuntimeFailure =
  | 'asset_not_owned'
  | 'invalid_canonical_content'
  | 'content_limit_exceeded'
  | 'managed_asset_unavailable'
  | 'managed_asset_integrity_failed'
  | 'storage_conflict'
  | 'store_unavailable';

export class DocumentSvgAssetRuntimeError extends Error {
  readonly name = 'DocumentSvgAssetRuntimeError';

  constructor(
    readonly failure: DocumentSvgAssetRuntimeFailure,
    readonly documentId: string,
    readonly assetId: string | null
  ) {
    super(`Document SVG asset failed: ${failure}`);
  }
}
