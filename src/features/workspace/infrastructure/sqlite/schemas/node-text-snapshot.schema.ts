/**
 * @file node-text-snapshot.schema.ts
 * @description Workspace 节点事实文本快照。
 *
 * 中文说明：
 * - 这张表由 host 拥有，只保存“可供 read/grep 使用的事实文本”；
 * - 插件可以写入快照，但 host 不理解插件私有结构，也不复制 workspace_nodes 导航真相。
 */

export const WORKSPACE_NODE_TEXT_SNAPSHOT_SCHEMAS = [
  `CREATE TABLE IF NOT EXISTS workspace_node_text_snapshots (
    node_id TEXT PRIMARY KEY,
    content_type TEXT NOT NULL,
    text TEXT NOT NULL,
    source_plugin_id TEXT,
    source_node_type TEXT,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY(node_id) REFERENCES workspace_nodes(id) ON DELETE CASCADE
  )`,

  `CREATE INDEX IF NOT EXISTS idx_workspace_node_text_snapshots_source
    ON workspace_node_text_snapshots(source_plugin_id, source_node_type)`,
];
