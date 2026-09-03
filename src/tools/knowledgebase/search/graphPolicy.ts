/**
 * @file graphPolicy.ts
 *
 * @description
 * 知识库搜索的“图谱增强策略”（业务定义，模型无权选择）。
 *
 * 设计目标：
 * - 工具入参不暴露 graph_mode/graph_budget，避免模型自行切换能力档位；
 * - 由业务/编排层通过 ToolContext 注入或通过 childRunDepth 自动判定：
 *   - 顶层 Agent（childRunDepth=0）→ light
 *   - 子 Agent（childRunDepth>=1）→ full
 * - 后续如某些业务要彻底关闭图谱增强，可在 ToolContext 注入 `graphMode: 'off'`。
 */

import type { ToolContext } from '../../types';
import type { GraphBudget, GraphMode } from '../../../features/knowledge-base/graph/application/graphBudget';
import { DEFAULT_FULL_GRAPH_BUDGET, DEFAULT_LIGHT_GRAPH_BUDGET } from '../../../features/knowledge-base/graph/application/graphBudget';
import { readDeepSearchRuntimeDepth } from './deepSearchDepth';

export type GraphSearchPolicy = { mode: GraphMode; budget: GraphBudget };

function clampInt(v: number, min: number, max: number): number {
  if (!Number.isFinite(v)) return min;
  const n = Math.floor(v);
  if (n < min) return min;
  if (n > max) return max;
  return n;
}

function isGraphMode(v: unknown): v is GraphMode {
  return v === 'off' || v === 'light' || v === 'full';
}

function clampFloat(v: number, min: number, max: number): number {
  if (!Number.isFinite(v)) return min;
  if (v < min) return min;
  if (v > max) return max;
  return v;
}

/**
 * 从 ToolContext 读取“预算覆盖项”（允许只覆盖少数字段）。
 *
 * 说明：
 * - ToolContext.graphBudget 的所有权在业务/编排层；
 * - 为保持向后兼容，这里允许注入“部分字段”，其余字段回退到 base budget；
 * - 严格类型收敛：只接受 number/finite，且做边界裁剪。
 */
function readGraphBudgetOverride(v: unknown): Partial<GraphBudget> | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const r = v as Record<string, unknown>;

  const out: Partial<GraphBudget> = {};

  const maxResults = r['maxResultsWithGraph'];
  if (typeof maxResults === 'number') out.maxResultsWithGraph = clampInt(maxResults, 0, 50);
  const maxEntities = r['maxEntitiesPerResult'];
  if (typeof maxEntities === 'number') out.maxEntitiesPerResult = clampInt(maxEntities, 0, 50);
  const maxEdges = r['maxEdgesPerResult'];
  if (typeof maxEdges === 'number') out.maxEdgesPerResult = clampInt(maxEdges, 0, 50);
  const maxDiscovered = r['maxDiscoveredBlocks'];
  if (typeof maxDiscovered === 'number') out.maxDiscoveredBlocks = clampInt(maxDiscovered, 0, 50);

  const minDisc = r['minDiscoverySemanticScore'];
  if (typeof minDisc === 'number') out.minDiscoverySemanticScore = clampFloat(minDisc, 0, 1);

  const maxAnchors = r['maxEntityAnchors'];
  if (typeof maxAnchors === 'number') out.maxEntityAnchors = clampInt(maxAnchors, 0, 10);
  const minAnchor = r['minEntityAnchorSemanticScore'];
  if (typeof minAnchor === 'number') out.minEntityAnchorSemanticScore = clampFloat(minAnchor, 0, 1);

  const hop1Margin = r['hop1MinSemanticMargin'];
  if (typeof hop1Margin === 'number') out.hop1MinSemanticMargin = clampFloat(hop1Margin, 0, 1);
  const maxPerDoc = r['maxEvidenceBlocksPerDoc'];
  if (typeof maxPerDoc === 'number') out.maxEvidenceBlocksPerDoc = clampInt(maxPerDoc, 0, 20);

  return Object.keys(out).length > 0 ? out : null;
}

/**
 * 从 ToolContext 决定图谱策略（业务定义）
 *
 * 规则：
 * - 如果 ToolContext 明确注入 graphMode/graphBudget，则优先使用；
 * - 否则按 childRunDepth 判定：0→light，>=1→full；
 * - graphMode=off 时 budget 自动归零，确保 formatter 不输出任何图谱字段。
 */
export function resolveGraphPolicyFromContext(context: ToolContext): GraphSearchPolicy {
  const injectedMode = isGraphMode(context.graphMode) ? context.graphMode : null;
  const injectedBudgetOverride = readGraphBudgetOverride(context.graphBudget);

  const depth = readDeepSearchRuntimeDepth(context);
  const mode: GraphMode = injectedMode ?? (depth >= 1 ? 'full' : 'light');

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
  if (!injectedBudgetOverride) return { mode, budget: base };

  return {
    mode,
    budget: {
      ...base,
      ...injectedBudgetOverride,
    },
  };
}
