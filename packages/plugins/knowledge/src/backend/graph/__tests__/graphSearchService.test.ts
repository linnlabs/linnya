import { describe, it, expect } from 'vitest';

import type {
  KnowledgeGraphDocStatusRecord,
  KnowledgeGraphEdgeRecord,
  KnowledgeGraphEntityId,
  KnowledgeGraphNodeRecord,
  KnowledgeGraphRepository,
  KnowledgeGraphVectorDocStatusUpsertInput,
  KnowledgeGraphVectorDocStatusValue,
} from '../infrastructure/knowledgeGraphRepository';
import { GraphSearchService, buildGraphAugmentationKey } from '../application/graphSearchService';

/**
 * 说明：
 * - 该单测不依赖 better-sqlite3（避免 native ABI 问题导致测试无法跑）；
 * - 仅用内存 stub 覆盖 GraphSearchService 的核心行为：completed 与 running 预览增强。
 */
class FakeKnowledgeGraphRepository implements KnowledgeGraphRepository {
  private readonly docStatus = new Map<string, KnowledgeGraphDocStatusRecord>();
  private readonly nodes = new Map<string, KnowledgeGraphNodeRecord>();
  private readonly edges: KnowledgeGraphEdgeRecord[] = [];

  setDocStatus(input: KnowledgeGraphDocStatusRecord): void {
    this.docStatus.set(`${input.kbId}|${input.docId}`, input);
  }

  addNode(n: KnowledgeGraphNodeRecord): void {
    this.nodes.set(`${n.kbId}|${n.id}`, n);
  }

  addEdge(e: KnowledgeGraphEdgeRecord): void {
    this.edges.push(e);
  }

  async getDocStatus(kbId: string, docId: string): Promise<KnowledgeGraphDocStatusRecord | undefined> {
    return this.docStatus.get(`${kbId}|${docId}`);
  }

  async listEdgesByEvidence(kbId: string, docId: string, blockIds: string[]): Promise<KnowledgeGraphEdgeRecord[]> {
    const allow = new Set(blockIds);
    return this.edges.filter(
      (e) =>
        e.kbId === kbId &&
        e.evidenceDocId === docId &&
        typeof e.evidenceBlockId === 'string' &&
        allow.has(e.evidenceBlockId)
    );
  }

  async getNodesByIds(kbId: string, ids: KnowledgeGraphEntityId[]): Promise<KnowledgeGraphNodeRecord[]> {
    const out: KnowledgeGraphNodeRecord[] = [];
    for (const id of ids) {
      const n = this.nodes.get(`${kbId}|${id}`);
      if (n) out.push(n);
    }
    return out;
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
    if (typeof limit === 'number' && Number.isFinite(limit) && limit > 0) {
      return hits.slice(0, Math.floor(limit));
    }
    return hits;
  }

