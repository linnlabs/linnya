/**
 * @file src/features/knowledge-base/application/search/graphEnhancedAgentSearch.ts
 *
 * @brief Graph Enhanced Agent Search：只负责“在 Agent 格式化输出里追加软图谱信息”（高内聚）。
 *
 * 约束：
 * - 不改变 RAG 的召回与排序；
 * - light：只做“命中证据块反查 + 1-hop 克制扩展”，不追加新文本；
 * - full：在此基础上追加 Discovery/Multi-hop 的“新证据块”（只用于 formatter 展示）。
 */

import type { EmbeddingPort } from 'src/domains/model-inference';
import type { QdrantRepository } from '../../infrastructure/qdrantRepository';
import type { MetadataRepository } from '../../infrastructure/metadataRepository';
import type { SotRepository } from '../../infrastructure/sotRepository';
import type { KnowledgeGraphRepository } from '../../graph/infrastructure/knowledgeGraphRepository';
import type { KnowledgeBaseGraphSearchOptions } from '../knowledgeBaseService';
import {
  DEFAULT_FULL_GRAPH_BUDGET,
  DEFAULT_LIGHT_GRAPH_BUDGET,
} from '../../graph/application/graphBudget';
import type { GraphBudget, GraphMode } from '../../graph/application/graphBudget';
import {
  GraphSearchService,
  type GraphAugmentation,
} from '../../graph/application/graphSearchService';
import {
  GraphDiscoveryService,
  type GraphDiscoveredEvidenceBlock,
} from '../../graph/application/graphDiscoveryService';
import {
  GraphResultMerger,
  type DiscoveryResultWithKey,
} from '../../graph/application/merger/graphResultMerger';
import { GraphConnectivityService } from '../../graph/application/connectivity/graphConnectivityService';
import { GraphMultiHopService } from '../../graph/application/traversal/graphMultiHopService';
import { GraphNodeAnchorService } from '../../graph/application/anchor/graphNodeAnchorService';
import { formatSearchResultsForLLM } from '../../utils/searchUtils';
import {
  allocateAgentKnowledgeSearchEvidence,
  type AgentKnowledgeSearchHit,
  type AgentKnowledgeSearchOutput,
} from './agentSearchOutput';
import type { CitationRefAllocatorPort } from '../../../../domains/citation';

function readSoTBlockText(sot: unknown, blockId: string): string | null {
  if (!sot || typeof sot !== 'object') return null;
  const r = sot as Record<string, unknown>;
  const blocks = r['content_blocks'];
  if (!blocks || typeof blocks !== 'object' || Array.isArray(blocks)) return null;
  const map = blocks as Record<string, unknown>;
  const b = map[blockId];
  if (!b || typeof b !== 'object' || Array.isArray(b)) return null;
  const br = b as Record<string, unknown>;
  const text = br['text'];
  if (typeof text !== 'string') return null;
  const s = text.trim();
  return s.length > 0 ? s : null;
}

function buildAugKey(kbId: string, docId: string, blockId: string): string {
  return `${kbId}|${docId}|${blockId}`;
}

/**
 * 生成 Graph Enhanced 的 Agent 输出（包含主结果 + 可选的 discovery section）。
 */
