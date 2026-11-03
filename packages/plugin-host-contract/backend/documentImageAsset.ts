import type { DocumentImageAsset } from '@app/schemas';
export type PluginDocumentImageAsset = DocumentImageAsset;
export type PluginDocumentImageMediaType = DocumentImageAsset['mediaType'];

export interface PluginDocumentImageAssetRuntimePort {
  /** 准备受管字节与媒体事实，不建立文档归属；归属由调用方提交事务登记。 */
  prepareImageBytes(input: { readonly documentId: string; readonly bytes: Uint8Array }): Promise<PluginDocumentImageAsset>;
  adoptLocalImage(input: {
    readonly documentId: string;
    readonly sourcePath: string;
    readonly usageHint: string;
  }): Promise<PluginDocumentImageAsset>;
  adoptImageBytes(input: {
    readonly documentId: string;
    readonly bytes: Uint8Array;
    readonly usageHint: string;
  }): Promise<PluginDocumentImageAsset>;
  readOwnedImage(input: {
    readonly documentId: string;
    readonly assetId: string;
  }): Promise<PluginDocumentImageAsset>;
}

export type PluginDocumentImageAssetFailure =
  | 'asset_not_owned'
  | 'local_source_missing'
  | 'local_source_not_file'
  | 'local_source_unreadable'
  | 'invalid_media'
  | 'media_limit_exceeded'
  | 'managed_asset_unavailable'
  | 'managed_asset_integrity_failed'
  | 'storage_conflict'
  | 'store_unavailable';

/** 插件只能消费这一安全失败合同，不能依赖宿主 domain 的异常类。 */
export class PluginDocumentImageAssetError extends Error {
  readonly name = 'PluginDocumentImageAssetError';

  constructor(readonly failure: PluginDocumentImageAssetFailure) {
    super(`Plugin document image asset failed: ${failure}`);
  }
}

/**
 * 以当前 workspace 数据库装配文档图片接管端口。
 *
 * 参数保持 opaque，插件不能依赖宿主 SQLite 实现；宿主会验证实际数据库能力。
 */
export declare function createDocumentImageAssetRuntime(
  databaseValue: unknown
): PluginDocumentImageAssetRuntimePort;
