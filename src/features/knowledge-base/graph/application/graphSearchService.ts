/**
 * @file graphSearchService.ts
 *
 * @description
 * 软知识图谱检索增强服务（Milestone 5 - Chunk-Driven / light 版）。
 *
 * 设计目标（低风险版本）：
 * - 不改变现有 RAG 的召回与排序；
 * - 只对“已召回的证据块（docId/blockId）”做图谱反查，附加实体/关系信息；
 * - 默认仅对图谱已完成的文档输出增强；
 * - 但为了便于在“抽取进行中”评估效果：当 doc_status=running 且 doneChunks>0 时，也允许对已抽取过的证据块输出增强。
 */
import type {
  KnowledgeGraphEdgeRecord,
  KnowledgeGraphNodeRecord,
  KnowledgeGraphRepository,
} from '../infrastructure/knowledgeGraphRepository';

export type GraphEvidenceRef = {
  kbId: string;
  docId: string;
  blockId: string;
};

export type GraphEntityView = Pick<
  KnowledgeGraphNodeRecord,
  'id' | 'name' | 'canonicalName' | 'type' | 'description'
>;

export type GraphEvidenceRefType = 'in_rag' | 'external';

export type GraphEdgeView = Pick<
  KnowledgeGraphEdgeRecord,
  'id' | 'sourceEntityId' | 'targetEntityId' | 'relationType' | 'statement' | 'confidence' | 'sentiment' | 'time'
> & {
  /**
   * 证据定位（严格可回溯）。
   */
  evidenceDocId: string | null;
  evidenceBlockId: string | null;
  /**
   * Light V2 的 ref 规则：
   *
   * 重要：`in_rag` 这个名字历史遗留，但业务语义已明确为“在本次工具输出中可直接阅读的证据块”。
   * - in_rag：该边的证据块也出现在本次工具输出的 blocks 列表中（因此可直接阅读原文证据）
   * - external：该边存在严格证据定位，但其证据块不在本次输出里（仅给元信息，不追加原文）
   */
  evidenceRefType: GraphEvidenceRefType;
};

export type GraphAugmentation = {
  kbId: string;
  docId: string;
  blockId: string;
  entities: GraphEntityView[];
  edges: GraphEdgeView[];
};

export function buildGraphAugmentationKey(kbId: string, docId: string, blockId: string): string {
  return `${kbId}|${docId}|${blockId}`;
}

export class GraphSearchService {
  private readonly repo: KnowledgeGraphRepository;

  constructor(repo: KnowledgeGraphRepository) {
    this.repo = repo;
  }

