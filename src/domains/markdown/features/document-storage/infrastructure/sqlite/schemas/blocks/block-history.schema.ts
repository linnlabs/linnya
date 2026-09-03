/**
 * @file blocks/block-history.schema.ts
 * @description 定义块级版本历史的表结构
 *
 * 用于支持：
 * - AI 修订模式：保存原版本和 AI 建议版本
 * - 块级时光机：查看和恢复历史版本
 *
 * 设计原则：
 * - 版本数据是外部快照，不进入 ProseMirror schema
 * - 每个 RootBlock 可以有多个历史版本
 * - 支持按版本号倒序查询（最新版本在前）
 */

export const BLOCK_HISTORY_SCHEMAS = [
  // 块版本表（时光机主干）
  `CREATE TABLE IF NOT EXISTS markdown_block_versions (
    id TEXT PRIMARY KEY,                 -- 版本记录ID（UUID）
    document_node_id TEXT NOT NULL,      -- 对应 workspace_nodes.id（哪一篇文档）
    target_block_id TEXT NOT NULL,       -- 对应 RootBlock 的 data-id
    block_type TEXT NOT NULL,            -- baseBlock / headingBlock / listBlock 等
    version_number INTEGER NOT NULL,     -- 从 1 开始增长，按 block 内局部编号
    content_json TEXT NOT NULL,          -- 该 block 的内容 JSON（只存 rootBlock 节点本身）
    origin_type TEXT NOT NULL,           -- 'manual' | 'ai' | 'restore'
    origin_metadata TEXT,                -- JSON 字符串：AI 模型ID、prompt、diff 摘要等
    created_at INTEGER NOT NULL,
    FOREIGN KEY(document_node_id) REFERENCES workspace_nodes(id) ON DELETE CASCADE
  )`,

  // 索引：按文档+块+版本号查询（版本号倒序，方便取最新）
  `CREATE INDEX IF NOT EXISTS idx_block_versions_doc_block
   ON markdown_block_versions(document_node_id, target_block_id, version_number DESC)`,

  // 索引：按块ID快速查询所有版本
  `CREATE INDEX IF NOT EXISTS idx_block_versions_block_id
   ON markdown_block_versions(target_block_id)`,
];


