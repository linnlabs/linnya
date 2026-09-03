import type { SupportedImageMediaType } from 'src/shared/media/image-inspection';
import type { WorkspaceVerifiedImageFailure } from '../../../shared/verified-image';

export interface WorkspaceLlmImageReference {
  readonly id: string;
  readonly resourceId: string;
  readonly mediaType: SupportedImageMediaType;
  readonly byteLength: number;
  readonly width: number;
  readonly height: number;
  readonly sha256: string;
}

export interface VerifiedWorkspaceLlmImage {
  readonly id: string;
  readonly resourceId: string;
  readonly mediaType: SupportedImageMediaType;
  readonly byteLength: number;
  readonly width: number;
  readonly height: number;
  readonly bytes: Uint8Array;
}

export type WorkspaceLlmImageResolutionErrorCode =
  | 'attachment_unavailable'
  | 'attachment_integrity_failed';

export type WorkspaceLlmImageResolutionFailure = WorkspaceVerifiedImageFailure;

export class WorkspaceLlmImageResolutionError extends Error {
  readonly name = 'WorkspaceLlmImageResolutionError';

  constructor(
    readonly code: WorkspaceLlmImageResolutionErrorCode,
    readonly failure: WorkspaceLlmImageResolutionFailure,
    readonly attachmentId: string,
    readonly resourceId: string,
  ) {
    super(`Workspace image resolution failed: ${failure}`);
  }
}

export interface WorkspaceLlmImageResolverPort {
  resolveImages(
    references: readonly WorkspaceLlmImageReference[],
  ): Promise<readonly VerifiedWorkspaceLlmImage[]>;
}
