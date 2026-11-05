import type { SupportedImageMediaType } from 'src/shared/media/image-inspection';

export interface LocalImageAssetFacts {
  readonly uri: string;
  readonly mediaType: SupportedImageMediaType;
  readonly byteLength: number;
  readonly width: number;
  readonly height: number;
  readonly sha256: string;
  /** `assets.local_path` 的持久路径（相对 AppData Root）；读文件前由 AppData Root 解析。 */
  readonly storagePath: string;
  readonly createdAt: number;
}

export interface RegisteredLocalImageAsset extends LocalImageAssetFacts {
  readonly assetId: string;
}

export interface LocalImageAssetLedgerPort {
  registerLocalImage(facts: LocalImageAssetFacts): RegisteredLocalImageAsset;
}

export type LocalImageAssetRegistrationErrorCode = 'ledger_conflict';

export class LocalImageAssetRegistrationError extends Error {
  readonly name = 'LocalImageAssetRegistrationError';

  constructor(
    readonly code: LocalImageAssetRegistrationErrorCode,
    message: string,
  ) {
    super(message);
  }
}
