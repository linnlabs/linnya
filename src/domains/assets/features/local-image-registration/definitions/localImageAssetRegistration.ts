import type { SupportedImageMediaType } from 'src/shared/media/image-inspection';

export interface LocalImageAssetFacts {
  readonly uri: string;
  readonly mediaType: SupportedImageMediaType;
  readonly byteLength: number;
  readonly width: number;
  readonly height: number;
  readonly sha256: string;
  readonly localPath: string;
  readonly createdAt: number;
}

export interface RegisteredLocalImageAsset extends LocalImageAssetFacts {
  readonly assetId: string;
}

export interface LocalImageAssetLedgerPort {
  registerLocalImage(facts: LocalImageAssetFacts): RegisteredLocalImageAsset;
}

export type LocalImageAssetRegistrationErrorCode =
  | 'invalid_pixel_limit'
  | 'source_not_found'
  | 'source_not_file'
  | 'ledger_conflict';

export class LocalImageAssetRegistrationError extends Error {
  readonly name = 'LocalImageAssetRegistrationError';

  constructor(
    readonly code: LocalImageAssetRegistrationErrorCode,
    message: string,
  ) {
    super(message);
  }
}
