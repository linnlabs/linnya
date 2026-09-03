/**
 * @file graphMultiHopService.ts
 *
 * @description
 * Full V2：2-hop Multi-hop 扩展（Beam Search v0）。
 *
 * 业务定义（最终拍板）：
 * - maxHops = 2
 * - beamWidth = 15
 * - relation_type_filter = none（Soft Only：靠 statement 语义相似度软选路）
 * - require_evidence = strict true（No Evidence, No Graph）
 *
 * 重要说明：
 * - 本服务不负责“读取原文块”，只产出 evidence refs（docId/blockId）与路径摘要；
 * - 搜索主链路（searchService）将这些 refs 合并进 discovery 区并读取 SoT 原文。
 */
import type { QdrantRepository } from '../../../infrastructure/qdrantRepository';
import { getGraphEdgesCollectionName } from '../../infrastructure/qdrantCollections';
import { globalGraphAdjacencyCache } from './graphAdjacencyCache';
import type {
  KnowledgeGraphEdgeRecord,
  KnowledgeGraphEntityId,
  KnowledgeGraphRepository,
} from '../../infrastructure/knowledgeGraphRepository';

export type MultiHopEvidenceBlock = {
  docId: string;
  blockId: string;
  /**
   * 用于调试/排序展示的语义分数（来自 Qdrant 的 cosine score）。
   */
  score: number;
  /**
   * 用于 observation 展示的“连通路径摘要”（可解释）。
   */
  pathSummary: string;
};

type EdgeCandidate = {
  edge: KnowledgeGraphEdgeRecord;
};

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

/**
 * 关系类型权重（业务定义）：
 * - 目标：让 RELATED_TO 作为“弱关联”不影响扩展选路的主干（避免毛线团），但仍可用于展示。
 * - 做法：仅在“选路排序”阶段做降权，不改变抽取的 6 类本体与落库数据。
 */
const RELATION_TYPE_WEIGHT: Record<string, number> = {
  RELATED_TO: 0.6,
};

function getRelationTypeWeight(relationType: string): number {
  const w = RELATION_TYPE_WEIGHT[relationType];
  return typeof w === 'number' && Number.isFinite(w) && w > 0 ? w : 1;
}

function requireEvidence(edge: KnowledgeGraphEdgeRecord): { evidenceDocId: string; evidenceBlockId: string } | null {
  if (!isNonEmptyString(edge.evidenceDocId)) return null;
  if (!isNonEmptyString(edge.evidenceBlockId)) return null;
  return { evidenceDocId: edge.evidenceDocId, evidenceBlockId: edge.evidenceBlockId };
}

function safeJoinPath(parts: string[]): string {
  return parts.filter((x) => typeof x === 'string' && x.trim().length > 0).join(' -> ');
}

export class GraphMultiHopService {
  private readonly repo: KnowledgeGraphRepository;
  private readonly qdrant: QdrantRepository;

  constructor(args: { repo: KnowledgeGraphRepository; qdrant: QdrantRepository }) {
    this.repo = args.repo;
    this.qdrant = args.qdrant;
  }

