import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { DocumentSoT } from '../domain/block';
import { DocumentStatus, type Document } from '../domain/document';
import type { MetadataRepository } from '../infrastructure/metadataRepository';
import type { QdrantRepository } from '../infrastructure/qdrantRepository';
import type { SotRepository } from '../infrastructure/sotRepository';
import type { KnowledgeGraphRepository } from '../graph/infrastructure/knowledgeGraphRepository';

type LogEntry = {
  level: 'debug' | 'info' | 'warn' | 'error';
  module: string;
  message: string;
  data?: unknown;
};

const mocked = vi.hoisted(() => ({
  logEntries: [] as LogEntry[]
}));

vi.mock('src/shared/logger', () => ({
  Logger: class {
    private readonly module: string;

    constructor(module: string) {
      this.module = module;
    }

    debug(message: string, data?: unknown): void {
      mocked.logEntries.push({ level: 'debug', module: this.module, message, data });
    }

    info(message: string, data?: unknown): void {
      mocked.logEntries.push({ level: 'info', module: this.module, message, data });
    }

    warn(message: string, data?: unknown): void {
      mocked.logEntries.push({ level: 'warn', module: this.module, message, data });
    }

    error(message: string, data?: unknown): void {
      mocked.logEntries.push({ level: 'error', module: this.module, message, data });
    }
  },
}));

import { runKnowledgeBaseStartupMaintenanceOnce } from './failureCleanup';

function createDocument(id: string, status: DocumentStatus): Document {
  return {
    id,
    kbId: 'default',
    filename: `${id}.md`,
    fileSize: 1,
    status,
    createdAt: 0,
    updatedAt: 0,
    errorMessage: null,
    taskId: null,
  };
}

function createMetadataRepositoryStub(docs: Document[]): MetadataRepository {
  const store = new Map(docs.map((doc) => [doc.id, { ...doc }]));

  return {
    createKnowledgeBase: async (kb) => kb,
    getAllKnowledgeBases: async () => [
      {
        id: 'default',
        name: '默认',
        description: '',
        enableGraphIndexing: false,
        createdAt: new Date(0).toISOString(),
        updatedAt: new Date(0).toISOString(),
        tags: [],
      },
    ],
    getDocumentCountsByKnowledgeBaseIds: async () => ({}),
    getKnowledgeBaseById: async () => undefined,
    getKnowledgeBaseEmbeddingProvenance: async () => null,
    setKnowledgeBaseEmbeddingProvenance: async () => undefined,
    deleteKnowledgeBase: async () => true,
    updateKnowledgeBase: async () => undefined,
    addDocument: async (doc) => {
      store.set(doc.id, { ...doc });
      return doc;
    },
    getDocumentById: async (docId) => store.get(docId),
    getDocumentsInKnowledgeBase: async (kbId) =>
      Array.from(store.values()).filter((doc) => doc.kbId === kbId),
    getAllDocuments: async () => Array.from(store.values()),
    updateDocumentStatus: async (docId, status, errorMessage) => {
      const doc = store.get(docId);
      if (!doc) return false;
      store.set(docId, {
        ...doc,
        status,
        errorMessage: errorMessage ?? null,
      });
      return true;
    },
    updateDocumentParseDiagnostics: async (docId, diagnostics) => {
      const doc = store.get(docId);
      if (!doc) return false;
      store.set(docId, {
        ...doc,
        parseDiagnostics: diagnostics,
      });
      return true;
    },
    deleteDocument: async (docId) => store.delete(docId),
    close: () => undefined,
  };
}

function createSotRepositoryStub(docIds: string[]): SotRepository {
  const store = new Map<string, DocumentSoT>(
    docIds.map((docId) => [
      docId,
      {
        doc_id: docId,
        doc_title: `${docId}.md`,
        metadata: {
          source_file: `${docId}.md`,
          ingestion_timestamp: 1000,
          file_size: 1,
        },
        content_blocks: {},
        structure: {
          root: [],
        },
      } satisfies DocumentSoT,
    ])
  );

  return {
    save: async (docId, data) => {
      store.set(docId, data);
    },
    get: async (docId) => store.get(docId),
    delete: async (docId) => store.delete(docId),
    listAllDocumentIds: async () => Array.from(store.keys()),
  };
}

