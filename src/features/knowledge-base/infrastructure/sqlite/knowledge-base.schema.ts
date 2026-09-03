/**
 * @file knowledge-base.schema.ts
 * @description 知识库相关表的 Schema 定义
 * 
 * 本文件定义知识库元数据表结构，包括：
 * - knowledge_bases: 知识库定义与配置
 * - kb_documents: 知识库中的文档列表与状态
 * - project_knowledge_base_links: 项目与知识库的多对多关系
 * 
 * 这些表由 sql.js 版本迁移而来，现在统一纳入 workspace.sqlite 管理。
 */

/**
 * 知识库表
 * 存储知识库的基本信息与模型配置
 */
export const KNOWLEDGE_BASE_SCHEMAS = [
  // 知识库定义表
  `CREATE TABLE IF NOT EXISTS knowledge_bases (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    -- JSON 编码的标签数组，例如 '["产品","内部","重要"]'
    tags_json TEXT,
    embedding_model_id TEXT,
    rerank_model_id TEXT,
    pdf_ocr_model_id TEXT,
    image_vision_model_id TEXT,
    -- 兼容历史字段：保留旧列，避免老代码/旧数据在迁移窗口期失效
    vision_model_id TEXT,
    -- 是否启用“软知识图谱构建”（抽取 + 向量化）：
    -- - 1: 启用（默认）
    -- - 0: 关闭（不再对新文档入队抽取/索引；已存在图谱不受影响）
    enable_graph_indexing INTEGER NOT NULL DEFAULT 1,
    created_at REAL NOT NULL,
    updated_at REAL
  )`,

  // 知识库索引
  `CREATE INDEX IF NOT EXISTS idx_knowledge_bases_created 
   ON knowledge_bases(created_at DESC)`,

  // 知识库文档表
  `CREATE TABLE IF NOT EXISTS kb_documents (
    id TEXT PRIMARY KEY,
    kb_id TEXT NOT NULL,
    filename TEXT NOT NULL,
    file_size INTEGER,
    status TEXT NOT NULL,
    error_message TEXT,
    parse_diagnostics_json TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY(kb_id) REFERENCES knowledge_bases(id) ON DELETE CASCADE
  )`,

  // 知识库文档索引
  `CREATE INDEX IF NOT EXISTS idx_kb_documents_kb_id 
   ON kb_documents(kb_id, created_at DESC)`,
  
  `CREATE INDEX IF NOT EXISTS idx_kb_documents_status 
   ON kb_documents(status)`,

  // 项目与知识库关联表（多对多）
  `CREATE TABLE IF NOT EXISTS project_knowledge_base_links (
    project_id TEXT NOT NULL,
    kb_id TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'read_write',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (project_id, kb_id),
    FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE,
    FOREIGN KEY(kb_id) REFERENCES knowledge_bases(id) ON DELETE CASCADE
  )`,

  // 项目-知识库关联索引（支持双向查询）
  `CREATE INDEX IF NOT EXISTS idx_project_kb_links_project 
   ON project_knowledge_base_links(project_id)`,
  
  `CREATE INDEX IF NOT EXISTS idx_project_kb_links_kb 
   ON project_knowledge_base_links(kb_id)`,
];