  /**
   * 从锚点实体出发做多跳扩展（V2：2-hop）。
   *
   * @param kbId 知识库
   * @param queryVector 查询意图向量（由上层统一计算，避免重复 embed）
   * @param anchorEntityIds Path A 锚点实体集合
   * @param maxHops 业务默认 2
   * @param beamWidth 业务默认 15
   * @param maxAdjEdgesPerEntity 邻接查询上限（性能边界），默认建议 >= beamWidth
   * @param minSemanticScore 软选路的最小 cosine 阈值（宁缺毋滥）
   */
  async expand(args: {
    kbId: string;
    queryVector: number[];
    anchorEntityIds: KnowledgeGraphEntityId[];
    maxHops: 2;
    beamWidth: number;
    maxAdjEdgesPerEntity: number;
    minSemanticScore: number;
    hop1MinSemanticMargin: number;
    maxEvidenceBlocksPerDoc: number;
    excludeEvidenceKeys: ReadonlySet<string>; // key = `${docId}|${blockId}`
    maxEvidenceBlocks: number;
  }): Promise<MultiHopEvidenceBlock[]> {
    const {
      kbId,
      queryVector,
      anchorEntityIds,
      maxHops,
      beamWidth,
      maxAdjEdgesPerEntity,
      minSemanticScore,
      hop1MinSemanticMargin,
      maxEvidenceBlocksPerDoc,
      excludeEvidenceKeys,
      maxEvidenceBlocks,
    } = args;

    if (kbId.trim().length === 0) return [];
    if (!Array.isArray(queryVector) || queryVector.length === 0) return [];
    if (!Array.isArray(anchorEntityIds) || anchorEntityIds.length === 0) return [];
    if (maxHops !== 2) {
      throw new Error('GraphMultiHopService.expand：当前仅支持 maxHops=2（Full V2 约束）');
    }
    if (typeof beamWidth !== 'number' || !Number.isFinite(beamWidth) || beamWidth <= 0) return [];
    if (typeof maxAdjEdgesPerEntity !== 'number' || !Number.isFinite(maxAdjEdgesPerEntity) || maxAdjEdgesPerEntity <= 0) return [];
    if (typeof minSemanticScore !== 'number' || !Number.isFinite(minSemanticScore) || minSemanticScore < 0 || minSemanticScore > 1) {
      throw new Error('GraphMultiHopService.expand：minSemanticScore 必须是 [0,1] 区间内的有限数字');
    }
    if (typeof hop1MinSemanticMargin !== 'number' || !Number.isFinite(hop1MinSemanticMargin) || hop1MinSemanticMargin < 0 || hop1MinSemanticMargin > 1) {
      throw new Error('GraphMultiHopService.expand：hop1MinSemanticMargin 必须是 [0,1] 区间内的有限数字');
    }
    if (typeof maxEvidenceBlocksPerDoc !== 'number' || !Number.isFinite(maxEvidenceBlocksPerDoc) || maxEvidenceBlocksPerDoc < 0) {
      throw new Error('GraphMultiHopService.expand：maxEvidenceBlocksPerDoc 必须是 >= 0 的有限数字');
    }
    if (typeof maxEvidenceBlocks !== 'number' || !Number.isFinite(maxEvidenceBlocks) || maxEvidenceBlocks <= 0) return [];

    const collectionName = getGraphEdgesCollectionName(kbId);
    const visitedEntities = new Set<string>(anchorEntityIds);
    const parentByEntityId = new Map<
      string,
      { prevEntityId: string; edge: KnowledgeGraphEdgeRecord }
    >();
    const selectedEdges: Array<{ edge: KnowledgeGraphEdgeRecord; score: number; hop: 1 | 2; fromEntityId: string }> = [];

    let frontier: KnowledgeGraphEntityId[] = Array.from(new Set(anchorEntityIds));

    // hop1 + hop2（固定 2-hop）
    for (const hop of [1, 2] as const) {
      // 1) 收集邻接候选边（SQLite）
      const candidates: EdgeCandidate[] = [];
      const seenEdgeIds = new Set<string>();

      for (const entityId of frontier) {
        const cached = globalGraphAdjacencyCache.get(kbId, entityId, 'both', maxAdjEdgesPerEntity);
        const adj =
          cached ??
          (await this.repo.listEdgesByEntity(kbId, entityId, 'both', maxAdjEdgesPerEntity));
        if (!cached) {
          globalGraphAdjacencyCache.set(kbId, entityId, 'both', maxAdjEdgesPerEntity, adj);
        }
        for (const e of adj) {
          if (!requireEvidence(e)) continue; // strict evidence
          if (seenEdgeIds.has(e.id)) continue;
          seenEdgeIds.add(e.id);
          candidates.push({ edge: e });
        }
      }

      if (candidates.length === 0) break;

      // 2) 在候选 edge_id 集合内做语义打分（Qdrant）
      const candidateEdgeIds = candidates.map((c) => c.edge.id);
      const scored = await this.qdrant.semanticSearch(
        collectionName,
        queryVector,
        Math.min(beamWidth, candidateEdgeIds.length),
        {
          blockTypes: ['kg_edge'],
          metadataMatch: {
            edge_id: { any: candidateEdgeIds },
          },
        },
        minSemanticScore
      );

      if (scored.length === 0) break;

      // --- Cross-Validate A：hop1 语义 margin（抑制二跳漂移） ---
      // 说明：
      // - 当 hop1 选出来的候选边“区分度太低”，继续扩展第二跳往往会漂移；
      // - 因此当 margin < hop1MinSemanticMargin 时：允许输出 hop1 的证据，但不再执行 hop2。
      let stopAfterThisHop = false;
      // 注意：margin 用“加权后分数”（RELATED_TO 降权后更符合“可区分度”直觉）
      const edgeByIdForWeight = new Map<string, KnowledgeGraphEdgeRecord>();
      for (const c of candidates) edgeByIdForWeight.set(c.edge.id, c.edge);
      const scoredWithWeight = scored
        .map((p) => {
          const md = p.payload?.metadata;
          const edgeId = typeof md === 'object' && md !== null ? (md as Record<string, unknown>)['edge_id'] : undefined;
          const edgeIdStr = isNonEmptyString(edgeId) ? edgeId : '';
          const edge = edgeIdStr.length > 0 ? edgeByIdForWeight.get(edgeIdStr) : undefined;
          const raw = typeof p.score === 'number' && Number.isFinite(p.score) ? p.score : 0;
          const weight = edge ? getRelationTypeWeight(edge.relationType) : 1;
          return { point: p, rawScore: raw, weightedScore: raw * weight };
        })
        .sort((a, b) => b.weightedScore - a.weightedScore);

      if (hop === 1 && hop1MinSemanticMargin > 0 && scoredWithWeight.length >= 2) {
        const top = scoredWithWeight[0]?.weightedScore ?? 0;
        const last = scoredWithWeight[scoredWithWeight.length - 1]?.weightedScore ?? 0;
        const margin = top - last;
        if (margin < hop1MinSemanticMargin) {
          stopAfterThisHop = true;
        }
      }

      // 3) 选中 beamWidth 条边，并更新下一跳 frontier
      const edgeById = new Map<string, KnowledgeGraphEdgeRecord>();
      for (const c of candidates) edgeById.set(c.edge.id, c.edge);

      const nextFrontierSet = new Set<string>();
      // 说明：用“加权排序”做选路（RELATED_TO 降权）
      for (const item of scoredWithWeight) {
        const p = item.point;
        const md = p.payload?.metadata;
        const edgeId = typeof md === 'object' && md !== null ? (md as Record<string, unknown>)['edge_id'] : undefined;
        const edgeIdStr = isNonEmptyString(edgeId) ? edgeId : '';
        if (edgeIdStr.length === 0) continue;

        const edge = edgeById.get(edgeIdStr);
        if (!edge) continue;

        // 选择一个“fromEntityId”（尽量取已访问集合中的端点），并确定 newEntityId（用于 parent 链路）
        const fromEntityId = visitedEntities.has(edge.sourceEntityId)
          ? edge.sourceEntityId
          : visitedEntities.has(edge.targetEntityId)
            ? edge.targetEntityId
            : frontier[0]!;
        const newEntityId =
          fromEntityId === edge.sourceEntityId ? edge.targetEntityId : edge.sourceEntityId;

        selectedEdges.push({
          edge,
          score: item.weightedScore,
          hop,
          fromEntityId,
        });

        // 下一跳扩展实体：取边的两端中“尚未访问”的
        if (!visitedEntities.has(newEntityId)) {
          nextFrontierSet.add(newEntityId);
          // 记录 parent 链路（用于 2-hop 路径摘要）；已存在则保留先到达的路径（更短/更稳定）
          if (!parentByEntityId.has(newEntityId)) {
            parentByEntityId.set(newEntityId, { prevEntityId: fromEntityId, edge });
          }
        }
      }

      for (const id of nextFrontierSet) visitedEntities.add(id);
      frontier = stopAfterThisHop ? [] : Array.from(nextFrontierSet);

      if (frontier.length === 0) break;
    }

    // 4) 从选中边回溯到 evidence blocks，生成 discovery 区要展示的“新证据块”
    const bestByEvidenceKey = new Map<string, MultiHopEvidenceBlock>();
    const usedEvidence = new Set<string>(); // 保留，但最终以 bestByEvidenceKey 为准（可读性）
    const perDocCount = new Map<string, number>();

    for (const sel of selectedEdges) {
      const ev = requireEvidence(sel.edge);
      if (!ev) continue;
      const key = `${ev.evidenceDocId}|${ev.evidenceBlockId}`;
      if (excludeEvidenceKeys.has(key)) continue;

      // 尝试从 sel.fromEntityId 回溯到锚点，拼出可解释的 1~2 hop 路径
      const chain: string[] = [];
      const toEntityId =
        sel.edge.sourceEntityId === sel.fromEntityId ? sel.edge.targetEntityId : sel.edge.sourceEntityId;
      // 从 toEntityId 往回走 parent 链
      const reverseParts: string[] = [toEntityId];
      let cursor = toEntityId;
      let guard = 0;
      while (guard < 4) {
        guard += 1;
        const parent = parentByEntityId.get(cursor);
        if (!parent) break;
        reverseParts.push(`(${parent.edge.relationType})`);
        reverseParts.push(parent.prevEntityId);
        cursor = parent.prevEntityId;
      }
      reverseParts.reverse();
      for (const p of reverseParts) chain.push(p);
      // 如果链路为空，退化为“当前边”
      const pathSummary =
        chain.length > 0
          ? safeJoinPath(chain)
          : safeJoinPath([sel.fromEntityId, `(${sel.edge.relationType})`, toEntityId]);

      const candidate: MultiHopEvidenceBlock = {
        docId: ev.evidenceDocId,
        blockId: ev.evidenceBlockId,
        score: sel.score,
        pathSummary,
      };

      // --- Cross-Validate C：按 evidenceKey 去重（保留最高分） ---
      const existing = bestByEvidenceKey.get(key);
      if (!existing || candidate.score > existing.score) {
        bestByEvidenceKey.set(key, candidate);
      }
      usedEvidence.add(key);
    }

    // --- Cross-Validate B：单 doc 证据限流 ---
    const sorted = Array.from(bestByEvidenceKey.values()).sort((a, b) => b.score - a.score);
    const out: MultiHopEvidenceBlock[] = [];
    for (const r of sorted) {
      const docCount = perDocCount.get(r.docId) ?? 0;
      if (maxEvidenceBlocksPerDoc > 0 && docCount >= maxEvidenceBlocksPerDoc) continue;
      perDocCount.set(r.docId, docCount + 1);
      out.push(r);
      if (out.length >= maxEvidenceBlocks) break;
    }

    return out;
  }
}