function createQdrantRepositoryStub(collectionDocs: Record<string, string[]>): QdrantRepository {
  const collections = new Map(
    Object.entries(collectionDocs).map(([collectionName, docIds]) => [collectionName, new Set(docIds)])
  );

  return {
    // 这些能力与当前测试无关，保留最小实现以满足完整仓储接口。
    getOrCreateCollection: async (collectionName) => {
      if (!collections.has(collectionName)) {
        collections.set(collectionName, new Set());
      }
    },
    deleteCollection: async (collectionName) => {
      collections.delete(collectionName);
    },
    addPoints: async (collectionName, points) => {
      const docs = collections.get(collectionName) ?? new Set<string>();
      for (const point of points) {
        const docId = point.payload.doc_id;
        if (typeof docId === 'string' && docId.length > 0) {
          docs.add(docId);
        }
      }
      collections.set(collectionName, docs);
    },
    semanticSearch: async () => [],
    keywordSearch: async () => [],
    hybridSearch: async () => ({
      semanticResults: [],
      keywordResults: [],
      combinedResults: [],
    }),
    collectionExists: async (collectionName: string) => collections.has(collectionName),
    getCollectionInfo: async (collectionName: string) => ({
      vectors_count: 0,
      indexed_vectors_count: 0,
      points_count: collections.get(collectionName)?.size ?? 0,
      segments_count: 0,
      config: {},
    }),
    getAllPoints: async (collectionName: string) =>
      Array.from(collections.get(collectionName) ?? []).map((docId) => ({
        id: docId,
        payload: { doc_id: docId },
      })),
    scrollPointsPage: async (collectionName: string, limit: number, offset?: unknown) => {
      const docIds = Array.from(collections.get(collectionName) ?? []);
      const startIndex = typeof offset === 'number' ? offset : 0;
      const pageDocIds = docIds.slice(startIndex, startIndex + limit);
      const nextIndex = startIndex + pageDocIds.length;

      return {
        points: pageDocIds.map((docId) => ({
          id: docId,
          payload: { doc_id: docId },
        })),
        nextOffset: nextIndex < docIds.length ? nextIndex : undefined,
      };
    },
    deletePointsByDocId: async (collectionName: string, docId: string) => {
      collections.get(collectionName)?.delete(docId);
    },
    deletePointsByIds: async (collectionName: string, pointIds: string[]) => {
      const ids = new Set(pointIds);
      const docs = collections.get(collectionName);
      if (!docs) return;
      for (const docId of Array.from(docs)) {
        if (ids.has(docId)) {
          docs.delete(docId);
        }
      }
    },
    deletePointsByFilter: async (collectionName, filter) => {
      for (const docId of filter.docIds ?? []) {
        collections.get(collectionName)?.delete(docId);
      }
    },
    countPointsByDocId: async (collectionName, docId) =>
      collections.get(collectionName)?.has(docId) ? 1 : 0,
    countPointsByIds: async (collectionName, pointIds) => {
      const docs = collections.get(collectionName);
      if (!docs) return 0;
      return pointIds.filter((pointId) => docs.has(pointId)).length;
    },
  };
}

function createKnowledgeGraphRepositoryStub(): KnowledgeGraphRepository {
  return {
    // 这些方法与当前测试断言无关，返回空实现即可。
    upsertNodes: async () => undefined,
    upsertEdges: async () => undefined,
    getNodesByIds: async () => [],
    listEdgesByEvidence: async () => [],
    listEdgesByEntity: async () => [],
    listNodesBySourceDocId: async () => [],
    listEdgesByEvidenceDocId: async () => [],
    upsertDocStatus: async () => undefined,
    getDocStatus: async () => undefined,
    tryAcquireDocExtractionLock: async () => true,
    updateDocProgress: async () => undefined,
    getKbProgress: async (kbId) => ({
      kbId,
      totalUnits: 0,
      doneUnits: 0,
      progress: 0,
      updatedAtSeconds: null,
    }),
    upsertVectorDocStatus: async () => undefined,
    updateVectorDocProgress: async () => undefined,
    getVectorDocStatus: async () => undefined,
    listVectorDocStatusByKb: async () => [],
    deleteGraphDataForDocument: async () => ({
      deletedEdges: 0,
      deletedDocStatus: 0,
      deletedOrphanNodes: 0,
    }),
    deleteDocStatusForDocument: async () => 0,
    deleteGraphDataForKb: async () => ({
      deletedNodes: 0,
      deletedEdges: 0,
      deletedDocStatus: 0,
      deletedVectorDocStatus: 0,
      deletedIndexStatus: 0,
    }),
  };
}

