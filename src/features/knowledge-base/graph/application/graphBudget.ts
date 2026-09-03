/**
 * @file graphBudget.ts
 *
 * @description
 * 图谱检索“预算模型”（Budget Model）定义与解析（先落地 light/full 的预算与裁剪，不引入 full 的多跳检索实现）。
 *
 * 设计目标：
 * - **高内聚**：graph_mode + graph_budget 的类型、默认值、解析逻辑收口在一个小模块中；
 * - **低耦合**：工具层/搜索服务/格式化层都只依赖该模块，不在各处复制默认值；
 * - **可演进**：后续 full 模式接入 Entity-Driven、多跳时，只需要复用 budget，不需要重写参数解析。
 *
 * 重要约束（先讨论后实现的部分）：
 * - 当前 full 仍然是 Chunk-Driven 的增强（与 light 同路由），只是预算更大；
 * - Entity-Driven / 多跳扩展会在后续阶段实现（需另行定义“扩展预算：hops/beam/threshold”等）。
 */

/**
 * 图谱能力档位（对外协议）
 */
export type GraphMode = 'off' | 'light' | 'full';

/**
 * 图谱展示预算（当前阶段：只控制“喂给模型/前端的输出体积”）
 *
 * 单位说明：
 * - maxResultsWithGraph：最多对前 N 条检索结果附加图谱信息（防止长尾结果撑爆 token）
 * - maxEntitiesPerResult：每条结果最多展示的实体数量
 * - maxEdgesPerResult：每条结果最多展示的边数量
 */
export type GraphBudget = {
  maxResultsWithGraph: number;
  maxEntitiesPerResult: number;
  maxEdgesPerResult: number;
  /**
   * 软图谱“补漏召回”（Discovery）最多追加的证据块数量。
   *
   * 说明：
   * - Discovery 的目标是引入“原 RAG 未召回到的新证据块”，从而产生信息增量；
   * - 该字段只控制输出规模与额外检索开销，不改变原始 RAG 的召回与排序。
   */
  maxDiscoveredBlocks: number;
  /**
   * Discovery（Path B：Statement-Driven）的最小语义相似度阈值（Cosine Similarity）。
   *
   * 重要说明（业务约束）：
   * - 该阈值必须基于“纯语义检索”的 score（即 Qdrant semantic search 返回的 cosine score），
   *   **不能**使用 RRF/hybrid 的融合分数（无物理量纲，属于相对排名产物）。
   * - 该阈值需要随 embedding 模型做校准；默认值仅作为工程起点。
   */
  minDiscoverySemanticScore: number;
  /**
   * Full V3：Entity-Driven Anchor（基于 kg_nodes 的语义锚点）最多引入的实体数量。
   *
   * 业务约束：
   * - 必须小（默认 3），否则会导致多跳扩展的分支爆炸与漂移风险上升。
   */
  maxEntityAnchors: number;
  /**
   * Full V3：Entity-Driven Anchor 的最小语义阈值（Cosine Similarity）。
   *
   * 说明：
   * - 该阈值用于过滤“看起来沾边但其实是噪音”的实体锚点；
   * - 依赖 embedding 模型校准。
   */
  minEntityAnchorSemanticScore: number;
  /**
   * Full V3：Multi-hop 的 hop1 语义 margin（用于抑制“第一跳就很模糊”导致的二跳漂移）。
   *
   * 定义：
   * - margin = topScore(hop1) - lastScore(hop1_selected)
   * - 若 margin < hop1MinSemanticMargin，则不执行 hop2（只输出 hop1 的证据）。
   */
  hop1MinSemanticMargin: number;
  /**
   * Full V3：证据多样性约束 —— 每个 doc 最多允许输出多少个 evidence blocks。
   *
   * 目的：
   * - 避免“单一文档/单一来源”把 discovery 区挤满，提升 Deep Research 的稳健性。
   */
  maxEvidenceBlocksPerDoc: number;
};

export const DEFAULT_LIGHT_GRAPH_BUDGET: GraphBudget = {
  maxResultsWithGraph: 5,
  maxEntitiesPerResult: 6,
  maxEdgesPerResult: 3,
  maxDiscoveredBlocks: 2,
  // light 默认更保守：宁缺毋滥，避免把“潜在相关”误当成“直接上下文”
  minDiscoverySemanticScore: 0.82,
  // light 不做 Entity-Driven anchor（避免额外开销与语义漂移）
  maxEntityAnchors: 0,
  minEntityAnchorSemanticScore: 1,
  hop1MinSemanticMargin: 1,
  maxEvidenceBlocksPerDoc: 0,
};

export const DEFAULT_FULL_GRAPH_BUDGET: GraphBudget = {
  maxResultsWithGraph: 8,
  maxEntitiesPerResult: 12,
  maxEdgesPerResult: 8,
  maxDiscoveredBlocks: 6,
  /**
   * full（Deep Research）默认阈值（业务拍板）：
   * - 策略：**高召回（Recall）优先**，让深研 Agent “先看到线索”，再靠后续 Cross-Validate/证据约束/预算裁剪去控噪；
   * - 背景：在 text-embedding-3-small + 中文抽象 query 场景下，kg_edges/kg_nodes 的 top 分数常落在 ~0.60~0.70，
   *   若阈值设到 0.78/0.80 会导致 discovery/anchor 经常 0 命中（full 形同虚设）。
   */
  minDiscoverySemanticScore: 0.6,
  // Full V3 默认锚点：Top3
  maxEntityAnchors: 3,
  // Entity-Driven Anchor：作为“入口发现”，阈值也需要偏宽松（后续多跳/证据约束会继续收敛噪音）
  minEntityAnchorSemanticScore: 0.62,
  // 允许 hop1 略发散，避免过早阻断（漂移控制主要交给证据约束与预算）
  hop1MinSemanticMargin: 0.02,
  maxEvidenceBlocksPerDoc: 2,
};

