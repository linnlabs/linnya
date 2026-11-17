import { describe, it, expect } from 'vitest';

import type { QdrantRepository, RetrievedPoint, SearchResult } from '../../../infrastructure/qdrantRepository';
import { GraphNodeAnchorService } from '../../application/anchor/graphNodeAnchorService';

class FakeQdrantRepository implements QdrantRepository {
  private readonly points: RetrievedPoint[] = [];

  setPoints(points: RetrievedPoint[]): void {
    this.points.length = 0;
    for (const p of points) this.points.push(p);
  }

  async semanticSearch(): Promise<RetrievedPoint[]> {
    return this.points;
  }

  // --- 本单测不关心的方法 ---
  async getOrCreateCollection(): Promise<void> {
    throw new Error('Not implemented');
  }
  async deleteCollection(): Promise<void> {
    throw new Error('Not implemented');
  }
  async addPoints(): Promise<void> {
    throw new Error('Not implemented');
  }
  async keywordSearch(): Promise<RetrievedPoint[]> {
    throw new Error('Not implemented');
  }
  async hybridSearch(): Promise<SearchResult> {
    throw new Error('Not implemented');
  }
  async deletePointsByDocId(): Promise<void> {
    throw new Error('Not implemented');
  }
  async deletePointsByIds(): Promise<void> {
    throw new Error('Not implemented');
  }
  async deletePointsByFilter(): Promise<void> {
    throw new Error('Not implemented');
  }
  async countPointsByDocId(): Promise<number> {
    throw new Error('Not implemented');
  }
  async countPointsByIds(): Promise<number> {
    throw new Error('Not implemented');
  }
  async getCollectionInfo(): Promise<{ vectors_count: number; indexed_vectors_count: number; points_count: number; segments_count: number; config: Record<string, unknown> }> {
    throw new Error('Not implemented');
  }
  async getAllPoints(): Promise<Array<{ id: string; payload: Record<string, unknown> }>> {
    throw new Error('Not implemented');
  }
  async scrollPointsPage(): Promise<{ points: Array<{ id: string; payload: Record<string, unknown> }>; nextOffset?: unknown }> {
    throw new Error('Not implemented');
  }
  async collectionExists(): Promise<boolean> {
    throw new Error('Not implemented');
  }
}

describe('GraphNodeAnchorService (Full V3)', () => {
  it('应从 payload.metadata.node_id 提取实体锚点，并去重/排除已有锚点', async () => {
    const qdrant = new FakeQdrantRepository();
    qdrant.setPoints([
      {
        id: 'p1',
        score: 0.95,
        payload: { doc_id: 'd', block_id: 'b', document: '', doc_title: 't', block_type: 'kg_node', metadata: { node_id: 'n1' } },
        match_type: 'semantic',
      },
      {
        id: 'p2',
        score: 0.94,
        payload: { doc_id: 'd', block_id: 'b', document: '', doc_title: 't', block_type: 'kg_node', metadata: { node_id: 'n1' } },
        match_type: 'semantic',
      },
      {
        id: 'p3',
        score: 0.93,
        payload: { doc_id: 'd', block_id: 'b', document: '', doc_title: 't', block_type: 'kg_node', metadata: { node_id: 'n2' } },
        match_type: 'semantic',
      },
    ]);

    const svc = new GraphNodeAnchorService(qdrant);
    const out = await svc.getAnchorEntityIds({
      kbId: 'kb',
      queryVector: [0.1, 0.2],
      topK: 3,
      minSemanticScore: 0.8,
      excludeEntityIds: new Set(['n2']),
    });

    expect(out).toEqual(['n1']);
  });
});
