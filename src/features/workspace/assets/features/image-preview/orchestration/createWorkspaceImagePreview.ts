import {
  WorkspaceImagePreviewError,
  type WorkspaceImagePreviewPort,
} from '../definitions/workspaceImagePreview';
import {
  WorkspaceVerifiedImageError,
  type WorkspaceVerifiedImageLoaderPort,
} from '../../../shared/verified-image';

export function createWorkspaceImagePreview(params: {
  readonly verifiedImageLoader: WorkspaceVerifiedImageLoaderPort;
}): WorkspaceImagePreviewPort {
  return {
    async readImage(assetId) {
      try {
        const [image] = await params.verifiedImageLoader.loadImages([{ assetId }]);
        return {
          mediaType: image.mediaType,
          byteLength: image.byteLength,
          bytes: image.bytes,
        };
      } catch (error: unknown) {
        if (!(error instanceof WorkspaceVerifiedImageError)) throw error;
        throw new WorkspaceImagePreviewError(
          error.code === 'unavailable' ? 'asset_unavailable' : 'asset_integrity_failed',
        );
      }
    },
  };
}
