import Database from 'better-sqlite3';
import { expect, it } from 'vitest';
import { migrateV68ToV69WorkspaceSearchFts } from '../v68-to-v69-workspace-search-fts';

const LEGACY_SEARCH_TABLES = ['workspace_vfs_search_files', 'workspace_vfs_search_grams', 'workspace_vfs_search_lines'];

function readTableNames(db: Database.Database): string[] {
  return db.prepare<[], { name: string }>(
    "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
  ).all().map(row => row.name);
}

it('drops only the legacy trigram grep cache tables and rolls back with its enclosing migration', () => {
  const db = new Database(':memory:');
  try {
    db.pragma('foreign_keys = ON');
    db.exec(`
      CREATE TABLE workspace_nodes (id TEXT PRIMARY KEY, name TEXT NOT NULL);
      CREATE TABLE workspace_vfs_search_files (project_id TEXT NOT NULL, inode TEXT NOT NULL, PRIMARY KEY(project_id, inode));
      CREATE TABLE workspace_vfs_search_lines (id TEXT PRIMARY KEY, text TEXT NOT NULL, text_lc TEXT NOT NULL);
      CREATE TABLE workspace_vfs_search_grams (
        project_id TEXT NOT NULL, gram TEXT NOT NULL, line_id TEXT NOT NULL,
        PRIMARY KEY(project_id, gram, line_id),
        FOREIGN KEY(line_id) REFERENCES workspace_vfs_search_lines(id) ON DELETE CASCADE
      );
      CREATE INDEX idx_workspace_vfs_search_grams_line ON workspace_vfs_search_grams(line_id);
      INSERT INTO workspace_nodes VALUES ('doc', '报告.md');
      INSERT INTO workspace_vfs_search_files VALUES ('project', 'workspace:doc');
      INSERT INTO workspace_vfs_search_lines VALUES ('line', 'Old text', 'old text');
      INSERT INTO workspace_vfs_search_grams VALUES ('project', 'old', 'line');
    `);

    expect(() => db.transaction(() => {
      migrateV68ToV69WorkspaceSearchFts(db);
      throw new Error('abort');
    })()).toThrow('abort');
    expect(readTableNames(db)).toEqual(expect.arrayContaining(LEGACY_SEARCH_TABLES));

    db.transaction(() => migrateV68ToV69WorkspaceSearchFts(db))();
    expect(readTableNames(db)).toEqual(['workspace_nodes']);
    expect(db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE 'idx_workspace_vfs_search%'").all())
      .toEqual([]);
    expect(db.prepare('SELECT * FROM workspace_nodes').all()).toEqual([{ id: 'doc', name: '报告.md' }]);

    // 新库或已迁移库再次执行也不会失败。
    expect(() => db.transaction(() => migrateV68ToV69WorkspaceSearchFts(db))()).not.toThrow();
  } finally {
    db.close();
  }
});
