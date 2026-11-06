/**
 * @file search-index.schema.ts
 * @description Workspace Path Layer 的行级 grep 搜索索引（SQLite FTS5 trigram）。
 */

export const WORKSPACE_VFS_SEARCH_INDEX_SCHEMAS = [
  // 覆盖度属于整个文件，不能从任意一行或命中数量反推。path 只在这里保存一份，改名只更新一行。
  // AUTOINCREMENT 保证文件 id 永不复用：即使出现遗留行，也不会被后来的文件认领。
  `CREATE TABLE IF NOT EXISTS workspace_vfs_search_index_files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id TEXT NOT NULL,
    inode TEXT NOT NULL,
    path TEXT NOT NULL,
    node_updated_at INTEGER NOT NULL,
    index_version INTEGER NOT NULL,
    max_file_chars INTEGER NOT NULL,
    truncated INTEGER NOT NULL CHECK(truncated IN (0, 1)),
    UNIQUE(project_id, inode)
  )`,

  // 非空行原文只存一份；FTS5 以外部内容方式引用它，不再复制正文或小写副本。
  `CREATE TABLE IF NOT EXISTS workspace_vfs_search_index_lines (
    id INTEGER PRIMARY KEY,
    file_id INTEGER NOT NULL REFERENCES workspace_vfs_search_index_files(id) ON DELETE CASCADE,
    line_no INTEGER NOT NULL,
    text TEXT NOT NULL
  )`,

  // trigram 只用于缩小候选行；最终是否命中由 JS 字面量比较决定。
  // detail=none、columnsize=0：只需要“哪些行含这些三字组”，不需要位置与排名。
  `CREATE VIRTUAL TABLE IF NOT EXISTS workspace_vfs_search_index_fts USING fts5(
    text,
    content='workspace_vfs_search_index_lines',
    content_rowid='id',
    tokenize='trigram',
    detail='none',
    columnsize=0
  )`,

  // 外部内容 FTS 必须与行表同步；任何删除（含文件覆盖记录级联）都经由触发器撤回倒排项。
  `CREATE TRIGGER IF NOT EXISTS workspace_vfs_search_index_lines_after_insert
    AFTER INSERT ON workspace_vfs_search_index_lines BEGIN
      INSERT INTO workspace_vfs_search_index_fts(rowid, text) VALUES (new.id, new.text);
    END`,

  `CREATE TRIGGER IF NOT EXISTS workspace_vfs_search_index_lines_after_delete
    AFTER DELETE ON workspace_vfs_search_index_lines BEGIN
      INSERT INTO workspace_vfs_search_index_fts(workspace_vfs_search_index_fts, rowid, text)
      VALUES ('delete', old.id, old.text);
    END`,

  `CREATE TRIGGER IF NOT EXISTS workspace_vfs_search_index_lines_after_update
    AFTER UPDATE OF id, text ON workspace_vfs_search_index_lines BEGIN
      INSERT INTO workspace_vfs_search_index_fts(workspace_vfs_search_index_fts, rowid, text)
      VALUES ('delete', old.id, old.text);
      INSERT INTO workspace_vfs_search_index_fts(rowid, text) VALUES (new.id, new.text);
    END`,

  `CREATE INDEX IF NOT EXISTS idx_workspace_vfs_search_index_lines_file
    ON workspace_vfs_search_index_lines(file_id, line_no)`,
];