  /**
   * 对一批“证据块”进行图谱反查，并返回可直接按 key 命中的 map。
   */
  async getAugmentationsForEvidenceBlocks(
    refs: GraphEvidenceRef[],
    options?: {
      /**
       * 是否启用 Light V2 的 1-hop 邻接扩展。
       */
      enableOneHopExpansion?: boolean;
      /**
       * 每个实体最多扩展多少条边（业务边界）。
       */
      maxEdgesPerEntity?: number;
    }
  ): Promise<ReadonlyMap<string, GraphAugmentation>> {
    const out = new Map<string, GraphAugmentation>();
    if (!Array.isArray(refs) || refs.length === 0) return out;

    // 先按 kb/doc 分组，减少查询次数
    const byKbDoc = new Map<string, { kbId: string; docId: string; blockIds: string[] }>();
    // 用于 ref 标注：判断该边的证据块是否属于“本次会被输出（可直接阅读）”的 blocks 集合
    // 说明：refs 由上层调用方决定（可能是 RAG 主结果，也可能是 Multi-hop/Discovery 区的补漏块）。
    const inOutputEvidenceKeys = new Set<string>();
    for (const ref of refs) {
      const kbId = typeof ref.kbId === 'string' ? ref.kbId : '';
      const docId = typeof ref.docId === 'string' ? ref.docId : '';
      const blockId = typeof ref.blockId === 'string' ? ref.blockId : '';
      if (kbId.trim().length === 0 || docId.trim().length === 0 || blockId.trim().length === 0) continue;
      inOutputEvidenceKeys.add(`${docId}|${blockId}`);

      const key = `${kbId}|${docId}`;
      const existing = byKbDoc.get(key);
      if (existing) {
        existing.blockIds.push(blockId);
      } else {
        byKbDoc.set(key, { kbId, docId, blockIds: [blockId] });
      }
    }

    for (const group of byKbDoc.values()) {
      // 仅对 completed/running 文档附加图谱信息：
      // - completed：全量可用
      // - running：允许“边写边读”的最小预览（已抽取到的块才会被 evidence 反查命中）
      const status = await this.repo.getDocStatus(group.kbId, group.docId);
      if (!status) continue;
      const isCompleted =
        status.status === 'completed' &&
        (status.chunkCount === 0 || status.doneChunks >= status.chunkCount);
      const isRunningPreview = status.status === 'running' && status.doneChunks > 0;
      if (!isCompleted && !isRunningPreview) continue;

      const uniqueBlockIds = Array.from(new Set(group.blockIds));
      const edges = await this.repo.listEdgesByEvidence(group.kbId, group.docId, uniqueBlockIds);
      if (edges.length === 0) continue;

      const entityIds = new Set<string>();
      for (const e of edges) {
        if (typeof e.sourceEntityId === 'string' && e.sourceEntityId.length > 0) entityIds.add(e.sourceEntityId);
        if (typeof e.targetEntityId === 'string' && e.targetEntityId.length > 0) entityIds.add(e.targetEntityId);
      }

      const nodes = await this.repo.getNodesByIds(group.kbId, Array.from(entityIds));
      const nodeById = new Map<string, KnowledgeGraphNodeRecord>();
      for (const n of nodes) nodeById.set(n.id, n);

      // 按 evidence_block_id 回填到对应块
      const edgesByBlockId = new Map<string, KnowledgeGraphEdgeRecord[]>();
      for (const e of edges) {
        const bId = e.evidenceBlockId ?? '';
        if (typeof bId !== 'string' || bId.length === 0) continue;
        const list = edgesByBlockId.get(bId);
        if (list) list.push(e);
        else edgesByBlockId.set(bId, [e]);
      }

      for (const blockId of uniqueBlockIds) {
        const blockEdges = edgesByBlockId.get(blockId) ?? [];
        if (blockEdges.length === 0) continue;

        const blockEntityIds = new Set<string>();
        for (const e of blockEdges) {
          blockEntityIds.add(e.sourceEntityId);
          blockEntityIds.add(e.targetEntityId);
        }

        // --- Light V2：1-hop 邻接扩展（极度克制，不追加新文本） ---
        const enableOneHop = options?.enableOneHopExpansion === true;
        const maxEdgesPerEntity =
          typeof options?.maxEdgesPerEntity === 'number' && Number.isFinite(options.maxEdgesPerEntity) && options.maxEdgesPerEntity > 0
            ? Math.floor(options.maxEdgesPerEntity)
            : 0;

        // 仅输出“有证据”的边（No Evidence, No Graph）
        const hasEvidence = (e: KnowledgeGraphEdgeRecord): boolean =>
          typeof e.evidenceDocId === 'string' &&
          e.evidenceDocId.trim().length > 0 &&
          typeof e.evidenceBlockId === 'string' &&
          e.evidenceBlockId.trim().length > 0;

        const expandedEdges: KnowledgeGraphEdgeRecord[] = [];
        if (enableOneHop && maxEdgesPerEntity > 0) {
          for (const entityId of blockEntityIds) {
            const adj = await this.repo.listEdgesByEntity(group.kbId, entityId, 'both', maxEdgesPerEntity);
            for (const e of adj) {
              if (!hasEvidence(e)) continue;
              expandedEdges.push(e);
            }
          }
        }

        // 合并：blockEdges（块内证据边） + expandedEdges（邻接扩展边），按 edge.id 去重
        const mergedEdgesById = new Map<string, KnowledgeGraphEdgeRecord>();
        for (const e of blockEdges) {
          if (!hasEvidence(e)) continue;
          mergedEdgesById.set(e.id, e);
        }
        for (const e of expandedEdges) {
          if (!hasEvidence(e)) continue;
          if (!mergedEdgesById.has(e.id)) mergedEdgesById.set(e.id, e);
        }

        const mergedEdges = Array.from(mergedEdgesById.values());

        // 扩展后可能引入新实体，补齐 nodes
        const mergedEntityIds = new Set<string>();
        for (const e of mergedEdges) {
          mergedEntityIds.add(e.sourceEntityId);
          mergedEntityIds.add(e.targetEntityId);
        }
        const missingEntityIds: string[] = [];
        for (const id of mergedEntityIds) {
          if (!nodeById.has(id)) missingEntityIds.push(id);
        }
        if (missingEntityIds.length > 0) {
          const extraNodes = await this.repo.getNodesByIds(group.kbId, missingEntityIds);
          for (const n of extraNodes) nodeById.set(n.id, n);
        }

        const edgesView: GraphEdgeView[] = mergedEdges.map((e) => {
          const evDocId = typeof e.evidenceDocId === 'string' ? e.evidenceDocId : null;
          const evBlockId = typeof e.evidenceBlockId === 'string' ? e.evidenceBlockId : null;
          const refKey = evDocId && evBlockId ? `${evDocId}|${evBlockId}` : '';
          const evidenceRefType: GraphEvidenceRefType =
            refKey.length > 0 && inOutputEvidenceKeys.has(refKey) ? 'in_rag' : 'external';
          return {
            id: e.id,
            sourceEntityId: e.sourceEntityId,
            targetEntityId: e.targetEntityId,
            relationType: e.relationType,
            statement: e.statement,
            confidence: e.confidence,
            sentiment: e.sentiment,
            time: e.time,
            evidenceDocId: evDocId,
            evidenceBlockId: evBlockId,
            evidenceRefType,
          };
        });

        // Light V2：实体集合也应覆盖 mergedEdges 里的实体（避免边出现但实体缺失）
        const entities: GraphEntityView[] = [];
        for (const id of mergedEntityIds) {
          const node = nodeById.get(id);
          if (!node) continue;
          entities.push({
            id: node.id,
            name: node.name,
            canonicalName: node.canonicalName,
            type: node.type,
            description: node.description,
          });
        }

        const augmentation: GraphAugmentation = {
          kbId: group.kbId,
          docId: group.docId,
          blockId,
          entities,
          edges: edgesView,
        };

        out.set(buildGraphAugmentationKey(group.kbId, group.docId, blockId), augmentation);
      }
    }

    return out;
  }
}


