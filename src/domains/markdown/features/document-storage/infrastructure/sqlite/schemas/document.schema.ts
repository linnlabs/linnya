/**
 * @file markdown_document/schemas/core.schema.ts
 * @description 定义 Markdown 文档类型的核心表结构。
 *
 * 这包括：
 * - document_versions: 文档内容的版本历史（存储轻量级的结构骨架）
 * - annotations: 附加到文档块上的批注
 *
 * 资源账本和资源归属关系由 Asset domain 拥有。Markdown 只保存自身文档内容
 * 与块级批注，避免把全局 asset 生命周期再次耦合进文档实现。
 */

export const MARKDOWN_DOCUMENT_SCHEMAS = [
  // 文档内容版本表 (结构骨架)
  `CREATE TABLE IF NOT EXISTS document_versions (
    id TEXT PRIMARY KEY,
    node_id TEXT NOT NULL,
    version_number INTEGER NOT NULL,
    content_json TEXT NOT NULL,
    -- 文本统计：缓存当前版本的总字符数，便于后续做项目级/趋势分析
    char_count INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    author_id TEXT,
    UNIQUE(node_id, version_number),
    FOREIGN KEY(node_id) REFERENCES workspace_nodes(id) ON DELETE CASCADE
  )`,

  // 批注表
  `CREATE TABLE IF NOT EXISTS annotations (
    id TEXT PRIMARY KEY,
    document_node_id TEXT NOT NULL,
    target_block_id TEXT NOT NULL,
    content_json TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    resolved_at INTEGER,
    deleted_at INTEGER,
    FOREIGN KEY(document_node_id) REFERENCES workspace_nodes(id) ON DELETE CASCADE
  )`,

  // 索引优化
  `CREATE INDEX IF NOT EXISTS idx_document_versions_node ON document_versions(node_id, version_number DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_annotations_document_block ON annotations(document_node_id, target_block_id)`,
];
