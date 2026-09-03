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

  it('同步兜底路径只发布窄状态事件，不泄露状态机运行时上下文', async () => {
    mocked.addIngestionTask.mockRejectedValueOnce(new Error('queue unavailable'));
    const published: unknown[] = [];
    const metadataRepository = createMetadataRepository();
    const service = new IngestionService({
      metadataRepository,
      originalDocumentRepository: createOriginalDocumentRepository(),
      createNonWorkerIngestionProcessor: (options) => ({
        processDocument: mocked.processDocument.mockImplementation(async (params: {
          taskId: string;
          docId: string;
          filename: string;
        }) => {
          options.statusUpdatePublisher?.({
            taskId: params.taskId,
            docId: params.docId,
            filename: params.filename,
            stage: InternalStage.COMPLETED,
            frontendState: {
              status: FrontendStatus.COMPLETED,
              stage: InternalStage.COMPLETED,
              progress: 100,
              stage_progress: 100,
              message: '已完成',
              doc_id: params.docId,
              filename: params.filename,
              updated_at: 1,
            },
          });
          return {
            success: true,
            newStage: InternalStage.COMPLETED,
            context: {
              taskId: params.taskId,
              docId: params.docId,
              kbId: 'kb-1',
              filename: params.filename,
              filePath: '/tmp/source.pdf',
              embeddingModelId: 'embedding-model',
              currentProgress: 100,
              stageProgress: 100,
              lastUpdated: 1,
            },
          };
        }),
      }),
      statusUpdatePublisher: (event) => {
        published.push(event);
      },
    });

    await service.addDocument(
      'kb-1',
      '/tmp/source.pdf',
      'source.pdf',
      12,
      'embedding-model'
    );

    await vi.waitFor(() => {
      expect(mocked.processDocument).toHaveBeenCalledTimes(1);
      expect(published).toHaveLength(1);
    });

    expect(published[0]).toMatchObject({
      filename: 'source.pdf',
      stage: 'completed',
      frontendState: {
        status: 'completed',
      },
    });
    expect(published[0]).not.toHaveProperty('filePath');
    expect(published[0]).not.toHaveProperty('parseResult');
    expect(published[0]).not.toHaveProperty('vectorizeResult');
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
