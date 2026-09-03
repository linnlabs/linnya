import { describe, it, expect } from 'vitest';

import type {
  KnowledgeGraphDocStatusRecord,
  KnowledgeGraphEdgeRecord,
  KnowledgeGraphEntityId,
  KnowledgeGraphNodeRecord,
  KnowledgeGraphRepository,
  KnowledgeGraphVectorDocStatusUpsertInput,
  KnowledgeGraphVectorDocStatusValue,
} from '../../infrastructure/knowledgeGraphRepository';
import type { QdrantRepository, RetrievedPoint } from '../../../infrastructure/qdrantRepository';
import { GraphMultiHopService } from '../../application/traversal/graphMultiHopService';

class FakeKnowledgeGraphRepository implements KnowledgeGraphRepository {
  private readonly edges: KnowledgeGraphEdgeRecord[] = [];

  addEdge(e: KnowledgeGraphEdgeRecord): void {
    this.edges.push(e);
  }

  async listEdgesByEntity(
    kbId: string,
    entityId: KnowledgeGraphEntityId,
    direction: 'out' | 'in' | 'both',
    limit?: number
  ): Promise<KnowledgeGraphEdgeRecord[]> {
    const hits = this.edges.filter((e) => {
      if (e.kbId !== kbId) return false;
      if (direction === 'out') return e.sourceEntityId === entityId;
      if (direction === 'in') return e.targetEntityId === entityId;
      return e.sourceEntityId === entityId || e.targetEntityId === entityId;
    });
    if (typeof limit === 'number' && Number.isFinite(limit) && limit > 0) return hits.slice(0, Math.floor(limit));
    return hits;
  }

  // --- 本单测不关心的接口：被调用即视为用例设计错误 ---
  async getDocStatus(): Promise<KnowledgeGraphDocStatusRecord | undefined> {
    throw new Error('Not implemented in FakeKnowledgeGraphRepository');
  }
  async listEdgesByEvidence(): Promise<KnowledgeGraphEdgeRecord[]> {
    throw new Error('Not implemented in FakeKnowledgeGraphRepository');
  }
  async getNodesByIds(): Promise<KnowledgeGraphNodeRecord[]> {
    throw new Error('Not implemented in FakeKnowledgeGraphRepository');
  }
  async upsertNodes(): Promise<void> {
    throw new Error('Not implemented in FakeKnowledgeGraphRepository');
  }
  async upsertEdges(): Promise<void> {
    throw new Error('Not implemented in FakeKnowledgeGraphRepository');
  }
  async listNodesBySourceDocId(): Promise<KnowledgeGraphNodeRecord[]> {
    throw new Error('Not implemented in FakeKnowledgeGraphRepository');
  }
  async listEdgesByEvidenceDocId(): Promise<KnowledgeGraphEdgeRecord[]> {
    throw new Error('Not implemented in FakeKnowledgeGraphRepository');
  }
  async upsertDocStatus(): Promise<void> {
    throw new Error('Not implemented in FakeKnowledgeGraphRepository');
  }
  async tryAcquireDocExtractionLock(): Promise<boolean> {
    throw new Error('Not implemented in FakeKnowledgeGraphRepository');
  }
  async updateDocProgress(): Promise<void> {
    throw new Error('Not implemented in FakeKnowledgeGraphRepository');
  }
  async getKbProgress(): Promise<import('../../infrastructure/knowledgeGraphRepository').KnowledgeGraphKbProgress> {
    throw new Error('Not implemented in FakeKnowledgeGraphRepository');
  }
  async upsertVectorDocStatus(_input: KnowledgeGraphVectorDocStatusUpsertInput): Promise<void> {
    throw new Error('Not implemented in FakeKnowledgeGraphRepository');
  }
  async updateVectorDocProgress(
    _kbId: string,
    _docId: string,
    _doneUnits: number,
    _status?: KnowledgeGraphVectorDocStatusValue
  ): Promise<void> {
    throw new Error('Not implemented in FakeKnowledgeGraphRepository');
  }
  async getVectorDocStatus(): Promise<import('../../infrastructure/knowledgeGraphRepository').KnowledgeGraphVectorDocStatusRecord | undefined> {
    throw new Error('Not implemented in FakeKnowledgeGraphRepository');
  }
  async listVectorDocStatusByKb(): Promise<import('../../infrastructure/knowledgeGraphRepository').KnowledgeGraphVectorDocStatusRecord[]> {
    throw new Error('Not implemented in FakeKnowledgeGraphRepository');
  }
  async deleteGraphDataForDocument(): Promise<{ deletedEdges: number; deletedDocStatus: number; deletedOrphanNodes: number }> {
    throw new Error('Not implemented in FakeKnowledgeGraphRepository');
  }
  async deleteDocStatusForDocument(): Promise<number> {
    throw new Error('Not implemented in FakeKnowledgeGraphRepository');
  }
  async deleteGraphDataForKb(): Promise<{
    deletedNodes: number;
    deletedEdges: number;
    deletedDocStatus: number;
    deletedVectorDocStatus: number;
    deletedIndexStatus: number;
  }> {
    throw new Error('Not implemented in FakeKnowledgeGraphRepository');
  }
}