  // --- 下面的方法不是本单测关心的路径，若被调用说明测试场景设计错误 ---
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
  async tryAcquireDocExtractionLock(
    _kbId: string,
    _docId: string,
    _chunkCount: number,
    _initialDoneChunks: number
  ): Promise<boolean> {
    throw new Error('Not implemented in FakeKnowledgeGraphRepository');
  }
  async updateDocProgress(): Promise<void> {
    throw new Error('Not implemented in FakeKnowledgeGraphRepository');
  }
  async getKbProgress(): Promise<import('../infrastructure/knowledgeGraphRepository').KnowledgeGraphKbProgress> {
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
  async getVectorDocStatus(): Promise<import('../infrastructure/knowledgeGraphRepository').KnowledgeGraphVectorDocStatusRecord | undefined> {
    throw new Error('Not implemented in FakeKnowledgeGraphRepository');
  }
  async listVectorDocStatusByKb(): Promise<import('../infrastructure/knowledgeGraphRepository').KnowledgeGraphVectorDocStatusRecord[]> {
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

describe('GraphSearchService (M5 light / Chunk-Driven)', () => {
  it('completed 文档应返回图谱增强；running 且已有进度时也应允许预览增强', async () => {
    const repo = new FakeKnowledgeGraphRepository();
    repo.addNode({
      kbId: 'kb-test',
      id: 'e-a',
      name: 'Apple Inc.',
      canonicalName: 'apple-inc',
      type: 'Company',
      description: 'A company',
      sourceDocId: 'doc-1',
      sourceBlockId: 'b-1',
      createdAtSeconds: 1,
      updatedAtSeconds: null,
    });
    repo.addNode({
      kbId: 'kb-test',
      id: 'e-b',
      name: 'iPhone',
      canonicalName: 'iphone',
      type: 'Product',
      description: 'A product',
      sourceDocId: 'doc-1',
      sourceBlockId: 'b-2',
      createdAtSeconds: 1,
      updatedAtSeconds: null,
    });
    repo.addEdge({
      kbId: 'kb-test',
      id: 'edge-1',
      sourceEntityId: 'e-a',
      targetEntityId: 'e-b',
      relationType: 'RELATED_TO',
      statement: 'Apple produces iPhone.',
      confidence: 0.9,
      sentiment: null,
      time: null,
      evidenceDocId: 'doc-1',
      evidenceBlockId: 'b-2',
      createdAtSeconds: 1,
      updatedAtSeconds: null,
    });

    const service = new GraphSearchService(repo);

    repo.setDocStatus({
      kbId: 'kb-test',
      docId: 'doc-1',
      chunkCount: 10,
      doneChunks: 3,
      status: 'running',
      updatedAtSeconds: 1,
    });
    const m1 = await service.getAugmentationsForEvidenceBlocks([
      { kbId: 'kb-test', docId: 'doc-1', blockId: 'b-2' },
    ]);
    expect(m1.size).toBe(1);

    repo.setDocStatus({
      kbId: 'kb-test',
      docId: 'doc-1',
      chunkCount: 10,
      doneChunks: 10,
      status: 'completed',
      updatedAtSeconds: 2,
    });
    const m2 = await service.getAugmentationsForEvidenceBlocks([
      { kbId: 'kb-test', docId: 'doc-1', blockId: 'b-2' },
    ]);
    const key = buildGraphAugmentationKey('kb-test', 'doc-1', 'b-2');
    const aug = m2.get(key);
    expect(aug).toBeTruthy();
    expect(aug?.edges).toHaveLength(1);
    expect(aug?.entities.length).toBeGreaterThanOrEqual(2);
  });

  it('Light V2：应对块内实体做 1-hop 邻接扩展，并按 ref 标记 in_rag/external（不追加新文本）', async () => {
    const repo = new FakeKnowledgeGraphRepository();
    repo.addNode({
      kbId: 'kb-test',
      id: 'e-a',
      name: 'A',
      canonicalName: 'a',
      type: 'Concept',
      description: 'A',
      sourceDocId: 'doc-1',
      sourceBlockId: 'b-1',
      createdAtSeconds: 1,
      updatedAtSeconds: null,
    });
    repo.addNode({
      kbId: 'kb-test',
      id: 'e-b',
      name: 'B',
      canonicalName: 'b',
      type: 'Concept',
      description: 'B',
      sourceDocId: 'doc-1',
      sourceBlockId: 'b-2',
      createdAtSeconds: 1,
      updatedAtSeconds: null,
    });
    repo.addNode({
      kbId: 'kb-test',
      id: 'e-c',
      name: 'C',
      canonicalName: 'c',
      type: 'Concept',
      description: 'C',
      sourceDocId: 'doc-2',
      sourceBlockId: 'b-x',
      createdAtSeconds: 1,
      updatedAtSeconds: null,
    });

    // 块内边（证据在 b-1）
    repo.addEdge({
      kbId: 'kb-test',
      id: 'edge-in',
      sourceEntityId: 'e-a',
      targetEntityId: 'e-b',
      relationType: 'RELATED_TO',
      statement: 'A relates to B.',
      confidence: 0.9,
      sentiment: null,
      time: null,
      evidenceDocId: 'doc-1',
      evidenceBlockId: 'b-1',
      createdAtSeconds: 1,
      updatedAtSeconds: null,
    });

    // 1-hop 扩展边（证据在 b-2：属于“本次输出 blocks”，ref=in_rag）
    repo.addEdge({
      kbId: 'kb-test',
      id: 'edge-hop-inrag',
      sourceEntityId: 'e-a',
      targetEntityId: 'e-c',
      relationType: 'DEPENDS_ON',
      statement: 'A depends on C.',
      confidence: 0.8,
      sentiment: null,
      time: null,
      evidenceDocId: 'doc-1',
      evidenceBlockId: 'b-2',
      createdAtSeconds: 1,
      updatedAtSeconds: null,
    });

    // 1-hop 扩展边（证据不在“本次输出 blocks”，ref=external）
    repo.addEdge({
      kbId: 'kb-test',
      id: 'edge-hop-external',
      sourceEntityId: 'e-b',
      targetEntityId: 'e-c',
      relationType: 'CAUSES',
      statement: 'B causes C.',
      confidence: 0.7,
      sentiment: null,
      time: null,
      evidenceDocId: 'doc-2',
      evidenceBlockId: 'b-x',
      createdAtSeconds: 1,
      updatedAtSeconds: null,
    });

    repo.setDocStatus({
      kbId: 'kb-test',
      docId: 'doc-1',
      chunkCount: 2,
      doneChunks: 2,
      status: 'completed',
      updatedAtSeconds: 1,
    });

    const service = new GraphSearchService(repo);
    const m = await service.getAugmentationsForEvidenceBlocks(
      [
        { kbId: 'kb-test', docId: 'doc-1', blockId: 'b-1' },
        { kbId: 'kb-test', docId: 'doc-1', blockId: 'b-2' },
      ],
      { enableOneHopExpansion: true, maxEdgesPerEntity: 5 }
    );

    const key = buildGraphAugmentationKey('kb-test', 'doc-1', 'b-1');
    const aug = m.get(key);
    expect(aug).toBeTruthy();
    expect(aug?.edges.length).toBeGreaterThanOrEqual(2);

    const byId = new Map(aug?.edges.map((e) => [e.id, e]));
    expect(byId.get('edge-in')?.evidenceRefType).toBe('in_rag');
    expect(byId.get('edge-hop-inrag')?.evidenceRefType).toBe('in_rag');
    expect(byId.get('edge-hop-external')?.evidenceRefType).toBe('external');
  });
});


