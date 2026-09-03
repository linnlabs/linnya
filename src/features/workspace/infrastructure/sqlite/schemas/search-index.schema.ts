/**
 * @file search-index.schema.ts
 * @description Workspace Path Layer 的低内存 grep 搜索索引。
 */

export const WORKSPACE_VFS_SEARCH_INDEX_SCHEMAS = [
  `CREATE TABLE IF NOT EXISTS workspace_vfs_search_lines (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    inode TEXT NOT NULL,
    path TEXT NOT NULL,
    name TEXT NOT NULL,
    node_type TEXT NOT NULL,
    source TEXT NOT NULL,
    content_kind TEXT NOT NULL DEFAULT 'content',
    line_no INTEGER NOT NULL,
    text TEXT NOT NULL,
    text_lc TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    node_updated_at INTEGER NOT NULL,
    indexed_at INTEGER NOT NULL,
    UNIQUE(project_id, inode, content_kind, line_no)
  )`,

  `CREATE TABLE IF NOT EXISTS workspace_vfs_search_grams (
    project_id TEXT NOT NULL,
    gram TEXT NOT NULL,
    line_id TEXT NOT NULL,
    PRIMARY KEY(project_id, gram, line_id),
    FOREIGN KEY(line_id) REFERENCES workspace_vfs_search_lines(id) ON DELETE CASCADE
  )`,

  `CREATE INDEX IF NOT EXISTS idx_workspace_vfs_search_lines_project_path
    ON workspace_vfs_search_lines(project_id, path)`,

  `CREATE INDEX IF NOT EXISTS idx_workspace_vfs_search_lines_inode
    ON workspace_vfs_search_lines(project_id, inode)`,

  `CREATE INDEX IF NOT EXISTS idx_workspace_vfs_search_grams_line
    ON workspace_vfs_search_grams(line_id)`,
];
