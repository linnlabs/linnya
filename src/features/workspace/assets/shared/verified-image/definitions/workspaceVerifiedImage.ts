import type { SupportedImageMediaType } from 'src/shared/media/image-inspection';

export interface WorkspaceVerifiedImageStorageBoundary {
  /** 允许受管内容存在的目录。 */
  readonly contentRoot: string;
  /** contentRoot 的 realpath 必须位于该边界内，防止整棵内容目录被符号链接替换。 */
  readonly boundaryRoot: string;
}

export interface WorkspaceVerifiedImageExpectation {
  readonly mediaType: SupportedImageMediaType;
  readonly byteLength: number;
  readonly width: number;
  readonly height: number;
  readonly sha256: string;
}

export interface WorkspaceVerifiedImageRequest {
  readonly assetId: string;
  readonly expected?: WorkspaceVerifiedImageExpectation;
}

export interface VerifiedWorkspaceImage {
  readonly assetId: string;
  readonly mediaType: SupportedImageMediaType;
  readonly byteLength: number;
  readonly width: number;
  readonly height: number;
  readonly sha256: string;
  readonly bytes: Uint8Array;
}

export type WorkspaceVerifiedImageErrorCode = 'unavailable' | 'integrity_failed';

export type WorkspaceVerifiedImageFailure =
  | 'asset_not_found'
  | 'asset_not_local'
  | 'file_missing'
  | 'file_not_regular'
  | 'ledger_incomplete'
  | 'durable_ref_mismatch'
  | 'managed_path_escape'
  | 'byte_length_mismatch'
  | 'hash_mismatch'
  | 'media_type_mismatch'
  | 'dimensions_mismatch'
  | 'image_decode_failed';

export class WorkspaceVerifiedImageError extends Error {
  readonly name = 'WorkspaceVerifiedImageError';

  constructor(
    readonly code: WorkspaceVerifiedImageErrorCode,
    readonly failure: WorkspaceVerifiedImageFailure,
    readonly assetId: string,
    readonly requestIndex: number,
  ) {
    super(`Workspace verified image load failed: ${failure}`);
  }
}

export interface WorkspaceVerifiedImageLoaderPort {
  loadImages(
    requests: readonly WorkspaceVerifiedImageRequest[],
  ): Promise<readonly VerifiedWorkspaceImage[]>;
}
