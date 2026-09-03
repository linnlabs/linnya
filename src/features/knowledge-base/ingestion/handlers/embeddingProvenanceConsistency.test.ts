import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BlockType, type DocumentSoT } from '../../domain/block';
import { DocumentStatus, type Document } from '../../domain/document';
import type { KnowledgeBase } from '../../domain/knowledgeBase';
import type { MetadataRepository } from '../../infrastructure/metadataRepository';
import type { QdrantPoint, QdrantRepository, RetrievedPoint, SearchResult } from '../../infrastructure/qdrantRepository';
import type { SotRepository } from '../../infrastructure/sotRepository';
import type { TaskContext } from '../definitions/state';
import { InternalStage } from '../definitions/state';
import { PendingHandler } from './PendingHandler';
import { StoringHandler } from './StoringHandler';

describe('embedding provenance consistency in ingestion', () => {
  let tempDir: string;
  let sourcePath: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'kb-provenance-'));
    sourcePath = path.join(tempDir, 'source.txt');
    await fs.writeFile(sourcePath, 'hello');
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('Pending 阶段阻止向已有索引的 KB 追加不同 embedding 模型的文档', async () => {
    const metadata = createMetadataRepository('embedding-a');
    const handler = new PendingHandler(metadata);

    const result = await handler.execute(createTaskContext({
      filePath: sourcePath,
      embeddingModelId: 'embedding-b',
    }));

    expect(result.success).toBe(false);
    expect(result.newStage).toBe(InternalStage.FAILED);
    expect(result.error).toContain('embedding-a');
    expect(result.error).toContain('embedding-b');
    expect(result.error).toContain('清空并重新导入');
  });

  it('Storing 阶段首次提交时写入 embedding 出身事实', async () => {
    const metadata = createMetadataRepository(null);
    const handler = new StoringHandler(createSotRepository(), createQdrantRepository(), metadata);

    const result = await handler.execute(createTaskContext({
      filePath: sourcePath,
      embeddingModelId: 'embedding-a',
      parseResult: createParseResult(),
      vectorizeResult: createVectorizeResult(),
    }));

    expect(result.success).toBe(true);
    expect(metadata.writtenProvenance).toEqual(['embedding-a']);
    expect(await metadata.getKnowledgeBaseEmbeddingProvenance('kb-1')).toBe('embedding-a');
  });

  it('Storing 阶段已有相同出身时不重复覆盖 provenance', async () => {
    const metadata = createMetadataRepository('embedding-a');
    const handler = new StoringHandler(createSotRepository(), createQdrantRepository(), metadata);

    const result = await handler.execute(createTaskContext({
      filePath: sourcePath,
      embeddingModelId: 'embedding-a',
      parseResult: createParseResult(),
      vectorizeResult: createVectorizeResult(),
    }));

    expect(result.success).toBe(true);
    expect(metadata.writtenProvenance).toEqual([]);
    expect(await metadata.getKnowledgeBaseEmbeddingProvenance('kb-1')).toBe('embedding-a');
  });

  it('Storing 阶段已有不同出身时失败，且不会覆盖 provenance', async () => {
    const metadata = createMetadataRepository('embedding-a');
    const sot = createSotRepository();
    const qdrant = createQdrantRepository();
    const handler = new StoringHandler(sot, qdrant, metadata);

    const result = await handler.execute(createTaskContext({
      filePath: sourcePath,
      embeddingModelId: 'embedding-b',
      parseResult: createParseResult(),
      vectorizeResult: createVectorizeResult(),
    }));

    expect(result.success).toBe(false);
    expect(result.newStage).toBe(InternalStage.FAILED);
    expect(result.error).toContain('embedding-a');
    expect(result.error).toContain('embedding-b');
    expect(metadata.writtenProvenance).toEqual([]);
    expect(await metadata.getKnowledgeBaseEmbeddingProvenance('kb-1')).toBe('embedding-a');
    expect(await sot.get('doc-1')).toBeUndefined();
    expect(qdrant.addedPointIds).toEqual([]);
  });
});

function createTaskContext(overrides: Partial<TaskContext> = {}): TaskContext {
  return {
    taskId: 'task-1',
    docId: 'doc-1',
    kbId: 'kb-1',
    filename: 'source.txt',
    filePath: '/tmp/source.txt',
    embeddingModelId: 'embedding-a',
    currentProgress: 0,
    stageProgress: 0,
    lastUpdated: Date.now(),
    ...overrides,
  };
}

function createParseResult(): TaskContext['parseResult'] {
  const sourceDoc: DocumentSoT = {
    doc_id: 'doc-1',
    doc_title: 'source.txt',
    metadata: {
      source_file: 'source.txt',
      ingestion_timestamp: 1,
    },
    content_blocks: {
      'block-1': {
        block_type: BlockType.PARAGRAPH,
        text: 'hello',
        level: null,
        source_info: { page_num: 1 },
      },
    },
    structure: {
      root: ['block-1'],
    },
  };

  return {
    contentBlocks: [
      {
        id: 'block-1',
        block_type: BlockType.PARAGRAPH,
        text: 'hello',
        level: null,
        source_info: { page_num: 1 },
      },
    ],
    sourceDoc,
    metadata: {
      fileType: 'txt',
      totalBlocks: 1,
      parser: 'test',
      postProcessed: true,
    },
  };
}

