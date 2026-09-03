import type { ManagedImageContentIngressPort } from 'src/domains/assets/features/managed-image-ingress';
import type { WorkspaceVerifiedImageLoaderPort } from 'src/features/workspace/assets/shared/verified-image';
import type { SupportedImageMediaType } from 'src/shared/media/image-inspection';
import type { DocumentAssetOwnershipPort } from '../../document-assets';

export interface DocumentImageAsset {
  readonly assetId: string;
  readonly mediaType: SupportedImageMediaType;
  readonly byteLength: number;
  readonly width: number;
  readonly height: number;
  readonly sha256: string;
  readonly dataUri: string;
}

export interface DocumentImageAssetRuntimePort {
  adoptLocalImage(input: {
    readonly documentId: string;
    readonly sourcePath: string;
    readonly usageHint: string;
  }): Promise<DocumentImageAsset>;
  adoptImageBytes(input: {
    readonly documentId: string;
    readonly bytes: Uint8Array;
    readonly usageHint: string;
  }): Promise<DocumentImageAsset>;
  readOwnedImage(input: {
    readonly documentId: string;
    readonly assetId: string;
  }): Promise<DocumentImageAsset>;
}

export type { DocumentAssetOwnershipPort } from '../../document-assets';

export interface DocumentImageAssetRuntimeDependencies {
  readonly imageIngress: ManagedImageContentIngressPort;
  readonly imageLoader: WorkspaceVerifiedImageLoaderPort;
  readonly ownership: DocumentAssetOwnershipPort;
}

/**
 * 文档图片接管 use case 对外暴露的稳定失败事实。
 *
 * 这里有意不暴露 fs、SQLite、图片解码器等下层异常；调用方只需要知道
 * “来源应修改”还是“受管存储需要恢复”，具体实现仍留在各自 domain 内。
 */
export type DocumentImageAssetRuntimeFailure =
  | 'asset_not_owned'
  | 'local_source_missing'
  | 'local_source_not_file'
  | 'local_source_unreadable'
  | 'invalid_media'
  | 'media_limit_exceeded'
  | 'managed_asset_unavailable'
  | 'managed_asset_integrity_failed'
  | 'storage_conflict'
  | 'store_unavailable';

export class DocumentImageAssetRuntimeError extends Error {
  readonly name = 'DocumentImageAssetRuntimeError';

  constructor(
    readonly failure: DocumentImageAssetRuntimeFailure,
    readonly documentId: string,
    readonly assetId: string | null
  ) {
    super(`Document image asset failed: ${failure}`);
  }
}
