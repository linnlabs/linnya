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

/** 本文档仍拥有的实际字节事实；缺失或不完整事实抛错，预算不能假定零字节。 */
export declare function listDocumentAssetByteFacts(input: {
  readonly database: unknown; readonly documentId: string; readonly assetIds: readonly string[];
}): readonly import('@app/schemas').DocumentAssetByteFact[];

/** 同步事务内接纳完整可达集合并释放其余文档归属；物理回收仍由Assets负责。 */
export declare function reconcileDocumentAssetOwnership(input: {
  readonly database: unknown; readonly documentId: string; readonly assetIds: readonly string[]; readonly usageHint: string;
}): void;