function createVectorizeResult(): TaskContext['vectorizeResult'] {
  return {
    vectorizedBlocks: [
      {
        id: 'block-1',
        block_type: BlockType.PARAGRAPH,
        text: 'hello',
        level: null,
        source_info: { page_num: 1 },
        vector: [0.1, 0.2, 0.3],
        sparse_vector: { indices: [1], values: [1] },
        vectorModel: 'embedding-a',
        sparseVectorModel: 'bm25',
        vectorTimestamp: 1,
      },
    ],
    metadata: {},
  };
}

type MetadataRepositoryStub = MetadataRepository & {
  writtenProvenance: string[];
};

function createMetadataRepository(initialProvenance: string | null): MetadataRepositoryStub {
  let provenance = initialProvenance;
  const writtenProvenance: string[] = [];
  const docs = new Map<string, Document>();
  const kb: KnowledgeBase = {
    id: 'kb-1',
    name: 'KB',
    description: '',
    enableGraphIndexing: false,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
    tags: [],
  };

  return {
    writtenProvenance,
    createKnowledgeBase: async (input) => input,
    getAllKnowledgeBases: async () => [kb],
    getDocumentCountsByKnowledgeBaseIds: async () => ({}),
    getKnowledgeBaseById: async (kbId) => (kbId === kb.id ? kb : undefined),
    getKnowledgeBaseEmbeddingProvenance: async (kbId) => (kbId === kb.id ? provenance : null),
    setKnowledgeBaseEmbeddingProvenance: async (kbId, embeddingModelId) => {
      if (kbId === kb.id) {
        provenance = embeddingModelId;
        writtenProvenance.push(embeddingModelId);
      }
    },
    deleteKnowledgeBase: async () => true,
    updateKnowledgeBase: async () => undefined,
    addDocument: async (doc) => {
      docs.set(doc.id, doc);
      return doc;
    },
    getDocumentById: async (docId) => docs.get(docId),
    getDocumentsInKnowledgeBase: async () => Array.from(docs.values()),
    getAllDocuments: async () => Array.from(docs.values()),
    updateDocumentStatus: async (docId, status, errorMessage) => {
      const existing = docs.get(docId) ?? {
        id: docId,
        kbId: 'kb-1',
        filename: 'source.txt',
        fileSize: 5,
        status: DocumentStatus.PENDING,
        createdAt: 0,
        updatedAt: 0,
        errorMessage: null,
        taskId: null,
      };
      docs.set(docId, {
        ...existing,
        status,
        errorMessage: errorMessage ?? null,
      });
      return true;
    },
    updateDocumentParseDiagnostics: async () => true,
    deleteDocument: async (docId) => docs.delete(docId),
    close: () => undefined,
  };
}

function createSotRepository(): SotRepository {
  const store = new Map<string, DocumentSoT>();
  return {
    save: async (docId, data) => {
      store.set(docId, data);
    },
    get: async (docId) => store.get(docId),
    delete: async (docId) => store.delete(docId),
    listAllDocumentIds: async () => Array.from(store.keys()),
  };
}

function createQdrantRepository(): QdrantRepository & { addedPointIds: string[] } {
  const points = new Map<string, QdrantPoint>();
  const addedPointIds: string[] = [];
  return {
    addedPointIds,
    getOrCreateCollection: async () => undefined,
    deleteCollection: async () => undefined,
    addPoints: async (_collectionName, inputPoints) => {
      for (const point of inputPoints) {
        points.set(point.id, point);
        addedPointIds.push(point.id);
      }
    },
    semanticSearch: async (): Promise<RetrievedPoint[]> => [],
    keywordSearch: async (): Promise<RetrievedPoint[]> => [],
    hybridSearch: async (): Promise<SearchResult> => ({
      semanticResults: [],
      keywordResults: [],
      combinedResults: [],
    }),
    deletePointsByDocId: async (_collectionName, docId) => {
      for (const [pointId, point] of points.entries()) {
        if (point.payload.doc_id === docId) {
          points.delete(pointId);
        }
      }
    },
    deletePointsByFilter: async () => undefined,
    deletePointsByIds: async (_collectionName, pointIds) => {
      for (const pointId of pointIds) {
        points.delete(pointId);
      }
    },
    countPointsByDocId: async (_collectionName, docId) =>
      Array.from(points.values()).filter((point) => point.payload.doc_id === docId).length,
    countPointsByIds: async (_collectionName, pointIds) =>
      pointIds.filter((pointId) => points.has(pointId)).length,
    getCollectionInfo: async () => ({
      vectors_count: points.size,
      indexed_vectors_count: points.size,
      points_count: points.size,
      segments_count: 1,
      config: {},
    }),
    getAllPoints: async () => Array.from(points.values()).map((point) => ({ id: point.id, payload: point.payload })),
    scrollPointsPage: async () => ({
      points: Array.from(points.values()).map((point) => ({ id: point.id, payload: point.payload })),
      nextOffset: undefined,
    }),
    collectionExists: async () => true,
  };
}
