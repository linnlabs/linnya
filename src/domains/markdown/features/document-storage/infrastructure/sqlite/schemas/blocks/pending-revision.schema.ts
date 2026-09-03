/**
 * @file blocks/pending-revision.schema.ts
 * @description 定义块级修订意图（Pending Revision）的表结构
 *
 * 用途：
 * - 存储对文档块的修改建议（仅存 new_markdown，不直接改 content_json）
 * - 支持冷文档场景：Agent 通过 edit_file / write_file 写入意图，用户稍后打开时看到修订视图
 *
 * 设计原则：
 * - 同一块最多只保留一条最新 pending 记录（通过唯一索引保证）
 * - 与 markdown_block_versions（块历史）解耦：本表只存「最新建议」，历史表存「版本快照」
 * - 不修改 ProseMirror schema，所有数据仅在后端持久化层流转
 * - operation 为显式字段，不再需要从 meta_json 解析
 */

export const PENDING_REVISION_SCHEMAS = [
  // 块级 Pending Revision 表
  `CREATE TABLE IF NOT EXISTS markdown_block_pending_revisions (
    id TEXT PRIMARY KEY,                    -- 记录 ID（UUID）
    document_node_id TEXT NOT NULL,         -- 对应 workspace_nodes.id（所属文档）
    target_block_id TEXT NOT NULL,          -- 对应 rootBlock.attrs.id（目标块）
    new_markdown TEXT NOT NULL,             -- 建议的完整块 Markdown（受控子集）
    source TEXT NOT NULL DEFAULT 'ai',      -- 来源标记：'ai' | 'user' | 'tool'
    operation TEXT,                         -- 操作类型：'insert' | 'update' | 'delete'（v20 新增）
    meta_json TEXT,                         -- 可选 JSON 字符串：模型 ID、策略标签、信心分等
    created_at INTEGER NOT NULL,            -- 创建时间戳（ms）
    updated_at INTEGER,                     -- 最近一次覆盖时间戳（ms）
    FOREIGN KEY(document_node_id) REFERENCES workspace_nodes(id) ON DELETE CASCADE
  )`,

  // 唯一索引：保证同一块只有一条最新 pending 记录
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_pending_revisions_doc_block
   ON markdown_block_pending_revisions(document_node_id, target_block_id)`,

  // 普通索引：按文档查询所有 pending revisions
  `CREATE INDEX IF NOT EXISTS idx_pending_revisions_document
   ON markdown_block_pending_revisions(document_node_id)`,
];
