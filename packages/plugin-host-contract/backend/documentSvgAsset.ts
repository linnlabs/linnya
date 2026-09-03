export interface PluginDocumentSvgAsset {
  readonly assetId: string;
  readonly mediaType: 'image/svg+xml';
  readonly byteLength: number;
  readonly sha256: string;
  readonly canonicalSvg: string;
}

export interface PluginDocumentSvgAssetRuntimePort {
  adoptCanonicalSvg(input: {
    readonly documentId: string;
    readonly canonicalSvg: string;
    readonly contentHash: string;
    readonly usageHint: string;
  }): Promise<PluginDocumentSvgAsset>;
  readOwnedSvg(input: {
    readonly documentId: string;
    readonly assetId: string;
  }): Promise<PluginDocumentSvgAsset>;
}

export type PluginDocumentSvgAssetFailure =
  | 'asset_not_owned'
  | 'invalid_canonical_content'
  | 'content_limit_exceeded'
  | 'managed_asset_unavailable'
  | 'managed_asset_integrity_failed'
  | 'storage_conflict'
  | 'store_unavailable';

/** 插件只能消费这一安全失败合同，不能依赖宿主 domain 的异常类。 */
export class PluginDocumentSvgAssetError extends Error {
  readonly name = 'PluginDocumentSvgAssetError';

  constructor(readonly failure: PluginDocumentSvgAssetFailure) {
    super(`Plugin document SVG asset failed: ${failure}`);
  }
}

/** 以当前 workspace 数据库装配文档 SVG 接管端口。 */
export declare function createDocumentSvgAssetRuntime(
  databaseValue: unknown
): PluginDocumentSvgAssetRuntimePort;
