import { describe, expect, it, vi } from 'vitest';

import type { MetadataRepository } from '../metadataRepository';
import type { QdrantRepository } from '../qdrantRepository';
import { runChunkCollectionStartupMaintenanceOnce } from './startupChunkCollectionMaintenance';

function createMetadataRepositoryStub(): MetadataRepository {
  return {
    createKnowledgeBase: async (kb) => kb,
    getAllKnowledgeBases: async () => [
      {
        id: 'default',
        name: '默认',
        description: '',
        createdAt: new Date(0).toISOString(),
        updatedAt: new Date(0).toISOString(),
        enableGraphIndexing: false,
        tags: [],
      },
      {
        id: 'kb-2',
        name: '知识库2',
        description: '',
        createdAt: new Date(0).toISOString(),
        updatedAt: new Date(0).toISOString(),
        enableGraphIndexing: false,
        tags: [],
      },
    ],
    getDocumentCountsByKnowledgeBaseIds: async () => ({}),
    getKnowledgeBaseById: async () => undefined,
    getKnowledgeBaseEmbeddingProvenance: async () => null,
    setKnowledgeBaseEmbeddingProvenance: async () => undefined,
    deleteKnowledgeBase: async () => true,
    updateKnowledgeBase: async () => undefined,
    addDocument: async (doc) => doc,
    getDocumentById: async () => undefined,
    getDocumentsInKnowledgeBase: async () => [],
    getAllDocuments: async () => [],
    updateDocumentStatus: async () => true,
    updateDocumentParseDiagnostics: async () => true,
    deleteDocument: async () => true,
    close: () => undefined,
  };
}

function createQdrantRepositoryStub(): QdrantRepository {
  return {
    getOrCreateCollection: async () => undefined,
    deleteCollection: async () => undefined,
    addPoints: async () => undefined,
    semanticSearch: async () => [],
    keywordSearch: async () => [],
    hybridSearch: async () => ({
      semanticResults: [],
      keywordResults: [],
      combinedResults: [],
    }),
    deletePointsByDocId: async () => undefined,
    deletePointsByIds: async () => undefined,
    deletePointsByFilter: async () => undefined,
    countPointsByDocId: async () => 0,
    countPointsByIds: async () => 0,
    getCollectionInfo: async () => ({
      vectors_count: 0,
      indexed_vectors_count: 0,
      points_count: 0,
      segments_count: 0,
      config: {},
    }),
    getAllPoints: async () => [],
    scrollPointsPage: async () => ({ points: [], nextOffset: undefined }),
    collectionExists: async () => false,
  };
}

describe('startupChunkCollectionMaintenance', () => {
  it('仓储不支持收缩能力时应直接跳过', async () => {
    const stats = await runChunkCollectionStartupMaintenanceOnce(
      createMetadataRepositoryStub(),
      createQdrantRepositoryStub()
    );

    expect(stats).toEqual({
      scannedCollections: 0,
      recreatedCollections: 0,
      deletedEmptyCollections: 0,
      skippedCollections: 0,
      failedCollections: 0,
    });
  });

  it('应遍历所有知识库并累计统计', async () => {
    const recreateChunkCollectionIfNeeded = vi
      .fn()
      .mockResolvedValueOnce({
        collectionName: 'default',
        action: 'recreated',
        pointsCountBefore: 100,
        segmentsCountBefore: 6,
        configuredTargetSegmentCountBefore: 1,
        targetSegmentCount: 1,
        restoredPointsCount: 100,
      })
      .mockResolvedValueOnce({
        collectionName: 'kb-2',
        action: 'deleted_empty',
        pointsCountBefore: 0,
        segmentsCountBefore: 4,
        configuredTargetSegmentCountBefore: 1,
        targetSegmentCount: 1,
        restoredPointsCount: 0,
      });

    const stats = await runChunkCollectionStartupMaintenanceOnce(
      createMetadataRepositoryStub(),
      {
        ...createQdrantRepositoryStub(),
        recreateChunkCollectionIfNeeded,
      }
    );

    expect(recreateChunkCollectionIfNeeded).toHaveBeenCalledTimes(2);
    expect(stats).toEqual({
      scannedCollections: 2,
      recreatedCollections: 1,
      deletedEmptyCollections: 1,
      skippedCollections: 0,
      failedCollections: 0,
    });
  });
});
