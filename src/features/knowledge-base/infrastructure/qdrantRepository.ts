/**
 * @file src/knowledge-base/infrastructure/qdrantRepository.ts
 *
 * @brief Qdrant向量数据库仓储接口和类型定义
 *
 * @description
 * 该文件定义了与Qdrant向量数据库交互的接口和类型。Qdrant用于存储文档块的向量表示，
 * 支持语义搜索、关键词搜索和混合搜索功能。
 * `PointPayload` 与 `QdrantPoint` 是当前索引和搜索共同依赖的持久化合同。
 */

/**
 * 稀疏向量类型 - 用于BM25关键词搜索
 */
export interface SparseVector {
  /** 稀疏向量的索引 */
  indices: number[];
  
  /** 稀疏向量的值 */
  values: number[];
}

/**
 * 向量数据类型 - 支持稠密和稀疏向量
 */
export interface VectorData {
  /** 稠密向量 - 用于语义搜索 */
  default: number[];
  
  /** 稀疏向量 - 用于BM25关键词搜索 */
  bm25?: SparseVector;
}

/**
 * 向量点载荷数据
 */
export interface PointPayload extends Record<string, unknown> {
  /** 文档ID */
  doc_id: string;
  
  /** 块ID */
  block_id: string;
  
  /** 用于搜索与结果投影的文档内容 */
  document: string;
  
  /** 文档标题 */
  doc_title: string;
  
  /** 块类型 */
  block_type: string;
  
  /** 页码 */
  page_number?: number;
  
  /** 段落索引 */
  para_idx?: number;

  /**
   * 可选：当一个“原始块”被拆分成多个子块时，用于标记父子关系
   * - parent_block_id：原始块ID（父）
   * - part_index：子块序号（从 0 开始）
   */
  parent_block_id?: string;
  part_index?: number;
  
  /** 表格ID */
  table_id?: string;
  
  /** 行索引 */
  row_idx?: number;
  
  /** 其他元数据 */
  metadata?: Record<string, unknown>;
}

/**
 * Qdrant 点结构
 */
export interface QdrantPoint {
  /** 全局唯一的点ID，格式：doc_id-block_id */
  id: string;
  
  /** 向量数据 - 支持多向量（稠密+稀疏） */
  vector: VectorData;
  
  /** 载荷数据 */
  payload: PointPayload;
}

/**
 * 检索点类型 - 搜索结果
 */
export interface RetrievedPoint {
  /** 点ID */
  id: string;
  
  /** 相似度分数 */
  score: number;
  
  /** 载荷数据 */
  payload: PointPayload;
  
  /** 匹配类型 */
  match_type?: 'semantic' | 'keyword' | 'hybrid';
}

/**
 * 搜索过滤器选项
 */
export interface SearchFilterOptions {
  /** 文档ID列表 */
  docIds?: string[];
  
  /** 块类型过滤 */
  blockTypes?: string[];
  
  /** 页码范围 */
  pageRange?: {
    min?: number;
    max?: number;
  };

  /**
   * payload.metadata 字段过滤（用于更细粒度的结构化检索/剪枝）。
   *
   * 典型用法：
   * - 在 `kg_edges_${kbId}` 中只在“候选 edge_id 集合”内做语义打分（Multi-hop 扩展的 beam 选择）。
   *
   * 注意：
   * - 这是 Qdrant filter 的能力暴露，不代表业务一定要用；
   * - key 不包含 `metadata.` 前缀，构建器会自动拼接为 `metadata.${key}`。
   */
  metadataMatch?: Record<
    string,
    | { value: string | number | boolean }
    | { any: Array<string | number> }
  >;
}

/**
 * 混合搜索结果
 */
export interface SearchResult {
  /** 语义搜索结果 */
  semanticResults: RetrievedPoint[];
  
  /** 关键词搜索结果 */
  keywordResults: RetrievedPoint[];
  
  /** 融合后的结果 */
  combinedResults: RetrievedPoint[];
  
  /** 搜索统计 */
  stats?: {
    total_semantic: number;
    total_keyword: number;
    total_combined: number;
    search_time_ms: number;
  };
}

/**
 * Qdrant 仓储接口
 */
export interface QdrantRepository {
  /**
   * 获取或创建集合 - 支持多向量配置
   * @param collectionName 集合名称
   * @param vectorSize 稠密向量维度
   * @param distanceMetric 距离度量方式
   * @param supportSparse 是否支持稀疏向量
   */
  getOrCreateCollection(
    collectionName: string,
    vectorSize: number,
    distanceMetric?: string,
    supportSparse?: boolean,
    options?: {
      defaultSegmentNumber?: number;
    }
  ): Promise<void>;
  
  /**
   * 删除集合
   * @param collectionName 集合名称
   */
  deleteCollection(collectionName: string): Promise<void>;
  
