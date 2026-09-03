import { describe, it, expect } from 'vitest';

import type { QdrantRepository, SearchResult } from '../../infrastructure/qdrantRepository';
import type { EmbeddingPort } from 'src/domains/model-inference';
import { GraphDiscoveryService } from '../application/graphDiscoveryService';

class FakeEmbedder implements EmbeddingPort {
  async embed(request: Parameters<EmbeddingPort['embed']>[0]) {
    return { vectors: request.values.map(() => [0.1, 0.2, 0.3]) };
  }
}

class FakeQdrantRepository implements QdrantRepository {
  private readonly points: SearchResult['combinedResults'];

  constructor(points: SearchResult['combinedResults']) {
    this.points = points;
  }

  async semanticSearch(): Promise<import('../../infrastructure/qdrantRepository').RetrievedPoint[]> {
    return this.points;
  }

  // --- 下面的方法不是本单测关心的路径，若被调用说明测试场景设计错误 ---
  async hybridSearch(): Promise<SearchResult> {
    throw new Error('Not implemented in FakeQdrantRepository');
  }
  async getOrCreateCollection(): Promise<void> {
    throw new Error('Not implemented in FakeQdrantRepository');
  }
  async deleteCollection(): Promise<void> {
    throw new Error('Not implemented in FakeQdrantRepository');
  }
  async addPoints(): Promise<void> {
    throw new Error('Not implemented in FakeQdrantRepository');
  }
  async keywordSearch(): Promise<import('../../infrastructure/qdrantRepository').RetrievedPoint[]> {
    throw new Error('Not implemented in FakeQdrantRepository');
  }
  async searchWithMetadata(): Promise<import('../../infrastructure/qdrantRepository').RetrievedPoint[]> {
    throw new Error('Not implemented in FakeQdrantRepository');
  }
  async deletePointsByDocId(): Promise<void> {
    throw new Error('Not implemented in FakeQdrantRepository');
  }
  async deletePointsByDocIds(): Promise<void> {
    throw new Error('Not implemented in FakeQdrantRepository');
  }
  async deletePointsByIds(): Promise<void> {
    throw new Error('Not implemented in FakeQdrantRepository');
  }
  async deletePointsByFilter(): Promise<void> {
    throw new Error('Not implemented in FakeQdrantRepository');
  }
  async countPointsByDocId(): Promise<number> {
    throw new Error('Not implemented in FakeQdrantRepository');
  }
  async countPointsByIds(): Promise<number> {
    throw new Error('Not implemented in FakeQdrantRepository');
  }
  async getCollectionInfo(): Promise<{ vectors_count: number; indexed_vectors_count: number; points_count: number; segments_count: number; config: Record<string, unknown> }> {
    throw new Error('Not implemented in FakeQdrantRepository');
  }
  async getAllPoints(): Promise<Array<{ id: string; payload: Record<string, unknown> }>> {
    throw new Error('Not implemented in FakeQdrantRepository');
  }
  async scrollPointsPage(): Promise<{
    points: Array<{ id: string; payload: Record<string, unknown> }>;
    nextOffset?: unknown;
  }> {
    throw new Error('Not implemented in FakeQdrantRepository');
  }
  async collectionExists(): Promise<boolean> {
    throw new Error('Not implemented in FakeQdrantRepository');
  }
}

describe('GraphDiscoveryService (soft discovery)', () => {
  it('应去重、并排除已有证据块', async () => {
    const repo = new FakeQdrantRepository([
      {
        id: 'p1',
        score: 0.9,
        payload: {
          doc_id: 'doc-a',
          block_id: 'b-1',
          document: '',
          doc_title: '',
          block_type: 'kg_edge',
        },
        match_type: 'semantic',
      },
      // duplicate
      {
        id: 'p2',
        score: 0.8,
        payload: {
          doc_id: 'doc-a',
          block_id: 'b-1',
          document: '',
          doc_title: '',
          block_type: 'kg_edge',
        },
        match_type: 'semantic',
      },
      // excluded
      {
        id: 'p3',
        score: 0.7,
        payload: {
          doc_id: 'doc-b',
          block_id: 'b-2',
          document: '',
          doc_title: '',
          block_type: 'kg_edge',
        },
        match_type: 'semantic',
      },
    ]);

    const svc = new GraphDiscoveryService(repo, new FakeEmbedder());
    const out = await svc.discoverEvidenceBlocksByQuery({
      kbId: 'kb-1',
      query: '碳中和',
      embeddingModelId: 'emb-1',
      topKEdges: 10,
      maxBlocks: 5,
      excludeKeys: new Set(['doc-b|b-2']),
      minSemanticScore: 0,
    });

    expect(out).toHaveLength(1);
    expect(out[0]).toEqual({ docId: 'doc-a', blockId: 'b-1', score: 0.9 });
  });

  it('maxBlocks=0 时应直接返回空数组', async () => {
    const repo = new FakeQdrantRepository([]);
    const svc = new GraphDiscoveryService(repo, new FakeEmbedder());
    const out = await svc.discoverEvidenceBlocksByQuery({
      kbId: 'kb-1',
      query: 'x',
      embeddingModelId: 'emb-1',
      topKEdges: 10,
      maxBlocks: 0,
      excludeKeys: new Set(),
      minSemanticScore: 0,
    });
    expect(out).toEqual([]);
  });
});