class FakeQdrantRepository implements QdrantRepository {
  private readonly edgeScores = new Map<string, number>();

  setEdgeScore(edgeId: string, score: number): void {
    this.edgeScores.set(edgeId, score);
  }

  async semanticSearch(
    _collectionName: string,
    _queryVector: number[],
    topK: number = 10,
    filter?: import('../../../infrastructure/qdrantRepository').SearchFilterOptions,
    _scoreThreshold?: number
  ): Promise<RetrievedPoint[]> {
    const any = filter?.metadataMatch?.edge_id;
    if (!any || !('any' in any)) return [];

    const ids = any.any.filter((x): x is string => typeof x === 'string');
    const scored = ids
      .map((id) => ({ id, score: this.edgeScores.get(id) ?? 0 }))
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);

    return scored.map((x) => ({
      id: `p-${x.id}`,
      score: x.score,
      payload: {
        doc_id: 'doc-any',
        block_id: 'b-any',
        document: '',
        doc_title: 't',
        block_type: 'kg_edge',
        metadata: { edge_id: x.id },
      },
      match_type: 'semantic',
    }));
  }

  // --- 本单测不关心的接口 ---
  async getOrCreateCollection(): Promise<void> {
    throw new Error('Not implemented in FakeQdrantRepository');
  }
  async deleteCollection(): Promise<void> {
    throw new Error('Not implemented in FakeQdrantRepository');
  }
  async addPoints(): Promise<void> {
    throw new Error('Not implemented in FakeQdrantRepository');
  }
  async keywordSearch(): Promise<RetrievedPoint[]> {
    throw new Error('Not implemented in FakeQdrantRepository');
  }
  async hybridSearch(): Promise<import('../../../infrastructure/qdrantRepository').SearchResult> {
    throw new Error('Not implemented in FakeQdrantRepository');
  }
  async deletePointsByDocId(): Promise<void> {
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
  async scrollPointsPage(): Promise<{ points: Array<{ id: string; payload: Record<string, unknown> }>; nextOffset?: unknown }> {
    throw new Error('Not implemented in FakeQdrantRepository');
  }
  async collectionExists(): Promise<boolean> {
    throw new Error('Not implemented in FakeQdrantRepository');
  }
}

