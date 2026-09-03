/**
 * @file src/tools/knowledgebase/search/deep/buildGraphDigest.ts
 *
 * @description
 * 为 deep_search 的最终 selected blocks 构建“轻量级图谱摘要（graph_digest）”，回传给上层 AI。
 *
 * 重要约束：
 * - 不透出 full graph（太大）；只给计数 + TopN 关键实体/关键边；
 * - 结构化输出：禁止解析 observation 文本（不稳定、不可维护）；
 * - 只读反查：不改变检索召回/排序（根因一致）。
 */

import type { ToolContext } from '../../../types';
import type { KnowledgeSearchDocument, KnowledgeGraphDigest } from '../types';
import { sliceTextByUnitsZhEn } from '../../../../shared/utils/textUnits';

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

function toNonNegativeInt(v: number): number {
  if (!Number.isFinite(v)) return 0;
  if (v <= 0) return 0;
  return Math.floor(v);
}

type GraphEntity = {
  id: string;
  name: string;
  canonicalName?: string;
  type?: string;
};

type GraphEdge = {
  sourceEntityId: string;
  targetEntityId: string;
  relationType: string;
  statement?: string;
  confidence?: number;
  evidenceRefType?: 'in_rag' | 'external';
};

/**
 * 计算“关键实体”的简单启发式：按边的出现次数（度）排序。
 * - 不引入模型，不做推测性语义；只基于已有结构信息做确定性排序。
 */
function pickTopEntities(args: {
  entities: GraphEntity[];
  edges: GraphEdge[];
  max: number;
}): GraphEntity[] {
  const max = toNonNegativeInt(args.max);
  if (max === 0) return [];
  if (args.entities.length === 0) return [];

  const degree = new Map<string, number>();
  for (const e of args.edges) {
    degree.set(e.sourceEntityId, (degree.get(e.sourceEntityId) ?? 0) + 1);
    degree.set(e.targetEntityId, (degree.get(e.targetEntityId) ?? 0) + 1);
  }

  const score = (id: string): number => degree.get(id) ?? 0;

  const sorted = [...args.entities].sort((a, b) => {
    const da = score(a.id);
    const db = score(b.id);
    if (db !== da) return db - da;
    // 次级：canonicalName/name 字典序，保证稳定
    const an = (a.canonicalName ?? a.name ?? '').toLowerCase();
    const bn = (b.canonicalName ?? b.name ?? '').toLowerCase();
    if (an < bn) return -1;
    if (an > bn) return 1;
    return 0;
  });

  return sorted.slice(0, max);
}

/**
 * 计算“关键边”的简单启发式：
 * - 优先 in_rag（可直接阅读证据）
 * - 再按 confidence（若有）
 * - 再优先有 statement（可解释）
 */
function pickTopEdges(args: { edges: GraphEdge[]; max: number }): GraphEdge[] {
  const max = toNonNegativeInt(args.max);
  if (max === 0) return [];
  if (args.edges.length === 0) return [];

  const sorted = [...args.edges].sort((a, b) => {
    const ar = a.evidenceRefType === 'in_rag' ? 1 : 0;
    const br = b.evidenceRefType === 'in_rag' ? 1 : 0;
    if (br !== ar) return br - ar;

    const ac =
      typeof a.confidence === 'number' && Number.isFinite(a.confidence) ? a.confidence : -1;
    const bc =
      typeof b.confidence === 'number' && Number.isFinite(b.confidence) ? b.confidence : -1;
    if (bc !== ac) return bc - ac;

    const as = isNonEmptyString(a.statement) ? 1 : 0;
    const bs = isNonEmptyString(b.statement) ? 1 : 0;
    if (bs !== as) return bs - as;

    // 最后保证稳定
    const ak = `${a.relationType}|${a.sourceEntityId}|${a.targetEntityId}`;
    const bk = `${b.relationType}|${b.sourceEntityId}|${b.targetEntityId}`;
    if (ak < bk) return -1;
    if (ak > bk) return 1;
    return 0;
  });

  return sorted.slice(0, max);
}

