/**
 * ref 快照结构（仅前端内存使用）
 */
export interface BlockRefSnapshot {
  documentId: string;
  createdAt: number;
  /**
   * 当前文档的 rootBlockId 列表快照。
   *
   * 说明：
   * - 解析 ref 时理论上只需要 refToBlockId；
   * - 但为了调试与可观测性（日志 sample / blocks 数量），这里保留一份 blockIds；
   * - 该字段必须与 register(documentId, blockIds) 的入参保持一致，否则会导致运行期异常。
   */
  blockIds: string[];
  /** ref -> blockId */
  refToBlockId: Map<string, string>;
}

/**
 * Store 状态
 */
export interface BlockIndexSnapshotState {
  /**
   * 快照存储：key 为 documentId
   * 前端通常同时只编辑一个文档，所以简单用 documentId 作为 key
   */
  snapshots: Map<string, BlockRefSnapshot>;

  /**
   * TTL 超时时间（毫秒），默认 10 分钟
   */
  ttlMs: number;
}
