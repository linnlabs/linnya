/**
 * @file knowledge-graph.schema.ts
 * @description 软知识图谱（Soft Knowledge Graph）相关表结构定义（workspace.sqlite）
 *
 * 设计原则（M1）：
 * - SQLite 是图谱结构的权威（Graph SoT），表结构必须支持邻接查询与证据回溯；
 * - 所有表以 kb_id 作为第一维度，保证跨 KB 完全隔离；
 * - 通过复合主键 + UPSERT（ON CONFLICT）实现幂等写入（重试/重复抽取不会产生重复边）。
 *
 * 注意：
 * - 本阶段只提供最小存储闭环，不引入复杂的实体消歧/别名图；
 * - created_at/updated_at 使用 seconds（REAL），与知识库模块其他表保持一致。
 */

export const KNOWLEDGE_GRAPH_SCHEMAS: string[] = [
  // =========================================================
  // knowledge_graph_nodes：实体节点（Graph Node）
  // =========================================================
  `CREATE TABLE IF NOT EXISTS knowledge_graph_nodes (
    kb_id TEXT NOT NULL,
    id TEXT NOT NULL,
    name TEXT NOT NULL,
    canonical_name TEXT NOT NULL,
    type TEXT,
    description TEXT,
    -- 该实体的“最早/代表性”来源证据（用于调试与回溯；不强制 FK，避免跨 KB 约束难题）
    source_doc_id TEXT,
    source_block_id TEXT,
    created_at REAL NOT NULL,
    updated_at REAL,
    PRIMARY KEY (kb_id, id),
    FOREIGN KEY(kb_id) REFERENCES knowledge_bases(id) ON DELETE CASCADE
  )`,

  `CREATE INDEX IF NOT EXISTS idx_kg_nodes_kb_canonical_name
   ON knowledge_graph_nodes(kb_id, canonical_name)`,

  // =========================================================
  // knowledge_graph_edges：关系边（Graph Edge）
  // =========================================================
  `CREATE TABLE IF NOT EXISTS knowledge_graph_edges (
    kb_id TEXT NOT NULL,
    id TEXT NOT NULL,
    source_entity_id TEXT NOT NULL,
    target_entity_id TEXT NOT NULL,
    relation_type TEXT NOT NULL,
    -- 对关系的自然语言陈述（可选，用于证据展示/调试）
    statement TEXT,
    -- 0~1（可选）；本阶段不强制范围检查，避免过度约束
    confidence REAL,
    -- 情绪/倾向（可选，后续用于过滤）
    sentiment TEXT,
    -- 时间信息（可选，建议存 ISO 或自然语言；本阶段不做解析）
    time TEXT,
    -- 证据定位（必须能回溯到原文 chunk）
    evidence_doc_id TEXT,
    evidence_block_id TEXT,
    created_at REAL NOT NULL,
    updated_at REAL,
    PRIMARY KEY (kb_id, id),
    FOREIGN KEY(kb_id) REFERENCES knowledge_bases(id) ON DELETE CASCADE
  )`,

  // 邻接查询索引
  `CREATE INDEX IF NOT EXISTS idx_kg_edges_source_entity
   ON knowledge_graph_edges(kb_id, source_entity_id)`,

  `CREATE INDEX IF NOT EXISTS idx_kg_edges_target_entity
   ON knowledge_graph_edges(kb_id, target_entity_id)`,

  `CREATE INDEX IF NOT EXISTS idx_kg_edges_relation_type
   ON knowledge_graph_edges(kb_id, relation_type)`,

  // 证据回溯索引（按 doc + block 反查图谱产物）
  `CREATE INDEX IF NOT EXISTS idx_kg_edges_evidence
   ON knowledge_graph_edges(kb_id, evidence_doc_id, evidence_block_id)`,

  // =========================================================
  // knowledge_graph_doc_status：文档级抽取进度（doc -> chunk）
  // =========================================================
  `CREATE TABLE IF NOT EXISTS knowledge_graph_doc_status (
    kb_id TEXT NOT NULL,
    doc_id TEXT NOT NULL,
    chunk_count INTEGER NOT NULL,
    done_chunks INTEGER NOT NULL,
    status TEXT NOT NULL,
    updated_at REAL NOT NULL,
    PRIMARY KEY (kb_id, doc_id),
    FOREIGN KEY(kb_id) REFERENCES knowledge_bases(id) ON DELETE CASCADE
  )`,

  `CREATE INDEX IF NOT EXISTS idx_kg_doc_status_kb_doc
   ON knowledge_graph_doc_status(kb_id, doc_id)`,

  // =========================================================
  // knowledge_graph_index_status：KB 级聚合进度（缓存/可选）
  // =========================================================
  `CREATE TABLE IF NOT EXISTS knowledge_graph_index_status (
    kb_id TEXT NOT NULL,
    total_units INTEGER NOT NULL,
    done_units INTEGER NOT NULL,
    updated_at REAL NOT NULL,
    PRIMARY KEY (kb_id),
    FOREIGN KEY(kb_id) REFERENCES knowledge_bases(id) ON DELETE CASCADE
  )`,

  // =========================================================
  // knowledge_graph_vector_doc_status：文档级“图谱向量索引”状态（M5: Graph Vectorization）
  // =========================================================
  /**
   * 设计说明（根因修复）：
   * - 图谱抽取（SQLite）与图谱向量化（Qdrant）是两个阶段；
   * - 若没有 doc 级索引状态，我们无法做“只对未索引/模型变更的文档回填”，会导致每次启动都重复 embedding；
   * - 因此这里单独维护 doc 粒度的索引状态，并记录 embedding_model_id，便于模型切换后自动重建。
   */
  `CREATE TABLE IF NOT EXISTS knowledge_graph_vector_doc_status (
    kb_id TEXT NOT NULL,
    doc_id TEXT NOT NULL,
    embedding_model_id TEXT NOT NULL,
    node_count INTEGER NOT NULL,
    edge_count INTEGER NOT NULL,
    -- 已完成的向量化单位数（node+edge 的 point 数量），用于端到端进度聚合
    done_units INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL,
    error_message TEXT,
    updated_at REAL NOT NULL,
    PRIMARY KEY (kb_id, doc_id),
    FOREIGN KEY(kb_id) REFERENCES knowledge_bases(id) ON DELETE CASCADE
  )`,

  `CREATE INDEX IF NOT EXISTS idx_kg_vector_doc_status_kb_doc
   ON knowledge_graph_vector_doc_status(kb_id, doc_id)`,
];


