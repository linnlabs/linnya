import Database from 'better-sqlite3';
import { afterEach } from 'vitest';
import { KNOWLEDGE_BASE_SCHEMAS } from '../../infrastructure/sqlite/knowledge-base.schema';
import { KnowledgeIndexStateRepository } from '../persistence/KnowledgeIndexStateRepository';
import type { KnowledgeIndexIdentity } from '../definitions/knowledgeIndex';

const databases: Database.Database[] = [];
afterEach(() => { for (const database of databases.splice(0)) database.close(); });

/** 其他业务测试仍用自己的文档夹具；索引身份直接运行正式 SQLite 规则。 */
export function createKnowledgeIndexFixture(ids: readonly string[], identity?: KnowledgeIndexIdentity) {
  const database = new Database(':memory:');
  databases.push(database);
  database.exec('CREATE TABLE projects(id TEXT PRIMARY KEY)');
  for (const ddl of KNOWLEDGE_BASE_SCHEMAS) database.exec(ddl);
  for (const id of ids) database.prepare('INSERT INTO knowledge_bases(id, name, created_at) VALUES (?, ?, 0)').run(id, id);
  const state = new KnowledgeIndexStateRepository(database);
  if (identity) for (const id of ids) state.publishRebuilt(id, identity);
  return state;
}
