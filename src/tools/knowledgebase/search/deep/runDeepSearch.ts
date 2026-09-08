/**
 * @file src/tools/knowledgebase/search/deep/runDeepSearch.ts
 * @description 深度搜索执行器（子 Agent 编排 + judge 输出解析 + observation 统一格式化）
 */

import { KnowledgeSearchResultSchema, PromptKeys, type KnowledgeSearchResult } from '@app/schemas';
import type { ToolContext } from '../../../types';
import type { StructuredToolResult } from '../../../types';
import { runRegisteredSubagent } from '../../../agent_control/subrun/shared';
import { generateMessageId } from '../../../../shared/utils/idUtils';
import { runWithLLMDebugEvidenceContext } from 'src/domains/audit';
import { buildDeepSearchTaskMessage } from './taskMessageBuilder';
import {
  parseAssembleToolOutputSummary,
  parseAssembleToolOutputToDocuments,
} from './parseAssembleToolOutput';
import { formatObservationFromDocuments } from '../format/formatObservation';
import { buildDeepSearchCitationMetadata } from './buildDeepSearchCitations';
import { buildGraphDigestForSelectedBlocks } from './buildGraphDigest';
import { captureDeepKnowledgeSearchEvidence } from '../knowledgeSearchEvidenceAdapter';
import { requireCitationRefAllocator } from '../../../../domains/citation';

export class DeepSearchFailedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DeepSearchFailedError';
  }
}

