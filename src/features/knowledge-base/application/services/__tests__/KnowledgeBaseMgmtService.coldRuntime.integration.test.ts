import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { DatabaseService } from '../../../../../electron-main/services/database';
import { BetterSqliteMetadataRepository } from '../../../infrastructure/sqlite/better-sqlite-metadata.repository';
import { QdrantRepositoryImpl } from '../../../infrastructure/QdrantRepositoryImpl';
import { FileSotRepository } from '../../../infrastructure/sotRepository';
import { FileOriginalDocumentRepository } from '../../../infrastructure/fileOriginalDocumentRepository';
import { KnowledgeBaseMgmtService } from '../KnowledgeBaseMgmtService';
import { DefaultSearchService } from '../../search/defaultSearchService';
import { createDocument } from '../../../domain/document';
import { QdrantRuntimeUnavailableError } from '../../../../../infra/adapters/vector-store/qdrant/errors';

describe('knowledge metadata with a cold vector runtime', () => {
  it('默认库和新库可以原地创建读取；向量启动失败时删除不触碰原文或元数据', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'linnya-kb-cold-'));
    const database = new DatabaseService(path.join(root, 'workspace.sqlite'));
    database.initialize();
    const metadataRepository = new BetterSqliteMetadataRepository(database);
    const resolveAdapter = vi.fn(async () => { throw new QdrantRuntimeUnavailableError('qdrant unavailable'); });
    const sotRepository = new FileSotRepository(path.join(root, 'sot'));
    const originalDocumentRepository = new FileOriginalDocumentRepository(path.join(root, 'originals'));
    const deleteOriginal = vi.spyOn(originalDocumentRepository, 'deleteByKnowledgeBase');
    const deleteSot = vi.spyOn(sotRepository, 'delete');
    const service = new KnowledgeBaseMgmtService({
      metadataRepository,
      qdrantRepository: new QdrantRepositoryImpl(resolveAdapter),
      sotRepository,
      originalDocumentRepository,
    });
    try {
      const defaultKb = await service.getOrCreateDefaultKnowledgeBase();
      const created = await service.createKnowledgeBase('研究资料');
      expect(defaultKb.id).toBe('default');
      expect((await service.getAllKnowledgeBases()).map(kb => kb.id)).toContain(created.id);
      expect(resolveAdapter).not.toHaveBeenCalled();
      const embed = vi.fn(async () => ({ vectors: [[1, 0, 0]] }));
      const search = new DefaultSearchService({
        metadataRepository,
        sotRepository,
        qdrantRepository: new QdrantRepositoryImpl(resolveAdapter),
        embedding: { embed },
        reranking: { rerank: async () => ({ ranking: [] }) },
      });
      expect((await search.search({ kbId: created.id, query: '资料' })).results).toEqual([]);
      expect((await search.searchForAgent(created.id, '资料', { allocate: async () => [] })).hits).toEqual([]);
      expect(embed).not.toHaveBeenCalled();
      expect(resolveAdapter).not.toHaveBeenCalled();

      // 有资料后服务故障必须传播，不能被空召回降级吞掉；已建索引来源保持不变。
      await metadataRepository.addDocument(createDocument('doc-1', created.id, '资料.txt', 20));
      await metadataRepository.setKnowledgeBaseEmbeddingProvenance(created.id, 'existing-model');
      await expect(search.search({ kbId: created.id, query: '资料' })).rejects.toThrow('qdrant unavailable');
      expect(await metadataRepository.getKnowledgeBaseEmbeddingProvenance(created.id)).toBe('existing-model');
      await expect(service.deleteKnowledgeBase(created.id)).rejects.toThrow('qdrant unavailable');
      expect(deleteOriginal).not.toHaveBeenCalled();
      expect(deleteSot).not.toHaveBeenCalled();
      expect((await metadataRepository.getKnowledgeBaseById(created.id))?.name).toBe('研究资料');
    } finally {
      database.close();
      await rm(root, { recursive: true, force: true });
    }
  });
});