export async function buildGraphDigestForSelectedBlocks(params: {
  context: ToolContext;
  documents: KnowledgeSearchDocument[];
  /**
   * TopN 截断：默认 5/5，保持轻量。
   */
  maxEntitiesPerBlock?: number;
  maxEdgesPerBlock?: number;
}): Promise<KnowledgeGraphDigest> {
  const { context, documents } = params;
  const maxEntitiesPerBlock = toNonNegativeInt(params.maxEntitiesPerBlock ?? 5);
  const maxEdgesPerBlock = toNonNegativeInt(params.maxEdgesPerBlock ?? 5);

  const service = context.knowledgeBaseService;
  if (!service) {
    throw new Error('[buildGraphDigestForSelectedBlocks] 缺少 context.knowledgeBaseService');
  }

  // 1) doc_id -> kbId（避免重复查元数据）
  const docIdToKbId = new Map<string, string>();
  for (const d of documents) {
    if (!isNonEmptyString(d.doc_id)) continue;
    if (docIdToKbId.has(d.doc_id)) continue;
    const meta = await service.getDocumentById(d.doc_id);
    const kbId = meta?.kbId;
    if (isNonEmptyString(kbId)) {
      docIdToKbId.set(d.doc_id, kbId);
    }
  }

  // 2) 构造 refs（只对“能定位到 kbId 的块”做图谱反查）
  const refs: Array<{ kbId: string; docId: string; blockId: string }> = [];
  for (const d of documents) {
    const kbId = docIdToKbId.get(d.doc_id);
    if (!isNonEmptyString(kbId)) continue;
    if (!isNonEmptyString(d.block_id)) continue;
    refs.push({ kbId, docId: d.doc_id, blockId: d.block_id });
  }

  // 3) 批量反查 augmentation
  //    ✅ 默认不开 1-hop 扩展：digest 只做“解释性摘要”，避免体积膨胀。
  const augMap = await service.getGraphAugmentationsForEvidenceBlocks(refs, {
    enableOneHopExpansion: false,
  });

  const blocks: KnowledgeGraphDigest['blocks'] = [];
  const uniqueEntityIds = new Set<string>();

  let blocksWithGraph = 0;
  let entitiesSum = 0;
  let edgesSum = 0;

  const keyOf = (kbId: string, docId: string, blockId: string): string =>
    `${kbId}|${docId}|${blockId}`;

  for (const d of documents) {
    const kbId = docIdToKbId.get(d.doc_id) ?? '';
    const k = isNonEmptyString(kbId) ? keyOf(kbId, d.doc_id, d.block_id) : '';
    const aug = k && augMap.has(k) ? augMap.get(k) : undefined;

    const entities: GraphEntity[] = aug
      ? aug.entities.map(e => ({
          id: e.id,
          name: e.name,
          canonicalName: e.canonicalName,
          // 统一为可选字段：GraphEntity.type 不接受 null
          type: isNonEmptyString(e.type) ? e.type : undefined,
        }))
      : [];

    const edges: GraphEdge[] = aug
      ? aug.edges.map(e => ({
          sourceEntityId: e.sourceEntityId,
          targetEntityId: e.targetEntityId,
          relationType: e.relationType,
          // GraphEdge.statement/confidence 不接受 null
          statement: isNonEmptyString(e.statement) ? e.statement : undefined,
          confidence:
            typeof e.confidence === 'number' && Number.isFinite(e.confidence)
              ? e.confidence
              : undefined,
          evidenceRefType: e.evidenceRefType,
        }))
      : [];

    const entityCount = entities.length;
    const edgeCount = edges.length;

    if (entityCount > 0 || edgeCount > 0) {
      blocksWithGraph += 1;
      entitiesSum += entityCount;
      edgesSum += edgeCount;
      for (const e of entities) uniqueEntityIds.add(e.id);
    }

    const topEntities = pickTopEntities({ entities, edges, max: maxEntitiesPerBlock });
    const topEdges = pickTopEdges({ edges, max: maxEdgesPerBlock });

    blocks.push({
      doc_id: d.doc_id,
      block_id: d.block_id,
      graph_available: entityCount > 0 || edgeCount > 0,
      entity_count: entityCount,
      edge_count: edgeCount,
      top_entities: topEntities.map(e => ({
        id: e.id,
        name: e.name,
        ...(isNonEmptyString(e.canonicalName) ? { canonical_name: e.canonicalName } : {}),
        ...(isNonEmptyString(e.type) ? { type: e.type } : {}),
      })),
      top_edges: topEdges.map(e => ({
        relation_type: e.relationType,
        source_entity_id: e.sourceEntityId,
        target_entity_id: e.targetEntityId,
        ...(isNonEmptyString(e.statement)
          ? { statement: sliceTextByUnitsZhEn(e.statement, 60) }
          : {}),
        ...(e.evidenceRefType ? { evidence_ref_type: e.evidenceRefType } : {}),
      })),
    });
  }

  return {
    blocks,
    totals: {
      selected_blocks: documents.length,
      blocks_with_graph: blocksWithGraph,
      entities_sum: entitiesSum,
      edges_sum: edgesSum,
      unique_entities: uniqueEntityIds.size,
    },
  };
}