describe('GraphMultiHopService (Full V2 2-hop)', () => {
  it('应只输出有证据的边对应的 evidence blocks，并遵守 excludeEvidenceKeys', async () => {
    const repo = new FakeKnowledgeGraphRepository();
    const qdrant = new FakeQdrantRepository();
    qdrant.setEdgeScore('e1', 0.9);
    qdrant.setEdgeScore('e2', 0.8);

    // e1：有证据
    repo.addEdge({
      kbId: 'kb',
      id: 'e1',
      sourceEntityId: 'A',
      targetEntityId: 'B',
      relationType: 'DEPENDS_ON',
      statement: 'A depends on B',
      confidence: 0.8,
      sentiment: null,
      time: null,
      evidenceDocId: 'doc-1',
      evidenceBlockId: 'b-1',
      createdAtSeconds: 1,
      updatedAtSeconds: null,
    });

    // e2：无证据（必须被过滤）
    repo.addEdge({
      kbId: 'kb',
      id: 'e2',
      sourceEntityId: 'A',
      targetEntityId: 'C',
      relationType: 'CAUSES',
      statement: 'A causes C',
      confidence: 0.8,
      sentiment: null,
      time: null,
      evidenceDocId: null,
      evidenceBlockId: null,
      createdAtSeconds: 1,
      updatedAtSeconds: null,
    });

    const svc = new GraphMultiHopService({ repo, qdrant });
    const out = await svc.expand({
      kbId: 'kb',
      queryVector: [0.1, 0.2],
      anchorEntityIds: ['A'],
      maxHops: 2,
      beamWidth: 15,
      maxAdjEdgesPerEntity: 45,
      minSemanticScore: 0,
      hop1MinSemanticMargin: 0,
      maxEvidenceBlocksPerDoc: 0,
      excludeEvidenceKeys: new Set<string>(['doc-1|b-9']),
      maxEvidenceBlocks: 5,
    });

    expect(out.length).toBe(1);
    expect(out[0]?.docId).toBe('doc-1');
    expect(out[0]?.blockId).toBe('b-1');
  });

  it('Cross-Validate A：hop1 margin 过小应阻断 hop2，避免二跳漂移', async () => {
    const repo = new FakeKnowledgeGraphRepository();
    const qdrant = new FakeQdrantRepository();

    // hop1 两条边分数接近：margin 很小
    qdrant.setEdgeScore('e1', 0.9);
    qdrant.setEdgeScore('e2', 0.89);
    // hop2 的边如果被执行会很高，但应被 hop1 margin 阻断
    qdrant.setEdgeScore('e3', 0.95);

    repo.addEdge({
      kbId: 'kb',
      id: 'e1',
      sourceEntityId: 'A',
      targetEntityId: 'B',
      relationType: 'DEPENDS_ON',
      statement: 'A depends on B',
      confidence: 0.8,
      sentiment: null,
      time: null,
      evidenceDocId: 'doc-1',
      evidenceBlockId: 'b-1',
      createdAtSeconds: 1,
      updatedAtSeconds: null,
    });
    repo.addEdge({
      kbId: 'kb',
      id: 'e2',
      sourceEntityId: 'A',
      targetEntityId: 'C',
      relationType: 'CAUSES',
      statement: 'A causes C',
      confidence: 0.8,
      sentiment: null,
      time: null,
      evidenceDocId: 'doc-1',
      evidenceBlockId: 'b-2',
      createdAtSeconds: 1,
      updatedAtSeconds: null,
    });
    // hop2：B -> D（若执行 hop2，会带来 doc-2|b-9）
    repo.addEdge({
      kbId: 'kb',
      id: 'e3',
      sourceEntityId: 'B',
      targetEntityId: 'D',
      relationType: 'DEPENDS_ON',
      statement: 'B depends on D',
      confidence: 0.8,
      sentiment: null,
      time: null,
      evidenceDocId: 'doc-2',
      evidenceBlockId: 'b-9',
      createdAtSeconds: 1,
      updatedAtSeconds: null,
    });

    const svc = new GraphMultiHopService({ repo, qdrant });
    const out = await svc.expand({
      kbId: 'kb',
      queryVector: [0.1, 0.2],
      anchorEntityIds: ['A'],
      maxHops: 2,
      beamWidth: 2,
      maxAdjEdgesPerEntity: 45,
      minSemanticScore: 0,
      hop1MinSemanticMargin: 0.05,
      maxEvidenceBlocksPerDoc: 0,
      excludeEvidenceKeys: new Set<string>(),
      maxEvidenceBlocks: 10,
    });

    // hop2 的证据块不应出现
    const keys = new Set(out.map((x) => `${x.docId}|${x.blockId}`));
    expect(keys.has('doc-2|b-9')).toBe(false);
  });

  it('Cross-Validate B/C：同一 doc 证据限流 + evidenceKey 去重（保留最高分）', async () => {
    const repo = new FakeKnowledgeGraphRepository();
    const qdrant = new FakeQdrantRepository();
    qdrant.setEdgeScore('e1', 0.91);
    qdrant.setEdgeScore('e2', 0.9);
    qdrant.setEdgeScore('e3', 0.89);

    // 三条边都来自 doc-1，不同 block，其中 e2/e3 指向同一个 evidenceKey（去重）
    repo.addEdge({
      kbId: 'kb',
      id: 'e1',
      sourceEntityId: 'A',
      targetEntityId: 'B',
      relationType: 'DEPENDS_ON',
      statement: 'A depends on B',
      confidence: 0.8,
      sentiment: null,
      time: null,
      evidenceDocId: 'doc-1',
      evidenceBlockId: 'b-1',
      createdAtSeconds: 1,
      updatedAtSeconds: null,
    });
    repo.addEdge({
      kbId: 'kb',
      id: 'e2',
      sourceEntityId: 'A',
      targetEntityId: 'C',
      relationType: 'CAUSES',
      statement: 'A causes C',
      confidence: 0.8,
      sentiment: null,
      time: null,
      evidenceDocId: 'doc-1',
      evidenceBlockId: 'b-2',
      createdAtSeconds: 1,
      updatedAtSeconds: null,
    });
    repo.addEdge({
      kbId: 'kb',
      id: 'e3',
      sourceEntityId: 'A',
      targetEntityId: 'D',
      relationType: 'RELATED_TO',
      statement: 'A relates to D',
      confidence: 0.8,
      sentiment: null,
      time: null,
      evidenceDocId: 'doc-1',
      evidenceBlockId: 'b-2', // 与 e2 相同 evidenceKey
      createdAtSeconds: 1,
      updatedAtSeconds: null,
    });

    const svc = new GraphMultiHopService({ repo, qdrant });
    const out = await svc.expand({
      kbId: 'kb',
      queryVector: [0.1, 0.2],
      anchorEntityIds: ['A'],
      maxHops: 2,
      beamWidth: 3,
      maxAdjEdgesPerEntity: 45,
      minSemanticScore: 0,
      hop1MinSemanticMargin: 0,
      maxEvidenceBlocksPerDoc: 1, // 同一 doc 最多 1 个
      excludeEvidenceKeys: new Set<string>(),
      maxEvidenceBlocks: 10,
    });

    // 去重后 doc-1|b-2 仍只算一个；再叠加 per-doc cap=1，最终只能保留一个块
    expect(out.length).toBe(1);
    expect(out[0]?.docId).toBe('doc-1');
  });
});
