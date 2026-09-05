/** 仅解除指定文档的归属；共享引用和物理文件回收仍由 Host 管理。可安全重试。 */
export declare function releaseDocumentAssetOwnership(input: {
  readonly database: unknown;
  readonly documentId: string;
  readonly assetIds: readonly string[];
}): void;
