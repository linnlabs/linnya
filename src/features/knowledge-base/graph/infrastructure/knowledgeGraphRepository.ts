/**
 * @file knowledgeGraphRepository.ts
 *
 * @description
 * 软知识图谱（Soft Knowledge Graph）仓储接口（M1：SQLite Graph SoT）。
 *
 * 目标：
 * - 定义最小可用的“落盘 + 查询”闭环，为后续抽取 Worker / Graph Search 提供稳定的基础设施能力；
 * - 明确幂等写入语义：同一 doc 重试/重复抽取不会产生重复 node/edge；
 * - 所有接口必须显式携带 kbId，避免跨 KB 数据串联。
 */

export type KnowledgeGraphEntityId = string;
export type KnowledgeGraphEdgeId = string;

/**
 * 文档级抽取状态（可扩展）。
 * - queued: 已入队，等待抽取
 * - running: 抽取中
 * - completed: 抽取完成（done_chunks == chunk_count）
 * - failed: 抽取失败
 * - cancelled: 被取消（例如文档删除）
 */
export type KnowledgeGraphDocStatusValue =
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type KnowledgeGraphEdgeDirection = 'out' | 'in' | 'both';

export type KnowledgeGraphNodeUpsertInput = {
  kbId: string;
  id: KnowledgeGraphEntityId;
  name: string;
  canonicalName: string;
  type?: string | null;
  description?: string | null;
  sourceDocId?: string | null;
  sourceBlockId?: string | null;
};

export type KnowledgeGraphNodeRecord = {
  kbId: string;
  id: KnowledgeGraphEntityId;
  name: string;
  canonicalName: string;
  type: string | null;
  description: string | null;
  sourceDocId: string | null;
  sourceBlockId: string | null;
  createdAtSeconds: number;
  updatedAtSeconds: number | null;
};

export type KnowledgeGraphEdgeUpsertInput = {
  kbId: string;
  id: KnowledgeGraphEdgeId;
  sourceEntityId: KnowledgeGraphEntityId;
  targetEntityId: KnowledgeGraphEntityId;
  relationType: string;
  statement?: string | null;
  confidence?: number | null;
  sentiment?: string | null;
  time?: string | null;
  evidenceDocId?: string | null;
  evidenceBlockId?: string | null;
};

export type KnowledgeGraphEdgeRecord = {
  kbId: string;
  id: KnowledgeGraphEdgeId;
  sourceEntityId: KnowledgeGraphEntityId;
  targetEntityId: KnowledgeGraphEntityId;
  relationType: string;
  statement: string | null;
  confidence: number | null;
  sentiment: string | null;
  time: string | null;
  evidenceDocId: string | null;
  evidenceBlockId: string | null;
  createdAtSeconds: number;
  updatedAtSeconds: number | null;
};

export type KnowledgeGraphDocStatusUpsertInput = {
  kbId: string;
  docId: string;
  chunkCount: number;
  doneChunks: number;
  status: KnowledgeGraphDocStatusValue;
};

export type KnowledgeGraphDocStatusRecord = {
  kbId: string;
  docId: string;
  chunkCount: number;
  doneChunks: number;
  status: KnowledgeGraphDocStatusValue;
  updatedAtSeconds: number;
};

export type KnowledgeGraphKbProgress = {
  kbId: string;
  totalUnits: number;
  doneUnits: number;
  /**
   * 0~1（当 totalUnits==0 时为 0）。
   *
   * 注意：本阶段不做 clamp（不隐藏潜在数据不一致），由上层决定是否严格处理。
   */
  progress: number;
  /**
   * 最近一次 doc_status 更新的时间（seconds）。
   * 若没有任何 doc_status 记录，则为 null。
   */
  updatedAtSeconds: number | null;
};

/**
 * 文档级“图谱向量索引”状态（可扩展）。
 * - queued: 已入队，等待索引
 * - running: 索引中（embedding + upsert）
 * - completed: 索引完成（nodes/edges 已写入向量库）
 * - failed: 索引失败
 * - cancelled: 被取消（例如文档删除）
 */
