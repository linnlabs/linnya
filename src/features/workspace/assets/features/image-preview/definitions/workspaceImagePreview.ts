import type { SupportedImageMediaType } from 'src/shared/media/image-inspection';

export interface WorkspaceImagePreview {
  readonly mediaType: SupportedImageMediaType;
  readonly byteLength: number;
  readonly bytes: Uint8Array;
}

export type WorkspaceImagePreviewErrorCode = 'asset_unavailable' | 'asset_integrity_failed';

export class WorkspaceImagePreviewError extends Error {
  readonly name = 'WorkspaceImagePreviewError';

  constructor(readonly code: WorkspaceImagePreviewErrorCode) {
    super(code);
  }
}

export interface WorkspaceImagePreviewPort {
  readImage(assetId: string): Promise<WorkspaceImagePreview>;
}
