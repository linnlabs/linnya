/** Host 在同一数据库事务内维护归属；Markdown 只提供仍可恢复的 asset identity。 */
export interface MarkdownImageOwnershipPort {
  hasManagedImages(documentId: string): boolean;
  reconcile(documentId: string, retainedAssetIds: readonly string[]): void;
}