export type KnowledgeGraphVectorDocStatusValue =
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type KnowledgeGraphVectorDocStatusUpsertInput = {
  kbId: string;
  docId: string;
  embeddingModelId: string;
  nodeCount: number;
  edgeCount: number;
  /**
   * 已完成的向量化单位数（node+edge 的 point 数量）。
   *
   * 说明：
   * - 用于端到端进度聚合（抽取完成 ≠ 进度 100%）；
   * - running 时会随 batch 递增，completed 时应等于 nodeCount+edgeCount。
   */
  doneUnits: number;
  status: KnowledgeGraphVectorDocStatusValue;
  errorMessage?: string | null;
};

export type KnowledgeGraphVectorDocStatusRecord = {
  kbId: string;
  docId: string;
  embeddingModelId: string;
  nodeCount: number;
  edgeCount: number;
  doneUnits: number;
  status: KnowledgeGraphVectorDocStatusValue;
  errorMessage: string | null;
  updatedAtSeconds: number;
};

/**
 * 图谱仓储接口（SQLite 权威）
 */
export interface KnowledgeGraphRepository {
  /**
   * 幂等写入节点（批量）
   */
  upsertNodes(nodes: KnowledgeGraphNodeUpsertInput[]): Promise<void>;

  /**
   * 幂等写入边（批量）
   */
  upsertEdges(edges: KnowledgeGraphEdgeUpsertInput[]): Promise<void>;

  /**
   * 批量读取节点（用于把边里的 entityId 补全为可读信息）
   *
   * 约束：
   * - 必须携带 kbId（跨 KB 隔离）；
   * - ids 为空时返回空数组。
   */
  getNodesByIds(kbId: string, ids: KnowledgeGraphEntityId[]): Promise<KnowledgeGraphNodeRecord[]>;

  /**
   * 按证据反查边（用于 Chunk-Driven：从已检索到的 chunk 回溯图谱产物）
   */
  listEdgesByEvidence(kbId: string, docId: string, blockIds: string[]): Promise<KnowledgeGraphEdgeRecord[]>;

  /**
   * 按实体邻接查询边（用于 Entity-Driven：从实体锚点扩展一跳/多跳）
   */
  listEdgesByEntity(
    kbId: string,
    entityId: KnowledgeGraphEntityId,
    direction: KnowledgeGraphEdgeDirection,
    /**
     * 限制最多返回的边数量（用于避免超级节点导致的性能问题）。
     *
     * 说明：
     * - 这是“读路径”的业务边界，不是容错补丁；
     * - 未传入时表示不限制（保持向后兼容）。
     */
    limit?: number
  ): Promise<KnowledgeGraphEdgeRecord[]>;

  /**
   * 按 docId 读取该文档产生/关联的 nodes（用于向量化与回填）。
   *
   * 约束：
   * - 节点是 KB 内去重的（canonical_id），同一 node 可能被多个 doc “复用”；
   * - 这里返回的是 source_doc_id 指向该 doc 的节点（即“该 doc 首次引入的节点”）。
   */
  listNodesBySourceDocId(kbId: string, docId: string): Promise<KnowledgeGraphNodeRecord[]>;

  /**
   * 按 docId 读取该文档产生的 edges（用于向量化与回填）。
   * - 边以 evidence_doc_id 指向证据文档，因此该查询是精确的 doc 归属。
   */
  listEdgesByEvidenceDocId(kbId: string, docId: string): Promise<KnowledgeGraphEdgeRecord[]>;

  /**
   * 幂等写入/更新文档状态（含 chunk 总数）
   */
  upsertDocStatus(input: KnowledgeGraphDocStatusUpsertInput): Promise<void>;

  /**
   * 获取文档级抽取状态
   */
  getDocStatus(kbId: string, docId: string): Promise<KnowledgeGraphDocStatusRecord | undefined>;

  /**
   * 尝试获取“抽取互斥锁”（同一 doc 不允许并发两次抽取）
   *
   * 语义：
   * - 若该 doc 当前 status=running，则返回 false（表示锁被占用）
   * - 否则把 status 置为 running，并将 done_chunks 重置为 0（开始一次新的抽取）
   */
  /**
   * 获取 doc 级抽取互斥锁（同一 doc 同一时刻只允许一个抽取 worker 运行）。
   *
   * 重要：为支持“失败后断点续跑”，此处允许传入 initialDoneChunks，
   * 以便在重新获取锁时保持已完成进度，而不是把 done_chunks 重置为 0。
   */
  tryAcquireDocExtractionLock(
    kbId: string,
    docId: string,
    chunkCount: number,
    initialDoneChunks: number
  ): Promise<boolean>;

