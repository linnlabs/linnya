import type Database from 'better-sqlite3';

/**
 * 标签记下是谁新建的（用户、Agent 运行或外部 CLI，以及所在对话和 Agent），标签管理里显示来源。
 * 只加列；已有标签不知道来源，留空。语义层的表在 v77 内由 schema provider 补建，
 * 没有这张表的库在迁移后按当前 DDL 建表，这里跳过。改动批次表随 provider 建立，不需要迁移步骤。
 */
export function migrateV77ToV78SemanticTagCreator(db: Database.Database): void {
  const hasTable = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'semantic_tags'").get();
  if (!hasTable) return;
  const columns = new Set(
    (db.prepare("SELECT name FROM pragma_table_info('semantic_tags')").all() as { name: string }[]).map(row => row.name)
  );
  for (const column of ['created_by_kind', 'created_conversation_id', 'created_agent_id']) {
    if (!columns.has(column)) db.exec(`ALTER TABLE semantic_tags ADD COLUMN ${column} TEXT`);
  }
}
