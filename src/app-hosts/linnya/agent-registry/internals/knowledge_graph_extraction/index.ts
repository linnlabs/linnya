/**
 * @file src/app-hosts/linnya/agent-registry/internals/knowledge_graph_extraction/index.ts
 *
 * @description
 * 软知识图谱抽取（Soft Knowledge Graph Extraction）内部模块统一出口：
 * - prompt：见 `prompt.ts`
 * - 模型策略（功能默认模型 + 重试次数）：在本文件集中管理
 */

import type { AgentConfiguration } from '../../types';
import { modelCatalog as defaultModelCatalog } from 'src/domains/model-catalog';
import { PromptKeys } from '../../prompt.types';

export {
  KNOWLEDGE_GRAPH_EXTRACTION_SYSTEM_PROMPT,
  buildKnowledgeGraphExtractionBatchMessages,
  type GraphExtractionLimits,
  type KnowledgeGraphExtractionBatchInput,
} from './prompt';

export type KnowledgeGraphExtractionModelPolicy = {
  /**
   * 主抽取模型 ID。
   */
  primaryModelId: string;

  /**
   * 当 payload.retry=true 时，每个模型最多尝试次数（批次级）。
   *
   * 策略：只重试同一个模型，不切换到其他模型。
   */
  maxAttemptsPerModelWhenRetryEnabled: number;

  /**
   * doc 级自动重试上限（orchestrator 监听 taskFailed 后重新入队）
   */
  maxDocAutoRetryAttempts: number;
};

/**
 * 获取知识图谱抽取重试与兜底策略。
 *
 * 注意：用户上传快照优先；没有上传快照的入口才使用这里的功能默认/硬编码兜底。
 */
export function getKnowledgeGraphExtractionModelPolicy(): KnowledgeGraphExtractionModelPolicy {
  return {
    primaryModelId: defaultModelCatalog.getFunctionalDefaultModelId(PromptKeys.KNOWLEDGE_GRAPH_EXTRACTION)
      ?? 'gemini-3-flash-preview',
    maxAttemptsPerModelWhenRetryEnabled: 3,
    maxDocAutoRetryAttempts: 3,
  };
}

export const KNOWLEDGE_GRAPH_EXTRACTION_CONTEXT_POLICY: NonNullable<AgentConfiguration['contextPolicy']> = {
  profileId: 'agent',
  toolHistory: {
    strategy: 'per-pair',
    keepLatestToolPairs: 0,
    maxInteractionGroups: 4,
    overflowStrategy: 'fail-fast',
  },
};

type ModelCatalogLike = {
  getModel: (id: string) => { id: string; enabled?: boolean } | null | undefined;
};

/**
 * 解析"图谱抽取应使用的主模型 ID"。
 *
 * 优先级：
 * 1. 功能默认 ID（policy.primaryModelId）
 *
 * 中文说明：图谱抽取不再随机挑选 chat 模型做隐式降级。功能默认不可用时返回 null，
 * 由 orchestrator 跳过并记录告警，避免同一批数据混用不同模型。
 */
export function resolveKnowledgeGraphExtractionModelId(args: {
  modelCatalog: ModelCatalogLike;
}): string | null {
  const { modelCatalog } = args;

  const policy = getKnowledgeGraphExtractionModelPolicy();
  const forced = modelCatalog.getModel(policy.primaryModelId);
  if (forced && forced.enabled !== false) return forced.id;
  return null;
}
