/**
 * @file packages/plugins/knowledge/src/backend/agents/knowledge-graph-extraction/index.ts
 *
 * @description
 * 软知识图谱抽取（Soft Knowledge Graph Extraction）内部模块统一出口：
 * - prompt：见 `prompt.ts`
 * - 上下文策略：在本文件集中管理；重试次数见 `graph/definitions/extractionRetryPolicy.ts`
 */

import type { AgentConfiguration } from '@plugin/backend/agentRegistry';

export {
  KNOWLEDGE_GRAPH_EXTRACTION_SYSTEM_PROMPT,
  buildKnowledgeGraphExtractionBatchMessages,
  type GraphExtractionLimits,
  type KnowledgeGraphExtractionBatchInput,
} from './prompt';

export const KNOWLEDGE_GRAPH_EXTRACTION_CONTEXT_POLICY: NonNullable<
  AgentConfiguration['contextPolicy']
> = {
  profileId: 'agent',
  toolHistory: {
    strategy: 'per-pair',
    keepLatestToolPairs: 0,
    maxInteractionGroups: 4,
    overflowStrategy: 'fail-fast',
  },
};
