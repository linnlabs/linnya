/**
 * @file graphNodeAnchorService.ts
 *
 * @description
 * Full V3：Entity-Driven Anchor（不触发 LLM）。
 *
 * 设计要点（Soft Graph 精髓）：
 * - **Vector-Native**：不追求“精确实体抽取/实体链接”，而是用 queryVector 直接在 `kg_nodes_${kbId}` 做语义召回；
 * - **低开销**：复用 searchService 已计算好的 queryVector，不额外调用 AI；
 * - **可控**：topK 很小（默认 3），并有 cosine 阈值过滤，避免锚点噪音导致多跳漂移。
 */
import type { QdrantRepository } from '../../../infrastructure/qdrantRepository';
import { getGraphNodesCollectionName } from '../../infrastructure/qdrantCollections';

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

/**
 * 说明：kg_nodes 的 node_id 写在 payload.metadata.node_id（见 graph-indexing.worker.ts）。
 */
function readNodeIdFromPayloadMetadata(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null;
  const rec = metadata as Record<string, unknown>;
  const nodeId = rec['node_id'];
  return isNonEmptyString(nodeId) ? nodeId : null;
}

export class GraphNodeAnchorService {
  private readonly qdrant: QdrantRepository;

  constructor(qdrant: QdrantRepository) {
    this.qdrant = qdrant;
  }

  async getAnchorEntityIds(args: {
    kbId: string;
    queryVector: number[];
    topK: number;
    minSemanticScore: number;
    excludeEntityIds?: ReadonlySet<string>;
  }): Promise<string[]> {
    const { kbId, queryVector, topK, minSemanticScore, excludeEntityIds } = args;
    if (!isNonEmptyString(kbId)) return [];
    if (!Array.isArray(queryVector) || queryVector.length === 0) return [];
    if (typeof topK !== 'number' || !Number.isFinite(topK) || topK <= 0) return [];
    if (typeof minSemanticScore !== 'number' || !Number.isFinite(minSemanticScore) || minSemanticScore < 0 || minSemanticScore > 1) {
      throw new Error('GraphNodeAnchorService.getAnchorEntityIds：minSemanticScore 必须是 [0,1] 区间内的有限数字');
    }

    const collectionName = getGraphNodesCollectionName(kbId);
    const points = await this.qdrant.semanticSearch(
      collectionName,
      queryVector,
      Math.floor(topK),
      { blockTypes: ['kg_node'] },
      minSemanticScore
    );

    const out: string[] = [];
    const used = new Set<string>();
    for (const p of points) {
      const nodeId = readNodeIdFromPayloadMetadata(p.payload?.metadata);
      if (!nodeId) continue;
      if (excludeEntityIds && excludeEntityIds.has(nodeId)) continue;
      if (used.has(nodeId)) continue;
      used.add(nodeId);
      out.push(nodeId);
      if (out.length >= topK) break;
    }
    return out;
  }
}

