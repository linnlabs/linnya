import type { PluginMigrationDefinition } from '@plugin/backend/pluginMigration';
import { KNOWLEDGE_BASE_SCHEMAS, KNOWLEDGE_GRAPH_SCHEMAS } from '../schemas';

/** 表名、主键和列序保持原状；迁移只接管元数据，不搬动原件或向量文件。 */
export const initialKnowledgeSchema: PluginMigrationDefinition = {
  version: 1,
  description: 'Adopt knowledge documents, project links and graph tables in place',
  up(database) {
    for (const sql of [...KNOWLEDGE_BASE_SCHEMAS, ...KNOWLEDGE_GRAPH_SCHEMAS]) database.exec(sql);
    // 旧 Host v79 正常已补该列；独立接管旧表仍不能猜测已有索引的模型来源。
    const columns = database.prepare('PRAGMA table_info(knowledge_bases)').all();
    if (!columns.some(column => typeof column === 'object' && column !== null
      && 'name' in column && column.name === 'embedding_space_id')) {
      database.exec('ALTER TABLE knowledge_bases ADD COLUMN embedding_space_id TEXT');
    }
  },
};
