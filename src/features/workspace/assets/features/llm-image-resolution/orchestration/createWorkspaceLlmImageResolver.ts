import {
  WorkspaceLlmImageResolutionError,
  type VerifiedWorkspaceLlmImage,
  type WorkspaceLlmImageResolverPort,
} from '../definitions/workspaceLlmImageResolution';
import {
  WorkspaceVerifiedImageError,
  type WorkspaceVerifiedImageLoaderPort,
} from '../../../shared/verified-image';

export function createWorkspaceLlmImageResolver(params: {
  readonly verifiedImageLoader: WorkspaceVerifiedImageLoaderPort;
}): WorkspaceLlmImageResolverPort {
  return {
    async resolveImages(references): Promise<readonly VerifiedWorkspaceLlmImage[]> {
      try {
        const verified = await params.verifiedImageLoader.loadImages(
          references.map(reference => ({
            assetId: reference.resourceId,
            expected: {
              mediaType: reference.mediaType,
              byteLength: reference.byteLength,
              width: reference.width,
              height: reference.height,
              sha256: reference.sha256,
            },
          })),
        );
        return verified.map((image, index) => ({
          id: references[index].id,
          resourceId: image.assetId,
          mediaType: image.mediaType,
          byteLength: image.byteLength,
          width: image.width,
          height: image.height,
          bytes: image.bytes,
        }));
      } catch (error: unknown) {
        if (!(error instanceof WorkspaceVerifiedImageError)) throw error;
        const reference = references[error.requestIndex];
        throw new WorkspaceLlmImageResolutionError(
          error.code === 'unavailable'
            ? 'attachment_unavailable'
            : 'attachment_integrity_failed',
          error.failure,
          reference.id,
          reference.resourceId,
        );
      }
    },
  };
}
