/**
 * @file mindmap_document/schemas/blocks/evidence.schema.ts
 * @description 定义 MindMap 节点的证据 (Evidence) 卫星表结构。
 */

export const MINDMAP_EVIDENCE_SCHEMAS = [
  `CREATE TABLE IF NOT EXISTS mindmap_evidence (
    id TEXT PRIMARY KEY,
    document_id TEXT NOT NULL,       -- 关联的 MindMap 文档 ID (workspace_node_id)
    mindmap_node_id TEXT NOT NULL,   -- 关联的 MindMap 节点 ID (NodeObj.id)
    
    -- 核心对齐编辑器 CitationNode
    source_type TEXT NOT NULL,       -- 'knowledge_base' | 'web' | 'manual' | 'conversation_turn'
    source_id TEXT NOT NULL,         -- 同源标识（KB: docId#blockId；web: url；manual/conversation_turn: uuid）
    ref TEXT,                        -- 稳定短引用 (AI/导出用，如 'ab1234')
    
    -- 基础元数据
    title TEXT,
    snippet TEXT,                    -- 摘录/片段
    url TEXT,
    authors TEXT,                    -- JSON array string
    date TEXT,
    container_title TEXT,            -- 出处/容器标题（期刊名、书名、网站名）
    
    -- MindMap 特有
    order_index INTEGER DEFAULT 0,   -- 排序
    note TEXT,                       -- 用户备注/关联理由（不承载 container_title 语义）
    
    -- 软删除支持（用于撤销/重做一致性）
    deleted_at INTEGER,              -- NULL = 活跃；非 NULL = 已软删除（时间戳）
    
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    
    FOREIGN KEY(document_id) REFERENCES workspace_nodes(id) ON DELETE CASCADE
  )`,

  // 索引优化：高频查询场景是“查某个节点的证据”或“查某个文档的所有证据”
  `CREATE INDEX IF NOT EXISTS idx_mindmap_evidence_doc_node ON mindmap_evidence(document_id, mindmap_node_id)`,
  
  // 索引优化：同源更新查询 (查某个文档内引用了特定 source_id 的证据)
  `CREATE INDEX IF NOT EXISTS idx_mindmap_evidence_source ON mindmap_evidence(document_id, source_id)`,
  
  // 索引优化：ref 文档内唯一（仅当 ref 非空时）
  // 说明：ref 的使用语义是“在单个 mindmap 文档内可稳定引用某条 evidence”，因此限定为 (document_id, ref) 唯一最合理。
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_mindmap_evidence_ref ON mindmap_evidence(document_id, ref) WHERE ref IS NOT NULL`,
  
  // 索引优化：软删除查询（清理任务用）
  `CREATE INDEX IF NOT EXISTS idx_mindmap_evidence_deleted ON mindmap_evidence(deleted_at) WHERE deleted_at IS NOT NULL`
];
