import type Database from 'better-sqlite3';

/** 旧索引无法从今天的可编辑配置推断来源；留空并要求显式重建，原文不变。 */
export function migrateV78ToV79KnowledgeIndexIdentity(database: Database.Database): void {
  const table = database.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'knowledge_bases'").get();
  if (!table) return;
  const columns = database.prepare<[], { name: string }>("SELECT name FROM pragma_table_info('knowledge_bases')").all();
  if (!columns.some(column => column.name === 'embedding_space_id')) {
    database.exec('ALTER TABLE knowledge_bases ADD COLUMN embedding_space_id TEXT');
  }
}