export async function buildAgentSearchOutputWithGraph(args: {
  kbId: string;
  query: string;
  topK: number;
  docId?: string;
  citationOffset: number;
  graph?: KnowledgeBaseGraphSearchOptions;
  embeddingModelId: string;
  queryVector: number[];
  ragResults: Array<Record<string, unknown>>;
  citationRefAllocator: CitationRefAllocatorPort;
  qdrantRepository: QdrantRepository;
  metadataRepository: MetadataRepository;
  sotRepository: SotRepository;
  embedding: EmbeddingPort;
  knowledgeGraphRepository: KnowledgeGraphRepository;
}): Promise<AgentKnowledgeSearchOutput> {
  const {
    kbId,
    query,
    topK,
    docId,
    citationOffset,
    graph,
    embeddingModelId,
    queryVector,
    ragResults,
    citationRefAllocator,
    qdrantRepository,
    metadataRepository,
    sotRepository,
    embedding,
    knowledgeGraphRepository,
  } = args;
  const admittedRag = await allocateAgentKnowledgeSearchEvidence(ragResults, citationRefAllocator);

  // graph 参数是“业务策略”层注入的（模型无权选择），这里仅消费其确定性结果
  const graphMode: GraphMode = graph?.mode ?? 'light';
  const graphBudget: GraphBudget =
    graph?.budget ??
    (graphMode === 'full' ? DEFAULT_FULL_GRAPH_BUDGET : DEFAULT_LIGHT_GRAPH_BUDGET);
  // 单文档搜索的 scope 是硬约束。Discovery/Multi-hop 会跨文档扩展，只能在全库模式启用。
  const maxDiscoveredBlocks = docId ? 0 : graphBudget.maxDiscoveredBlocks;

  // M5：按证据块反查图谱（refs 来自 RAG 命中）
  const refs: Array<{ kbId: string; docId: string; blockId: string }> = [];
  const excludeEvidenceKeys = new Set<string>();
  for (const r of ragResults) {
    const docIdRaw = r['doc_id'];
    const blockIdRaw = r['block_id'];
    const d = typeof docIdRaw === 'string' ? docIdRaw : '';
    const b = typeof blockIdRaw === 'string' ? blockIdRaw : '';
    if (d.trim().length === 0 || b.trim().length === 0) continue;
    refs.push({ kbId, docId: d, blockId: b });
    excludeEvidenceKeys.add(buildAugKey(kbId, d, b));
  }

  const graphSearchService = new GraphSearchService(knowledgeGraphRepository);

  // ✅ Light V2：对 RAG 命中块做 1-hop 邻接扩展（极度克制，不追加新文本）
  const augmentations = await graphSearchService.getAugmentationsForEvidenceBlocks(refs, {
    enableOneHopExpansion: true,
    maxEdgesPerEntity: 5,
  });

  // 统一的 augmentation 容器：Path A + Multi-hop + Discovery（最终用于 formatter 输出）
  let mergedAugmentations = new Map<string, GraphAugmentation>(augmentations);

  /**
   * Path A（Chunk-Driven）的“锚点实体集合”：
   * - 用于 Discovery（Path B）孤岛检测的回溯连通性检查；
   * - 不改变 RAG 的召回与排序，仅用于“解释与降级标签”。
   */
  const anchorEntityIds = new Set<string>();
  for (const aug of augmentations.values()) {
    for (const ent of aug.entities) {
      if (typeof ent.id === 'string' && ent.id.trim().length > 0) anchorEntityIds.add(ent.id);
    }
  }
  const connectivityService = new GraphConnectivityService(knowledgeGraphRepository);

  // --- M5 full：软图谱补漏召回（kg_edges 向量检索） ---
  let discoverySection = '';
  const additionalHits: AgentKnowledgeSearchHit[] = [];
  if (maxDiscoveredBlocks > 0 && embeddingModelId.trim().length > 0) {
    // --- Full V3：Entity-Driven Anchor（不触发 LLM，复用 queryVector） ---
    if (graphBudget.maxEntityAnchors > 0) {
      const nodeAnchorService = new GraphNodeAnchorService(qdrantRepository);
      const extraAnchors = await nodeAnchorService.getAnchorEntityIds({
        kbId,
        queryVector,
        topK: graphBudget.maxEntityAnchors,
        minSemanticScore: graphBudget.minEntityAnchorSemanticScore,
        excludeEntityIds: anchorEntityIds,
      });
      for (const id of extraAnchors) {
        if (typeof id === 'string' && id.trim().length > 0) anchorEntityIds.add(id);
      }
    }

    // excludeKeys 这里用 docId|blockId 形式传递给 discoveryService（它内部按该 key 去重）
    const excludeKeysForDiscovery = new Set<string>();
    for (const k of excludeEvidenceKeys) {
      const parts = k.split('|');
      if (parts.length === 3) excludeKeysForDiscovery.add(`${parts[1]}|${parts[2]}`);
    }

    /**
     * --- Full V2：2-hop Multi-hop（Beam Search v0）优先执行 ---
     * - 实施方案 B：先跑 Multi-hop 吃满 Discovery 预算，剩余名额给 Path B 补漏；
     * - 理由：Multi-hop 基于 Path A 锚点且有路径摘要，可解释性与抗漂移能力优于纯向量 Discovery。
     */
    const multiHopResults: Array<Record<string, unknown>> = [];
    const multiHopKeys = new Set<string>(); // key = docId|blockId

    if (maxDiscoveredBlocks > 0 && anchorEntityIds.size > 0) {
      const multiHop = new GraphMultiHopService({
        repo: knowledgeGraphRepository,
        qdrant: qdrantRepository,
      });

      // Multi-hop 的排除集合：仅包含 Path A 已命中的块
      const excludeForMultiHop = new Set<string>(excludeKeysForDiscovery);

      const multiHopBlocks = await multiHop.expand({
        kbId,
        queryVector,
        anchorEntityIds: Array.from(anchorEntityIds),
        maxHops: 2,
        beamWidth: 15,
        maxAdjEdgesPerEntity: 45,
        minSemanticScore: graphBudget.minDiscoverySemanticScore,
        hop1MinSemanticMargin: graphBudget.hop1MinSemanticMargin,
        maxEvidenceBlocksPerDoc: graphBudget.maxEvidenceBlocksPerDoc,
        excludeEvidenceKeys: excludeForMultiHop,
        maxEvidenceBlocks: maxDiscoveredBlocks, // 优先吃满
      });

      if (multiHopBlocks.length > 0) {
        const multiHopRefs = multiHopBlocks.map(b => ({
          kbId,
          docId: b.docId,
          blockId: b.blockId,
        }));
        const multiHopAugMap = await graphSearchService.getAugmentationsForEvidenceBlocks(
          multiHopRefs,
          {
            enableOneHopExpansion: false,
          }
        );

        // 立即将 Multi-hop augmentation 合并进 mergedAugmentations（供后续 formatter 使用）
        for (const [k, v] of multiHopAugMap.entries()) {
          if (!mergedAugmentations.has(k)) mergedAugmentations.set(k, v);
        }

        for (const b of multiHopBlocks) {
          const docMeta = await metadataRepository.getDocumentById(b.docId);
          const sot = await sotRepository.get(b.docId);
          const hit = readSoTBlockText(sot, b.blockId);
          if (!hit) continue;

          multiHopResults.push({
            doc_id: b.docId,
            block_id: b.blockId,
            doc_title: typeof docMeta?.filename === 'string' ? docMeta.filename : b.docId,
            block_type: 'graph_discovery',
            document: hit,
            match_type: 'semantic',
            final_match_type: 'semantic',
            _graph_discovery_score: b.score,
            _graph_discovery_label: 'direct_context',
            _graph_discovery_path_summary: b.pathSummary,
          });
          multiHopKeys.add(`${b.docId}|${b.blockId}`);
        }
      }
    }

    // --- Discovery (Path B)：补漏 ---
    // 预算 = 总预算 - Multi-hop 已占用
    const remainingForDiscovery = Math.max(0, maxDiscoveredBlocks - multiHopResults.length);
    let discoveredBlocks: GraphDiscoveredEvidenceBlock[] = [];

    if (remainingForDiscovery > 0) {
      // Discovery 排除集合 = Path A + Multi-hop 结果
      const excludeForDiscovery = new Set<string>(excludeKeysForDiscovery);
      for (const k of multiHopKeys) excludeForDiscovery.add(k);

      const discovery = new GraphDiscoveryService(qdrantRepository, embedding);
      discoveredBlocks = await discovery.discoverEvidenceBlocksByQuery({
        kbId,
        query,
        embeddingModelId,
        queryVector,
        topKEdges: Math.max(10, remainingForDiscovery * 6),
        maxBlocks: remainingForDiscovery,
        excludeKeys: excludeForDiscovery,
        minSemanticScore: graphBudget.minDiscoverySemanticScore,
      });
    }

    if (discoveredBlocks.length > 0) {
      const discoveryRefs = discoveredBlocks.map(x => ({
        kbId,
        docId: x.docId,
        blockId: x.blockId,
      }));
      // Discovery 结果用于展示其“块内图谱”（不做 1-hop 扩展，避免扩大 light 的语义边界）
      const discoveryAugMap = await graphSearchService.getAugmentationsForEvidenceBlocks(
        discoveryRefs,
        {
          enableOneHopExpansion: false,
        }
      );

      // 构造 DiscoveryResultWithKey 列表供 Merger 使用
      const discoveryResultsForMerger: DiscoveryResultWithKey[] = [];
      for (const x of discoveredBlocks) {
        const key = buildAugKey(kbId, x.docId, x.blockId);
        const aug = discoveryAugMap.get(key);
        if (aug) {
          discoveryResultsForMerger.push({
            augmentation: aug,
            docId: x.docId,
            blockId: x.blockId,
            score: x.score,
            key,
          });
        }
      }

      // 执行合并与去重（针对 Discovery 结果）
      const merger = new GraphResultMerger();
      const mergeOutput = merger.mergeWithKeys({
        chunkDrivenResults: mergedAugmentations,
        discoveryResults: discoveryResultsForMerger,
        minScoreThreshold: 0,
      });

      // 更新 mergedAugmentations（追加了 Discovery 的 augmentation）
      mergedAugmentations = mergeOutput.mergedResults;

      // 构造“伪搜索结果”（只用于 formatter 输出），命中文本来自 SoT 原文块
      // 这里只展示 merge 后真正被采纳的 Discovery 结果
      const discoveryResults: Array<Record<string, unknown>> = [];
      // 先放入 Multi-hop 结果（优先展示）
      for (const r of multiHopResults) discoveryResults.push(r);

      for (const x of discoveredBlocks) {
        const key = buildAugKey(kbId, x.docId, x.blockId);
        const isMultiHop = multiHopKeys.has(`${x.docId}|${x.blockId}`);
        // 只有当 merger 保留了该 key，且该 key 不是 Path A 也不是 Multi-hop 的结果时，才视为有效的 Discovery 补漏
        if (mergedAugmentations.has(key) && !augmentations.has(key) && !isMultiHop) {
          const docMeta = await metadataRepository.getDocumentById(x.docId);
          const sot = await sotRepository.get(x.docId);
          const hit = readSoTBlockText(sot, x.blockId);
          if (!hit) continue;

          // --- Island Detection：回溯连通性检查（限定 hop 的最短路） ---
          let discoveryLabel: 'direct_context' | 'potential_insight' = 'potential_insight';
          let pathSummary: string | null = null;
          const aug = mergedAugmentations.get(key);
          if (aug && anchorEntityIds.size > 0) {
            const targetIds = aug.entities.map(e => e.id);
            const conn = await connectivityService.checkConnectivity({
              kbId,
              anchorEntityIds: Array.from(anchorEntityIds),
              targetEntityIds: targetIds,
              maxHops: 2,
              maxEdgesPerEntity: 30,
            });
            discoveryLabel = conn.label;
            if (conn.label === 'direct_context') pathSummary = conn.pathSummary;
          }

          discoveryResults.push({
            doc_id: x.docId,
            block_id: x.blockId,
            doc_title: typeof docMeta?.filename === 'string' ? docMeta.filename : x.docId,
            block_type: 'graph_discovery',
            document: hit,
            match_type: 'semantic',
            final_match_type: 'semantic',
            _graph_discovery_score: x.score,
            _graph_discovery_label: discoveryLabel,
            _graph_discovery_path_summary: pathSummary,
          });
        }
      }

      if (discoveryResults.length > 0) {
        const admittedDiscovery = await allocateAgentKnowledgeSearchEvidence(
          discoveryResults,
          citationRefAllocator
        );
        additionalHits.push(...admittedDiscovery.hits);
        const formattedDiscoveryBody = await formatSearchResultsForLLM(
          discoveryResults,
          sotRepository,
          undefined,
          query,
          citationOffset + ragResults.length,
          admittedDiscovery.refs,
          {
            kbId,
            graphAugmentations: mergedAugmentations,
            graphMode,
            graphBudget,
            omitHeader: true,
            omitNextStepSuggestions: true,
          }
        );

        discoverySection =
          `\n---\n` +
          `Graph Discovery（软图谱补漏召回 + Multi-hop：kg_edges 向量检索 → evidence blocks）\n` +
          `说明：以下是“原 RAG 结果之外”的补充证据块，供模型进一步阅读/交叉验证。\n` +
          `---\n` +
          formattedDiscoveryBody;
      }
    } else if (multiHopResults.length > 0) {
      const admittedMultiHop = await allocateAgentKnowledgeSearchEvidence(
        multiHopResults,
        citationRefAllocator
      );
      additionalHits.push(...admittedMultiHop.hits);
      // 只有 Multi-hop，没有 discovery（依然作为 discovery section 输出）
      const formattedDiscoveryBody = await formatSearchResultsForLLM(
        multiHopResults,
        sotRepository,
        undefined,
        query,
        citationOffset + ragResults.length,
        admittedMultiHop.refs,
        {
          kbId,
          graphAugmentations: mergedAugmentations,
          graphMode,
          graphBudget,
          omitHeader: true,
          omitNextStepSuggestions: true,
        }
      );
      discoverySection =
        `\n---\n` +
        `Graph Discovery（Multi-hop：evidence blocks）\n` +
        `说明：以下是“原 RAG 结果之外”的补充证据块，供模型进一步阅读/交叉验证。\n` +
        `---\n` +
        formattedDiscoveryBody;
    }
  }

  // 主结果：永远输出 RAG 命中块（可附加图谱字段，且受预算裁剪）
  const main = await formatSearchResultsForLLM(
    ragResults,
    sotRepository,
    docId,
    query,
    citationOffset,
    admittedRag.refs,
    {
      kbId,
      graphAugmentations: mergedAugmentations,
      graphMode,
      graphBudget,
      omitNextStepSuggestions: discoverySection.length > 0,
    }
  );

  return {
    observation: `${main}${discoverySection}`,
    hits: [...admittedRag.hits, ...additionalHits],
  };
}
