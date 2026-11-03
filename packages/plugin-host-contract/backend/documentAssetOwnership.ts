/** 仅解除指定文档的归属；共享引用和物理文件回收仍由 Host 管理。可安全重试。 */
export declare function releaseDocumentAssetOwnership(input: {
  readonly database: unknown;
  readonly documentId: string;
  readonly assetIds: readonly string[];
}): void;

/** 图片准备完成后，加入调用方当前同步事务；不写资产字节、不自行提交。 */
export declare function registerDocumentAssetOwnership(input: {
  readonly database: unknown;
  readonly documentId: string;
  readonly assetIds: readonly string[];
  readonly usageHint: string;
}): void;
