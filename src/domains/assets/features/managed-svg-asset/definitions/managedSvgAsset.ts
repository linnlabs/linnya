export const MANAGED_SVG_MEDIA_TYPE = 'image/svg+xml' as const;

export interface ManagedSvgAssetFacts {
  readonly uri: string;
  readonly mediaType: typeof MANAGED_SVG_MEDIA_TYPE;
  readonly byteLength: number;
  readonly sha256: string;
  readonly localPath: string;
  readonly createdAt: number;
}

export interface RegisteredManagedSvgAsset extends ManagedSvgAssetFacts {
  readonly assetId: string;
}

export interface MaterializedManagedSvgAsset {
  readonly assetId: string;
  readonly mediaType: typeof MANAGED_SVG_MEDIA_TYPE;
  readonly byteLength: number;
  readonly sha256: string;
  readonly canonicalSvg: string;
}

export interface ManagedSvgAssetLedgerPort {
  register(facts: ManagedSvgAssetFacts): RegisteredManagedSvgAsset;
  findById(assetId: string): RegisteredManagedSvgAsset | null;
}

export interface ManagedSvgAssetRuntimePort {
  adoptCanonicalSvg(input: {
    readonly canonicalSvg: string;
    readonly contentHash: string;
  }): Promise<MaterializedManagedSvgAsset>;
  readManagedSvg(input: { readonly assetId: string }): Promise<MaterializedManagedSvgAsset>;
}

export interface ManagedSvgAssetRuntimeDependencies {
  readonly appDataRoot: string;
  readonly storeId: string;
  readonly maxSvgBytes: number;
  readonly ledger: ManagedSvgAssetLedgerPort;
  readonly createStagingId?: () => string;
}

export type ManagedSvgAssetFailure =
  | 'invalid_canonical_content'
  | 'content_limit_exceeded'
  | 'asset_unavailable'
  | 'integrity_failed'
  | 'storage_conflict';

export class ManagedSvgAssetError extends Error {
  readonly name = 'ManagedSvgAssetError';

  constructor(readonly failure: ManagedSvgAssetFailure) {
    super(`Managed SVG asset failed: ${failure}`);
  }
}
