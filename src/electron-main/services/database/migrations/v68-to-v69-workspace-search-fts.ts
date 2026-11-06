import type Database from 'better-sqlite3';

/**
 * v68→v69：删除自建 trigram grep 索引（lines / grams / files）。
 *
 * 这些表只是可重建的搜索缓存，体积约为正文的百倍以上。新的 FTS5 索引表由
 * Workspace schema provider 幂等创建，并在下一次目录 grep 时按需重建，不迁移旧行。
 * DROP 释放的页进入空闲列表，数据库文件本身要在 VACUUM 后才会缩小。
 *
 * 耗时与旧索引体积成正比：SQLite 删除时要逐页读取旧 B-tree。开发库 16.8GB 旧索引冷读约 197s、
 * 系统缓存已热约 53s；普通用户的旧索引通常在 GB 以内，约为秒级到十几秒。这是一次性代价。
 */
export function migrateV68ToV69WorkspaceSearchFts(db: Database.Database): void {
  db.exec(`
    DROP TABLE IF EXISTS workspace_vfs_search_grams;
    DROP TABLE IF EXISTS workspace_vfs_search_lines;
    DROP TABLE IF EXISTS workspace_vfs_search_files;
  `);
}
