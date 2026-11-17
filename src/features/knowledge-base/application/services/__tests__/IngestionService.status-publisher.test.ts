import { createKnowledgeIndexFixture } from '../../../index-rebuild/testkit/createKnowledgeIndexFixture';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DocumentStatus, type Document } from '../../../domain/document';
import type { KnowledgeBase } from '../../../domain/knowledgeBase';
import type { MetadataRepository } from '../../../infrastructure/metadataRepository';
import type { OriginalDocumentRepository, OriginalDocumentSaveInput } from '../../../infrastructure/originalDocumentRepository';
import type { StatusUpdatePublisher } from '../../../ingestion/definitions/statusUpdate';
import { FrontendStatus, InternalStage } from '../../../ingestion/definitions/state';
import { IngestionService } from '../IngestionService';

const mocked = vi.hoisted(() => ({
  addIngestionTask: vi.fn(),
  processDocument: vi.fn(),
}));

vi.mock('@task-queue/queues', () => ({
  QueueManager: {
    getInstance: () => ({
      addIngestionTask: mocked.addIngestionTask,
    }),
  },
}));

function createMetadataRepository(): MetadataRepository {
  const documents = new Map<string, Document>();
  const kb: KnowledgeBase = {
    id: 'kb-1',
    name: 'KB',
    description: '',
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
    enableGraphIndexing: false,
  };

  return {
    indexState: createKnowledgeIndexFixture(['kb-1']),
    createKnowledgeBase: async (input) => input,
    getAllKnowledgeBases: async () => [kb],
    getDocumentCountsByKnowledgeBaseIds: async () => ({}),
    getKnowledgeBaseById: async (kbId) => (kbId === kb.id ? kb : undefined),
    getKnowledgeBaseEmbeddingProvenance: async () => null,
    setKnowledgeBaseEmbeddingProvenance: async () => undefined,
    deleteKnowledgeBase: async () => true,
    updateKnowledgeBase: async () => undefined,
    addDocument: async (doc) => {
      documents.set(doc.id, doc);
      return doc;
    },
    getDocumentById: async (docId) => documents.get(docId),
    getDocumentsInKnowledgeBase: async () => Array.from(documents.values()),
    getAllDocuments: async () => Array.from(documents.values()),
    updateDocumentStatus: async (docId, status, errorMessage) => {
      const current = documents.get(docId);
      if (!current) return false;
      documents.set(docId, {
        ...current,
        status,
        errorMessage: errorMessage ?? null,
      });
      return true;
    },
    updateDocumentParseDiagnostics: async (docId, diagnostics) => {
      const current = documents.get(docId);
      if (!current) return false;
      documents.set(docId, {
        ...current,
        parseDiagnostics: diagnostics,
      });
      return true;
    },
    deleteDocument: async (docId) => documents.delete(docId),
    close: () => undefined,
  };
}

function createOriginalDocumentRepository(saved: OriginalDocumentSaveInput[] = []): OriginalDocumentRepository {
  return {
    save: async (input) => {
      saved.push(input);
      return {
        kbId: input.kbId,
        docId: input.docId,
        path: input.sourcePath,
        sizeBytes: 12,
      };
    },
    getPath: async () => undefined,
    getSizeBytes: async () => undefined,
    delete: async () => true,
    deleteByKnowledgeBase: async () => 0,
  };
}

describe('IngestionService statusUpdatePublisher', () => {
  beforeEach(() => {
    mocked.addIngestionTask.mockReset();
    mocked.processDocument.mockReset();
  });

  it('队列拒绝时记录明确失败并保留资料，不在 Backend 偷偷启动同步摄入', async () => {
    mocked.addIngestionTask.mockRejectedValueOnce(new Error('knowledge_activity_busy'));
    const metadataRepository = createMetadataRepository();
    const saved: OriginalDocumentSaveInput[] = [];
    const publish = vi.fn<StatusUpdatePublisher>();
    const service = new IngestionService({ metadataRepository,
      originalDocumentRepository: createOriginalDocumentRepository(saved),
      statusUpdatePublisher: publish,
    });
    const result = await service.addDocument('kb-1', '/tmp/source.pdf', 'source.pdf', 12, 'embedding-model');
    await vi.waitFor(async () => {
      expect(await metadataRepository.getDocumentById(result.document.id)).toMatchObject({
        status: 'failed', errorMessage: expect.stringContaining('knowledge_activity_busy'),
      });
    });
    expect(saved).toHaveLength(1);
    expect(mocked.processDocument).not.toHaveBeenCalled();
    expect(mocked.addIngestionTask).toHaveBeenCalledTimes(1);
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({
      taskId: result.taskId, docId: result.document.id, stage: InternalStage.FAILED,
      errorMessage: expect.stringContaining('knowledge_activity_busy'),
    }));
  });

  it('PDF 摄入会在入队前持久化原始文件，作为 partial 续跑的前置数据', async () => {
    mocked.addIngestionTask.mockResolvedValueOnce(undefined);
    const saved: OriginalDocumentSaveInput[] = [];
    const service = new IngestionService({
      metadataRepository: createMetadataRepository(),
      originalDocumentRepository: createOriginalDocumentRepository(saved),
    });

    const result = await service.addDocument(
      'kb-1',
      '/tmp/source.pdf',
      'source.pdf',
      12,
      'embedding-model'
    );

    expect(saved).toEqual([
      {
        kbId: 'kb-1',
        docId: result.document.id,
        sourcePath: '/tmp/source.pdf',
        originalFilename: 'source.pdf',
      },
    ]);
    expect(mocked.addIngestionTask).toHaveBeenCalledTimes(1);
  });

  it('非 PDF 摄入不写原始文件仓储', async () => {
    mocked.addIngestionTask.mockResolvedValueOnce(undefined);
    const saved: OriginalDocumentSaveInput[] = [];
    const service = new IngestionService({
      metadataRepository: createMetadataRepository(),
      originalDocumentRepository: createOriginalDocumentRepository(saved),
    });

    await service.addDocument(
      'kb-1',
      '/tmp/source.txt',
      'source.txt',
      12,
      'embedding-model'
    );

    expect(saved).toHaveLength(0);
    expect(mocked.addIngestionTask).toHaveBeenCalledTimes(1);
  });
});
