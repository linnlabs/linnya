import type { PluginMigrationDefinition } from '@linnya/plugin-host-contract/backend/pluginMigration';

/** 原地接管旧表时只补来源字段，不能用当前模型配置伪造已有向量的历史。 */
export const knowledgeIndexIdentityMigration: PluginMigrationDefinition = {
  version: 1,
  description: 'Record embedding vector-space identity without guessing existing index provenance',
  up(database) {
    const columns = database.prepare('PRAGMA table_info(knowledge_bases)').all();
    if (!columns.some(column => typeof column === 'object' && column !== null
      && 'name' in column && column.name === 'embedding_space_id')) {
      database.exec('ALTER TABLE knowledge_bases ADD COLUMN embedding_space_id TEXT');
    }
  },
};