export async function runDeepSearch(params: {
  query: string;
  docId?: string;
  topK: number;
  context: ToolContext;
  citationOffset: number;
  /**
   * 子 Agent 最大步数（可选）
   *
   * 中文备注：
   * - 若调用方未传，则回退到 agent-registry 的默认值（单一真源）
   */
  maxSteps?: number;
  /**
   * 子 Agent 初始召回数量（可选）
   *
   * 中文备注：
   * - 若调用方未传，则回退到 agent-registry 的默认值（单一真源）
   */
  candidateTopK?: number;
}): Promise<StructuredToolResult<KnowledgeSearchResult['data']>> {
  const { query, docId, topK, context, citationOffset } = params;

  // ✅ 用户终止：在启动子 Agent 前立刻响应，避免“终止后仍继续工作”
  if (context.abortSignal?.aborted) {
    const err = new Error('The user aborted a request.');
    err.name = 'AbortError';
    throw err;
  }

  const { DEEP_SEARCH_CONFIG } = await import(
    'src/app-hosts/linnya/agent-registry/agents/deep_search'
  );

  const effectiveMaxSteps =
    typeof params.maxSteps === 'number' && Number.isFinite(params.maxSteps)
      ? params.maxSteps
      : DEEP_SEARCH_CONFIG.MAX_STEPS;
  const effectiveCandidateTopK =
    typeof params.candidateTopK === 'number' && Number.isFinite(params.candidateTopK)
      ? params.candidateTopK
      : DEEP_SEARCH_CONFIG.CANDIDATE_TOP_K;

  const parentToolCallId = context.parentToolCallId?.trim() ?? '';

  const subrunId = `subrun_${generateMessageId()}`;

  const originalUserRequest = context.userQuery;
  const taskMessage = buildDeepSearchTaskMessage({
    query,
    originalUserRequest,
    docId,
    topK,
    candidateTopK: effectiveCandidateTopK,
  });

  /**
   * 🔥 LLM 请求审计（开发模式落盘）
   *
   * 说明：
   * - 子 Agent 的 LLM 请求也必须写入“父 run 文件”中（同 runId），但需要带上 subrunId 标识；
   * - 这里通过 AsyncLocalStorage 在子链路上追加上下文，由 lifecycle audit 记录子运行观测。
   */
  const result = await runWithLLMDebugEvidenceContext(
    {
      subrunId,
      parentToolCallId,
      source: 'tool:knowledge_search:deep_search',
    },
    async () => {
      return await runRegisteredSubagent({
        context,
        promptKey: PromptKeys.DEEP_SEARCH,
        description: `深度搜索：${query}`,
        userMessage: taskMessage,
        inheritTurns: 0,
        maxSteps: effectiveMaxSteps,
        subrunId,
        subrunSource: 'tool:knowledge_search:deep_search',
        subrunMetadata: {},
      });
    }
  );

  // 用户终止：即使子 Agent 以“失败”返回，也要优先按 AbortError 语义结束
  if (context.abortSignal?.aborted) {
    const err = new Error('The user aborted a request.');
    err.name = 'AbortError';
    throw err;
  }

  if (!result.success || typeof result.judgeToolOutput !== 'string') {
    // 这里不吞错误：由上层决定是否降级浅搜索
    throw new DeepSearchFailedError(
      '[KnowledgeSearchTool] 深度搜索子 Agent 未产出 assemble 工具输出'
    );
  }

  const documents = parseAssembleToolOutputToDocuments(result.judgeToolOutput);
  // 🔥 关键：deep_search 的“搜索工具摘要”必须复用 assemble 的 summary，供 ToolHistoryCompressor 使用
  const summary = parseAssembleToolOutputSummary(result.judgeToolOutput);

  // ✅ 轻量级图谱摘要：让上层 AI “看到图谱”，但不透出 full graph（只给计数 + TopN）
  const graphDigest = await buildGraphDigestForSelectedBlocks({
    context,
    documents,
    maxEntitiesPerBlock: 5,
    maxEdgesPerBlock: 5,
  });

  // 上下文扩充范围：deep_search 的“阅读视图”展示范围
  // 说明：
  // - 当最终选中块较多时（topK 较大），继续扩上下文会导致 observation 体积急剧膨胀；
  // - 因此这里做一个与 topK 相关的“设计型约束”，保证输出可读且不爆上下文。
  const contextExpansionRange = topK >= 20 ? 0 : 1;

  let docName: string | null = null;
  if (docId) {
    const document = await context.knowledgeBaseService?.getDocumentById(docId);
    if (!document?.filename) {
      throw new DeepSearchFailedError(
        `[KnowledgeSearchTool] 单文档深度搜索无法解析文档名称：doc_id="${docId}"`
      );
    }
    docName = document.filename;
    const foreignDocument = documents.find(item => item.doc_id !== docId);
    if (foreignDocument) {
      throw new DeepSearchFailedError(
        `[KnowledgeSearchTool] 单文档深度搜索返回越界证据：expected="${docId}" actual="${foreignDocument.doc_id}"`
      );
    }
  }
  const searchMode = docId ? 'document' : 'global';

  const citations = await buildDeepSearchCitationMetadata({
    query,
    documents,
    searchMode,
    docName: docName ?? undefined,
    citationOffset,
    context,
    citationRefAllocator: requireCitationRefAllocator(context),
    contextExpansionRange,
  });

  const observationProjection = await formatObservationFromDocuments({
    documents,
    query,
    citationOffset,
    reader: {
      getRawSoTDocument: documentId => {
        const knowledgeBaseService = context.knowledgeBaseService;
        if (!knowledgeBaseService) {
          throw new DeepSearchFailedError(
            '[KnowledgeSearchTool] Knowledge base service not available.'
          );
        }
        return knowledgeBaseService.getRawSoTDocument(documentId);
      },
    },
    citations,
    contextExpansionRange,
    // 🔥 输出体积上限：防止 deep_search 返回“无限长阅读材料”，挤爆上层模型上下文。
    // 经验值：当 topK 提升到 20~30 时，每块文本可能较长，因此给出一个总字符数限制。
    maxTotalBlocks: 160,
    // 调整：在现有上限基础上整体下调 1 万字符，进一步降低“阅读材料挤爆上下文”的风险。
    maxTotalChars: topK >= 20 ? 50_000 : 70_000,
  });

  const admittedResult = KnowledgeSearchResultSchema.parse({
    data: {
      query,
      search_strategy: 'deep',
      subrun_id: subrunId,
      search_mode: searchMode,
      doc_name: docName,
      summary,
      citations,
      graph_digest: graphDigest,
    },
    observation: observationProjection.observation,
  });
  await captureDeepKnowledgeSearchEvidence({
    query,
    emittedEvidence: observationProjection.emittedEvidence,
    context,
  });
  return admittedResult;
}
