import type Database from 'better-sqlite3';

/**
 * `workspace_nodes.tags` 只存过资源库角色标记；资源库投影已删除，生产代码不再写入。
 * 列退役后，用户可见的标签由语义层的独立表承载，不复用这个名字。
 * 没有这一列的库（新建库）已由 provider 建好当前表。
 */
export function migrateV74ToV75RetireWorkspaceNodeTags(db: Database.Database): void {
  const hasTags = db.prepare("SELECT 1 FROM pragma_table_info('workspace_nodes') WHERE name = 'tags'").get();
  if (!hasTags) return;
  db.exec('ALTER TABLE workspace_nodes DROP COLUMN tags');
}
