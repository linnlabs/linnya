import type { RegisteredLocalImageAsset } from 'src/domains/assets/features/local-image-registration';
import { LocalImageAssetRegistrationError } from 'src/domains/assets/features/local-image-registration';
import { ManagedImageIngressError } from 'src/domains/assets/features/managed-image-ingress';
import type { VerifiedWorkspaceImage } from 'src/features/workspace/assets/shared/verified-image';
import { WorkspaceVerifiedImageError } from 'src/features/workspace/assets/shared/verified-image';
import { ImageInspectionError } from 'src/shared/media/image-inspection';
import {
  DocumentImageAssetRuntimeError,
  type DocumentImageAsset,
  type DocumentImageAssetRuntimeDependencies,
  type DocumentImageAssetRuntimePort,
} from '../definitions/documentImageAssetRuntime';

function toDocumentImageAsset(image: VerifiedWorkspaceImage): DocumentImageAsset {
  return {
    assetId: image.assetId,
    mediaType: image.mediaType,
    byteLength: image.byteLength,
    width: image.width,
    height: image.height,
    sha256: image.sha256,
    dataUri: `data:${image.mediaType};base64,${Buffer.from(image.bytes).toString('base64')}`,
  };
}

export function createDocumentImageAssetRuntime(
  dependencies: DocumentImageAssetRuntimeDependencies
): DocumentImageAssetRuntimePort {
  async function materializeOwnedImage(input: {
    readonly documentId: string;
    readonly assetId: string;
  }): Promise<DocumentImageAsset> {
    if (!dependencies.ownership.hasOwnership(input)) {
      throw new DocumentImageAssetRuntimeError('asset_not_owned', input.documentId, input.assetId);
    }
    const [image] = await dependencies.imageLoader.loadImages([{ assetId: input.assetId }]);
    return toDocumentImageAsset(image);
  }

  async function ownAndMaterialize(input: {
    readonly documentId: string;
    readonly usageHint: string;
    readonly asset: RegisteredLocalImageAsset;
  }): Promise<DocumentImageAsset> {
    dependencies.ownership.ensureOwnership({
      documentId: input.documentId,
      assetId: input.asset.assetId,
      usageHint: input.usageHint,
    });
    return materializeOwnedImage({
      documentId: input.documentId,
      assetId: input.asset.assetId,
    });
  }

  return {
    async adoptLocalImage(input): Promise<DocumentImageAsset> {
      try {
        const asset = await dependencies.imageIngress.ingestLocalImage({
          sourcePath: input.sourcePath,
        });
        return await ownAndMaterialize({
          documentId: input.documentId,
          usageHint: input.usageHint,
          asset,
        });
      } catch (error) {
        throw projectDocumentImageFailure(error, input.documentId, null);
      }
    },
    async adoptImageBytes(input): Promise<DocumentImageAsset> {
      try {
        const asset = await dependencies.imageIngress.ingestImageBytes({
          bytes: input.bytes,
        });
        return await ownAndMaterialize({
          documentId: input.documentId,
          usageHint: input.usageHint,
          asset,
        });
      } catch (error) {
        throw projectDocumentImageFailure(error, input.documentId, null);
      }
    },
    async readOwnedImage(input): Promise<DocumentImageAsset> {
      try {
        return await materializeOwnedImage(input);
      } catch (error) {
        throw projectDocumentImageFailure(error, input.documentId, input.assetId);
      }
    },
  };
}

function projectDocumentImageFailure(
  error: unknown,
  documentId: string,
  assetId: string | null
): DocumentImageAssetRuntimeError {
  if (error instanceof DocumentImageAssetRuntimeError) return error;
  if (error instanceof ManagedImageIngressError) {
    switch (error.failure) {
      case 'source_not_found':
        return new DocumentImageAssetRuntimeError('local_source_missing', documentId, assetId);
      case 'source_not_file':
        return new DocumentImageAssetRuntimeError('local_source_not_file', documentId, assetId);
      case 'source_too_large':
      case 'invalid_byte_limit':
      case 'invalid_pixel_limit':
        return new DocumentImageAssetRuntimeError('media_limit_exceeded', documentId, assetId);
      case 'content_address_conflict':
        return new DocumentImageAssetRuntimeError('storage_conflict', documentId, assetId);
    }
  }
  if (error instanceof ImageInspectionError) {
    return new DocumentImageAssetRuntimeError(
      error.code === 'image_pixel_limit_exceeded' ? 'media_limit_exceeded' : 'invalid_media',
      documentId,
      assetId
    );
  }
  if (error instanceof LocalImageAssetRegistrationError) {
    return new DocumentImageAssetRuntimeError('storage_conflict', documentId, assetId);
  }
  if (error instanceof WorkspaceVerifiedImageError) {
    return new DocumentImageAssetRuntimeError(
      error.code === 'integrity_failed'
        ? 'managed_asset_integrity_failed'
        : 'managed_asset_unavailable',
      documentId,
      assetId
    );
  }
  if (isFileAccessError(error)) {
    return new DocumentImageAssetRuntimeError('local_source_unreadable', documentId, assetId);
  }
  return new DocumentImageAssetRuntimeError('store_unavailable', documentId, assetId);
}

function isFileAccessError(error: unknown): boolean {
  if (!(error instanceof Error) || !('code' in error)) return false;
  const code = Reflect.get(error, 'code');
  return code === 'EACCES' || code === 'EPERM';
}
