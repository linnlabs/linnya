import { describe, it, expect } from 'vitest';

import type {
  KnowledgeGraphEdgeDirection,
  KnowledgeGraphEdgeRecord,
  KnowledgeGraphNodeRecord,
  KnowledgeGraphRepository,
} from '../../infrastructure/knowledgeGraphRepository';
import { GraphConnectivityService } from '../../application/connectivity/graphConnectivityService';

class FakeGraphRepo implements KnowledgeGraphRepository {
  private readonly edges: KnowledgeGraphEdgeRecord[];
  private readonly nodes: KnowledgeGraphNodeRecord[];

  constructor(args: { edges: KnowledgeGraphEdgeRecord[]; nodes: KnowledgeGraphNodeRecord[] }) {
    this.edges = args.edges;
    this.nodes = args.nodes;
  }

  async upsertNodes(): Promise<void> {
    throw new Error('not needed');
  }
  async upsertEdges(): Promise<void> {
    throw new Error('not needed');
  }
  async getNodesByIds(_kbId: string, ids: string[]): Promise<KnowledgeGraphNodeRecord[]> {
    const set = new Set(ids);
    return this.nodes.filter((n) => set.has(n.id));
  }
  async listEdgesByEvidence(): Promise<KnowledgeGraphEdgeRecord[]> {
    throw new Error('not needed');
  }

  async listEdgesByEntity(
    kbId: string,
    entityId: string,
    direction: KnowledgeGraphEdgeDirection,
    limit?: number
  ): Promise<KnowledgeGraphEdgeRecord[]> {
    const filtered = this.edges.filter((e) => e.kbId === kbId);
    const byDir =
      direction === 'out'
        ? filtered.filter((e) => e.sourceEntityId === entityId)
        : direction === 'in'
          ? filtered.filter((e) => e.targetEntityId === entityId)
          : filtered.filter((e) => e.sourceEntityId === entityId || e.targetEntityId === entityId);
    const out = typeof limit === 'number' && limit > 0 ? byDir.slice(0, limit) : byDir;
    return out;
  }

  async listNodesBySourceDocId(): Promise<KnowledgeGraphNodeRecord[]> {
    throw new Error('not needed');
  }
  async listEdgesByEvidenceDocId(): Promise<KnowledgeGraphEdgeRecord[]> {
    throw new Error('not needed');
  }
  async upsertDocStatus(): Promise<void> {
    throw new Error('not needed');
  }
  async getDocStatus(): Promise<any> {
    throw new Error('not needed');
  }
  async tryAcquireDocExtractionLock(): Promise<boolean> {
    throw new Error('not needed');
  }
  async updateDocProgress(): Promise<void> {
    throw new Error('not needed');
  }
  async getKbProgress(): Promise<any> {
    throw new Error('not needed');
  }
  async upsertVectorDocStatus(): Promise<void> {
    throw new Error('not needed');
  }
  async getVectorDocStatus(): Promise<any> {
    throw new Error('not needed');
  }
  async updateVectorDocProgress(): Promise<void> {
    throw new Error('not needed');
  }
  async getKbVectorProgress(): Promise<any> {
    throw new Error('not needed');
  }
  async deleteDocGraphData(): Promise<void> {
    throw new Error('not needed');
  }
  async deleteKbGraphData(): Promise<void> {
    throw new Error('not needed');
  }
}

describe('GraphConnectivityService', () => {
  it('能在 2 hop 内找到路径时，应标记 direct_context 并给出路径摘要', async () => {
    const kbId = 'kb-1';

    // Apple ->(DEPENDS_ON)-> TSMC ->(CAUSES)-> WaterShortage
    const edges: KnowledgeGraphEdgeRecord[] = [
      {
        kbId,
        id: 'e1',
        sourceEntityId: 'apple',
        targetEntityId: 'tsmc',
        relationType: 'DEPENDS_ON',
        statement: 'Apple depends on TSMC',
        confidence: null,
        sentiment: null,
        time: null,
        evidenceDocId: null,
        evidenceBlockId: null,
        createdAtSeconds: 0,
        updatedAtSeconds: null,
      },
      {
        kbId,
        id: 'e2',
        sourceEntityId: 'tsmc',
        targetEntityId: 'water',
        relationType: 'CAUSES',
        statement: 'TSMC faces water shortage risk',
        confidence: null,
        sentiment: null,
        time: null,
        evidenceDocId: null,
        evidenceBlockId: null,
        createdAtSeconds: 0,
        updatedAtSeconds: null,
      },
    ];

    const nodes: KnowledgeGraphNodeRecord[] = [
      {
        kbId,
        id: 'apple',
        name: 'Apple',
        canonicalName: 'Apple',
        type: null,
        description: null,
        sourceDocId: null,
        sourceBlockId: null,
        createdAtSeconds: 0,
        updatedAtSeconds: null,
      },
      {
        kbId,
        id: 'tsmc',
        name: 'TSMC',
        canonicalName: 'TSMC',
        type: null,
        description: null,
        sourceDocId: null,
        sourceBlockId: null,
        createdAtSeconds: 0,
        updatedAtSeconds: null,
      },
      {
        kbId,
        id: 'water',
        name: '缺水',
        canonicalName: '缺水',
        type: null,
        description: null,
        sourceDocId: null,
        sourceBlockId: null,
        createdAtSeconds: 0,
        updatedAtSeconds: null,
      },
    ];

    const repo = new FakeGraphRepo({ edges, nodes });
    const svc = new GraphConnectivityService(repo);
    const out = await svc.checkConnectivity({
      kbId,
      anchorEntityIds: ['apple'],
      targetEntityIds: ['water'],
      maxHops: 2,
      maxEdgesPerEntity: 20,
    });

    expect(out.label).toBe('direct_context');
    if (out.label === 'direct_context') {
      expect(out.path).toHaveLength(2);
      expect(out.pathSummary).toContain('Apple');
      expect(out.pathSummary).toContain('TSMC');
      expect(out.pathSummary).toContain('缺水');
    }
  });

  it('找不到路径时，应标记 potential_insight', async () => {
    const kbId = 'kb-1';
    const repo = new FakeGraphRepo({
      edges: [],
      nodes: [],
    });
    const svc = new GraphConnectivityService(repo);
    const out = await svc.checkConnectivity({
      kbId,
      anchorEntityIds: ['apple'],
      targetEntityIds: ['water'],
      maxHops: 2,
      maxEdgesPerEntity: 20,
    });
    expect(out).toEqual({ label: 'potential_insight' });
  });
});