function clampInt(v: number, min: number, max: number): number {
  if (!Number.isFinite(v)) return min;
  const n = Math.floor(v);
  if (n < min) return min;
  if (n > max) return max;
  return n;
}

function clampFloat(v: number, min: number, max: number): number {
  if (!Number.isFinite(v)) return min;
  if (v < min) return min;
  if (v > max) return max;
  return v;
}

function readRecord(v: unknown): Record<string, unknown> | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  return v as Record<string, unknown>;
}

function readGraphMode(v: unknown): GraphMode | null {
  if (v === 'off' || v === 'light' || v === 'full') return v;
  return null;
}

/**
 * 解析并返回“最终的 graph_mode + graph_budget”（确定性）
 *
 * 规则（当前版本）：
 * - 显式传入 graphMode 时尊重；
 * - 未传入时默认：
 *   - deepSearch=true → full（预算更大，适合更严格的检索/阅读链路）
 *   - deepSearch=false → light（默认增强预览）
 * - graphMode=off → budget 全部归零（彻底不附加图谱信息）
 * - graphBudget 只允许覆盖三个字段，且都做边界收敛（避免极端值撑爆输出）
 */
export function resolveGraphModeAndBudget(args: {
  graphMode?: unknown;
  graphBudget?: unknown;
  deepSearch?: boolean;
}): { mode: GraphMode; budget: GraphBudget } {
  const deepSearch = args.deepSearch === true;
  const requestedMode = readGraphMode(args.graphMode);
  const mode: GraphMode = requestedMode ?? (deepSearch ? 'full' : 'light');

  if (mode === 'off') {
    return {
      mode,
      budget: {
        maxResultsWithGraph: 0,
        maxEntitiesPerResult: 0,
        maxEdgesPerResult: 0,
        maxDiscoveredBlocks: 0,
        minDiscoverySemanticScore: 1,
        maxEntityAnchors: 0,
        minEntityAnchorSemanticScore: 1,
        hop1MinSemanticMargin: 1,
        maxEvidenceBlocksPerDoc: 0,
      },
    };
  }

  const base = mode === 'full' ? DEFAULT_FULL_GRAPH_BUDGET : DEFAULT_LIGHT_GRAPH_BUDGET;
  const override = readRecord(args.graphBudget);
  if (!override) return { mode, budget: base };

  const maxResults =
    typeof override['max_results_with_graph'] === 'number'
      ? clampInt(override['max_results_with_graph'], 0, 50)
      : base.maxResultsWithGraph;
  const maxEntities =
    typeof override['max_entities_per_result'] === 'number'
      ? clampInt(override['max_entities_per_result'], 0, 50)
      : base.maxEntitiesPerResult;
  const maxEdges =
    typeof override['max_edges_per_result'] === 'number'
      ? clampInt(override['max_edges_per_result'], 0, 50)
      : base.maxEdgesPerResult;
  const maxDiscovered =
    typeof override['max_discovered_blocks'] === 'number'
      ? clampInt(override['max_discovered_blocks'], 0, 50)
      : base.maxDiscoveredBlocks;
  const minDiscoverySemanticScore =
    typeof override['min_discovery_semantic_score'] === 'number'
      ? clampFloat(override['min_discovery_semantic_score'], 0, 1)
      : base.minDiscoverySemanticScore;
  const maxEntityAnchors =
    typeof override['max_entity_anchors'] === 'number'
      ? clampInt(override['max_entity_anchors'], 0, 10)
      : base.maxEntityAnchors;
  const minEntityAnchorSemanticScore =
    typeof override['min_entity_anchor_semantic_score'] === 'number'
      ? clampFloat(override['min_entity_anchor_semantic_score'], 0, 1)
      : base.minEntityAnchorSemanticScore;
  const hop1MinSemanticMargin =
    typeof override['hop1_min_semantic_margin'] === 'number'
      ? clampFloat(override['hop1_min_semantic_margin'], 0, 1)
      : base.hop1MinSemanticMargin;
  const maxEvidenceBlocksPerDoc =
    typeof override['max_evidence_blocks_per_doc'] === 'number'
      ? clampInt(override['max_evidence_blocks_per_doc'], 0, 20)
      : base.maxEvidenceBlocksPerDoc;

  return {
    mode,
    budget: {
      maxResultsWithGraph: maxResults,
      maxEntitiesPerResult: maxEntities,
      maxEdgesPerResult: maxEdges,
      maxDiscoveredBlocks: maxDiscovered,
      minDiscoverySemanticScore,
      maxEntityAnchors,
      minEntityAnchorSemanticScore,
      hop1MinSemanticMargin,
      maxEvidenceBlocksPerDoc,
    },
  };
}