  /**
   * 添加向量点 - 支持混合向量
   * @param collectionName 集合名称
   * @param points 向量点列表
   */
  addPoints(
    collectionName: string,
    points: QdrantPoint[]
  ): Promise<void>;
  
  /**
   * 语义搜索 - 使用稠密向量
   * @param collectionName 集合名称
   * @param queryVector 查询向量
   * @param topK 返回结果数量
   * @param filter 可选的过滤条件
   * @returns 检索到的点
   */
  semanticSearch(
    collectionName: string,
    queryVector: number[],
    topK?: number,
    filter?: SearchFilterOptions,
    /**
     * 可选：相似度阈值（透传到 Qdrant 的 score_threshold）
     *
     * 说明：
     * - 该阈值仅对“纯向量检索”的 score 有意义（例如 Cosine Similarity）。
     * - 禁止用在 RRF/hybrid 的融合分数上做“语义阈值”判断（量纲不一致）。
     */
    scoreThreshold?: number
  ): Promise<RetrievedPoint[]>;
  
  /**
   * 关键词搜索 - 使用BM25稀疏向量
   * @param collectionName 集合名称
   * @param queryText 查询文本
   * @param topK 返回结果数量
   * @param filter 可选的过滤条件
   * @returns 检索到的点
   */
  keywordSearch(
    collectionName: string,
    queryText: string,
    topK?: number,
    filter?: SearchFilterOptions
  ): Promise<RetrievedPoint[]>;
  
  /**
   * 混合搜索 - 语义 + 关键词，使用RRF融合
   * @param collectionName 集合名称
   * @param queryText 查询文本
   * @param queryVector 查询向量
   * @param topK 返回结果数量
   * @param filter 可选的过滤条件
   * @param rrfK RRF融合参数
   * @returns 搜索结果
   */
  hybridSearch(
    collectionName: string,
    queryText: string,
    queryVector: number[],
    topK?: number,
    filter?: SearchFilterOptions,
    rrfK?: number
  ): Promise<SearchResult>;
  
  /**
   * 根据文档ID删除点
   * @param collectionName 集合名称
   * @param docId 文档ID
   */
  deletePointsByDocId(collectionName: string, docId: string): Promise<void>;
  
  /**
   * 根据过滤条件删除点
   * @param collectionName 集合名称
   * @param filter 过滤条件
   */
  deletePointsByFilter(collectionName: string, filter: SearchFilterOptions): Promise<void>;

  /**
   * 根据 point id 精确删除点。
   *
   * 说明：增量续跑失败时只允许回滚本次新增点，不能按 docId 删除整篇文档。
   */
  deletePointsByIds(collectionName: string, pointIds: string[]): Promise<void>;

  /**
   * 统计某个 docId 在集合中的点数量（用于提交点校验）
   *
   * 说明：
   * - 提交 `completed` 前必须确保该 docId 至少写入 1 个点
   * - 使用 count 接口避免全量 scroll 带来的性能问题
   */
  countPointsByDocId(collectionName: string, docId: string): Promise<number>;

  /**
   * 统计指定 point id 中实际存在的数量。
   *
   * 说明：
   * - 增量续跑提交点不能只看 docId 下已有点；
   * - 必须确认“本次新增点”已写入，否则补 0 页也会被误判成功。
   */
  countPointsByIds(collectionName: string, pointIds: string[]): Promise<number>;
  
  /**
   * 获取集合信息
   * @param collectionName 集合名称
   */
  getCollectionInfo(collectionName: string): Promise<{
    vectors_count: number;
    indexed_vectors_count: number;
    points_count: number;
    segments_count: number;
    config: any;
  }>;

  /**
   * 🔥 新增：获取所有向量点的方法 - 用于数据一致性检查
   * **功能 (What):** 获取集合中所有向量点的ID和载荷信息
   * **输入 (Input):** 集合名称，可选的限制数量
   * **输出 (Output):** 包含ID和载荷的点数组
   * **副作用 (Side-effects):** 查询Qdrant数据库
   * @param collectionName 集合名称
   * @param limit 限制返回的点数量，默认10000
   */
  getAllPoints(
    collectionName: string,
    limit?: number
  ): Promise<Array<{ id: string; payload: Record<string, unknown> }>>;

  /**
   * 分页滚动获取点（用于全量一致性扫描）
   */
  scrollPointsPage(
    collectionName: string,
    limit: number,
    offset?: unknown
  ): Promise<{
    points: Array<{ id: string; payload: Record<string, unknown> }>;
    nextOffset?: unknown;
  }>;

  /**
   * 检查集合是否存在
   * @param collectionName 集合名称
   */
  collectionExists(collectionName: string): Promise<boolean>;
}
