import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { KNOWLEDGE_BASE_SCHEMAS } from 'src/features/knowledge-base/infrastructure/sqlite/knowledge-base.schema';
import { BetterSqliteMetadataRepository } from 'src/features/knowledge-base/infrastructure/sqlite/better-sqlite-metadata.repository';
import { createDocument, DocumentStatus } from '../../domain/document';
import { createKnowledgeBase } from '../../domain/knowledgeBase';
import { KnowledgeIndexStateRepository } from './KnowledgeIndexStateRepository';
import { knowledgeIndexIdentityMigration } from './knowledgeIndexMigration';

function openFixture() {
  const database = new Database(':memory:');
  database.exec('CREATE TABLE projects(id TEXT PRIMARY KEY)');
  for (const ddl of KNOWLEDGE_BASE_SCHEMAS) database.exec(ddl);
  const metadata = new BetterSqliteMetadataRepository(database);
  return { database, metadata };
}

describe('knowledge index vector-space ownership', () => {
  it('升级不伪造旧来源，原文与关联不受影响；明确重建后才允许检索', async () => {
    const { database, metadata } = openFixture();
    try {
      const document = { ...createDocument('doc', 'default', '原文.md', 50), status: DocumentStatus.COMPLETED };
      await metadata.addDocument(document);
      await metadata.setKnowledgeBaseEmbeddingProvenance('default', 'old-model');
      knowledgeIndexIdentityMigration.up({ exec: sql => { database.exec(sql); }, prepare: sql => database.prepare<unknown[]>(sql) });
      knowledgeIndexIdentityMigration.up({ exec: sql => { database.exec(sql); }, prepare: sql => database.prepare<unknown[]>(sql) });
      const index = new KnowledgeIndexStateRepository(database);
      expect(index.read('default')).toEqual({ modelId: 'old-model', spaceId: null });
      expect(() => index.claimForAppend('default', { modelId: 'new-model', spaceId: 'space-new' }, true))
        .toThrow('重建');
      expect(() => index.requireReady('default')).toThrow('重建');
      expect((await metadata.getDocumentById('doc'))?.filename).toBe('原文.md');
      index.publishRebuilt('default', { modelId: 'new-model', spaceId: 'space-new' });
      expect(index.requireReady('default')).toEqual({ modelId: 'new-model', spaceId: 'space-new' });
      index.invalidateForRebuild('default');
      expect(() => new KnowledgeIndexStateRepository(database).requireReady('default')).toThrow('重建');
      expect((await metadata.getDocumentById('doc'))?.status).toBe(DocumentStatus.COMPLETED);
    } finally { database.close(); }
  });

  it('首次写入认领一个空间；相同空间不同本地模型可用，其他空间和其他库互不混入', async () => {
    const { database, metadata } = openFixture();
    try {
      knowledgeIndexIdentityMigration.up({ exec: sql => { database.exec(sql); }, prepare: sql => database.prepare<unknown[]>(sql) });
      const index = new KnowledgeIndexStateRepository(database);
      await metadata.createKnowledgeBase(createKnowledgeBase('other', '其他库'));
      index.claimForAppend('default', { modelId: 'model-one', spaceId: 'same-space' }, true);
      index.claimForAppend('default', { modelId: 'model-alias', spaceId: 'same-space' }, true);
      expect(() => index.claimForAppend('default', { modelId: 'model-one', spaceId: 'changed-space' }, true))
        .toThrow('向量空间');
      index.claimForAppend('other', { modelId: 'model-one', spaceId: 'changed-space' }, true);
      expect(index.requireReady('default').spaceId).toBe('same-space');
      expect(index.requireReady('other').spaceId).toBe('changed-space');
    } finally { database.close(); }
  });
});
