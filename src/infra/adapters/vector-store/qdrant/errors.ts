/** 受管向量进程没有就绪；这不是某一路召回为空，不能降级成无搜索结果。 */
export class QdrantRuntimeUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'QdrantRuntimeUnavailableError';
  }
}