describe('failureCleanup logging aggregation', () => {
  beforeEach(() => {
    mocked.logEntries.length = 0;
  });

  it('应将健康文档汇总为单条摘要而不是逐文档输出', async () => {
    const metadataRepository = createMetadataRepositoryStub([
      createDocument('doc-1', DocumentStatus.COMPLETED),
      createDocument('doc-2', DocumentStatus.COMPLETED),
      createDocument('doc-3', DocumentStatus.COMPLETED),
    ]);

    const stats = await runKnowledgeBaseStartupMaintenanceOnce(
      metadataRepository,
      createQdrantRepositoryStub({ default: ['doc-1', 'doc-2', 'doc-3'] }),
      createSotRepositoryStub(['doc-1', 'doc-2', 'doc-3']),
      createKnowledgeGraphRepositoryStub()
    );

    expect(stats).toEqual({
      totalFailed: 0,
      sqliteCleared: 0,
      qdrantCleared: 0,
      sotCleared: 0,
    });

    const summaryLog = mocked.logEntries.find((entry) =>
      entry.message.includes('一致性检查汇总')
    );

    expect(summaryLog).toBeDefined();
    expect(summaryLog?.data).toMatchObject({
      scannedDocs: 3,
      cleanupCandidateCount: 0,
      healthy: {
        completed: 3,
      },
    });

    expect(
      mocked.logEntries.some(
        (entry) =>
          entry.message.includes('检查文档') ||
          entry.message.includes('状态分析') ||
          entry.message.includes('已完成文档数据完整')
      )
    ).toBe(false);
  });

  it('应按异常类别输出汇总而不是为每个异常文档单独打扫描日志', async () => {
    const metadataRepository = createMetadataRepositoryStub([
      createDocument('doc-pending-partial', DocumentStatus.PENDING),
      createDocument('doc-completed-missing', DocumentStatus.COMPLETED),
      createDocument('doc-failed-residual', DocumentStatus.FAILED),
    ]);

    const stats = await runKnowledgeBaseStartupMaintenanceOnce(
      metadataRepository,
      createQdrantRepositoryStub({ default: ['doc-failed-residual'] }),
      createSotRepositoryStub(['doc-pending-partial', 'doc-completed-missing']),
      createKnowledgeGraphRepositoryStub()
    );

    expect(stats.totalFailed).toBe(3);

    expect(
      mocked.logEntries.find((entry) =>
        entry.message.includes('待清理分类: pending/processing 仅部分数据存在')
      )?.data
    ).toMatchObject({
      count: 1,
      sampleDocIds: ['doc-pending-partial'],
    });

    expect(
      mocked.logEntries.find((entry) =>
        entry.message.includes('待清理分类: completed 文档缺少 SoT 或 Qdrant 数据')
      )?.data
    ).toMatchObject({
      count: 1,
      sampleDocIds: ['doc-completed-missing'],
    });

    expect(
      mocked.logEntries.find((entry) =>
        entry.message.includes('待清理分类: failed 文档仍残留数据')
      )?.data
    ).toMatchObject({
      count: 1,
      sampleDocIds: ['doc-failed-residual'],
    });

    expect(
      mocked.logEntries.some(
        (entry) =>
          entry.message.includes('数据不一致: doc-pending-partial') ||
          entry.message.includes('已完成文档数据缺失: doc-completed-missing') ||
          entry.message.includes('失败文档有残留数据: doc-failed-residual')
      )
    ).toBe(false);
  });
});
