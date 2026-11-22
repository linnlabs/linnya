/** runtime-missing：本机没有可用的 Qdrant 运行时组件（缺失、损坏或复核失败），停启无法恢复，需要重新安装。 */
export type QdrantRuntimeUnavailableReason = 'runtime-missing' | 'startup-failed';

/** 受管向量进程没有就绪；这不是某一路召回为空，不能降级成无搜索结果。 */
export class QdrantRuntimeUnavailableError extends Error {
  /** 跨 artifact 按名称与该字段识别，插件不能依赖 Host bundle 的类身份。 */
  readonly reason: QdrantRuntimeUnavailableReason;

  constructor(message: string, reason: QdrantRuntimeUnavailableReason = 'startup-failed') {
    super(message);
    this.name = 'QdrantRuntimeUnavailableError';
    this.reason = reason;
  }
}