  /**
   * 更新文档进度（done_chunks）
   *
   * 设计语义：
   * - 调用方必须先 upsertDocStatus（写入 chunk_count）；
   * - 若 doc_status 不存在，本方法应抛错，避免静默写入脏数据。
   */
  updateDocProgress(kbId: string, docId: string, doneChunks: number, status?: KnowledgeGraphDocStatusValue): Promise<void>;

  /**
   * 计算 KB 级进度（从 doc_status 聚合）
   */
  getKbProgress(kbId: string): Promise<KnowledgeGraphKbProgress>;

  /**
   * 写入/更新 doc 级图谱向量索引状态（用于“只对未索引/模型变更文档回填”）。
   */
  upsertVectorDocStatus(input: KnowledgeGraphVectorDocStatusUpsertInput): Promise<void>;

  /**
   * 更新 doc 级图谱向量索引进度（done_units）
   *
   * 设计语义：
   * - 调用方必须先 upsertVectorDocStatus 写入 node_count/edge_count；
   * - 若 vector_doc_status 不存在，本方法应抛错，避免静默写入脏数据。
   */
  updateVectorDocProgress(
    kbId: string,
    docId: string,
    doneUnits: number,
    status?: KnowledgeGraphVectorDocStatusValue
  ): Promise<void>;

  /**
   * 获取 doc 级向量索引状态
   */
  getVectorDocStatus(kbId: string, docId: string): Promise<KnowledgeGraphVectorDocStatusRecord | undefined>;

  /**
   * 列出某个 KB 下所有 doc 的向量索引状态（回填时避免 N 次 get）
   */
  listVectorDocStatusByKb(kbId: string): Promise<KnowledgeGraphVectorDocStatusRecord[]>;

  /**
   * 删除某个文档对应的图谱数据（用于“删除文档”一致性清理）。
   *
   * 设计语义（根因修复）：
   * - 图谱边以 evidence_doc_id / evidence_block_id 指向证据块；
   * - 删除文档时必须删除该 doc 的所有边与 doc_status，否则会出现“图谱进度/增强结果引用了已不存在的文档”的脏数据。
   *
   * 节点清理策略：
   * - 节点在 kb 内按 canonical_id 去重，可能被多个 doc 的边共同引用；
   * - 因此这里仅删除“删除完该 doc 的边后，已不再被任何边引用的孤儿节点”。
   *
   * @returns 便于观测的删除统计（用于日志/测试）
   */
  deleteGraphDataForDocument(
    kbId: string,
    docId: string
  ): Promise<{ deletedEdges: number; deletedDocStatus: number; deletedOrphanNodes: number }>;

  /**
   * 删除某个文档的 doc_status（仅影响“进度聚合分母/分子”，不删除 nodes/edges）。
   *
   * 使用场景：
   * - 用户关闭“图谱构建”开关并取消尚未开始的抽取任务时，需要把 queued 的 doc_status 移出聚合，
   *   避免前端进度长期卡在“正在构建”。
   *
   * 重要约束：
   * - 调用方必须先确认该 doc 未完成抽取（例如 status=queued 且 doneChunks=0），避免误删已完成的可观测状态。
   */
  deleteDocStatusForDocument(kbId: string, docId: string): Promise<number>;

  /**
   * 清空某个知识库下的全部图谱数据（仅影响图谱域，不影响知识库原始文档/SOT）。
   *
   * 使用场景：
   * - 开发调试：升级 prompt / schema 后，希望“从零重新抽取”
   * - 重建：需要强制清理历史抽取产物与进度状态，避免新旧数据混杂
   *
   * 设计语义（强约束）：
   * - 只删除图谱相关表：nodes/edges/doc_status/vector_doc_status/index_status
   * - 不删除知识库文档元数据、SoT 文件、ingestion 产物
   */
  deleteGraphDataForKb(kbId: string): Promise<{
    deletedNodes: number;
    deletedEdges: number;
    deletedDocStatus: number;
    deletedVectorDocStatus: number;
    deletedIndexStatus: number;
  }>;
}


