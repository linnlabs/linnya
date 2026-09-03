import type {
  LocalImageAssetLedgerPort,
  RegisteredLocalImageAsset,
} from '../../local-image-registration';

export interface ManagedImageIngressPort {
  ingestLocalImage(input: {
    readonly sourcePath: string;
    readonly createdAt?: string;
  }): Promise<RegisteredLocalImageAsset>;
}

export interface ManagedImageBytesIngressPort {
  ingestImageBytes(input: {
    readonly bytes: Uint8Array;
    readonly createdAt?: string;
  }): Promise<RegisteredLocalImageAsset>;
}

export interface ManagedImageContentIngressPort
  extends ManagedImageIngressPort,
    ManagedImageBytesIngressPort {}

export interface ManagedImageIngressDependencies {
  readonly appDataRoot: string;
  readonly storeId: string;
  readonly maxImageBytes: number;
  readonly maxImagePixels: number;
  readonly ledger: LocalImageAssetLedgerPort;
  readonly createStagingId?: () => string;
}

export type ManagedImageIngressFailure =
  | 'invalid_byte_limit'
  | 'invalid_pixel_limit'
  | 'source_not_found'
  | 'source_not_file'
  | 'source_too_large'
  | 'content_address_conflict';

export class ManagedImageIngressError extends Error {
  readonly name = 'ManagedImageIngressError';

  constructor(readonly failure: ManagedImageIngressFailure) {
    super(`Managed image ingress failed: ${failure}`);
  }
}
