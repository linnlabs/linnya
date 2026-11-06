import type { SupportedImageMediaType } from 'src/shared/media/image-inspection';

export interface WorkspaceVerifiedImageStorage {
  /** 当前 AppData Root；`assets.local_path` 是相对它的持久路径。 */
  readonly appDataRoot: string;
  /** 允许受管内容存在的目录；它的 realpath 必须位于 appDataRoot 内，防止整棵目录被符号链接替换。 */
  readonly contentRoot: string;
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
  readonly displayWidth: number;
  readonly displayHeight: number;
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
