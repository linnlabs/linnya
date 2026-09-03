/**
 * @file src/tools/knowledgebase/search/KnowledgeSearchTool.ts
 *
 * @brief 统一知识库搜索工具
 *
 * @description
 * 支持全库搜索和单文档搜索的统一工具。
 * - 如果不提供doc_id：在整个知识库中搜索
 * - 如果提供doc_id：在指定文档内搜索
 * - 如果 deep_search=true：启动深度搜索子 Agent
 */

import { BaseTool, ToolParameterSchema, ToolContext, CommonParameterTypes } from '../../types';
import { KnowledgeSearchArgsSchema, KnowledgeSearchResultSchema } from '@app/schemas';
import { runShallowSearch } from './shallow/runShallowSearch';
import { runDeepSearch, DeepSearchFailedError } from './deep/runDeepSearch';
import { resolveGraphPolicyFromContext } from './graphPolicy';
import { readDeepSearchRuntimeDepth } from './deepSearchDepth';
import { DEEP_SEARCH_CONFIG as DEEP_SEARCH_AGENT_CONFIG } from 'src/app-hosts/linnya/agent-registry/agents/deep_search';
import { Logger } from 'src/shared/logger';
import { requireCitationSequenceOffset } from '../../../domains/citation';

const logger = new Logger('KnowledgeSearchTool');

/**
 * 🔥 deep_search 调用次数硬约束（根因级治理）
 *
 * 背景：
 * - 上层 Agent 有时会在同一轮 run 中多次调用 deep_search（deep_search=true），造成 token 巨量浪费；
 * - 仅靠 prompt/描述约束不可靠，必须在工具层做确定性限制。
 *
 * 约束：
 * - 同一个 run 内最多执行 2 次 deep_search；
 * - 第 3 次及以后：自动降级为浅搜索（保持产品可用性）。
 *
 * 说明：同一 run 的 ToolNode 共享同一个 ToolContext；WeakMap 既保持 run 隔离，
 * 也允许 run 结束后随上下文自动释放，禁止在长生命周期工具实例上保存 runId Map。
 */
const MAX_DEEP_SEARCH_CALLS_PER_RUN = 2;
const deepSearchCallCountByContext = new WeakMap<object, number>();

function getDeepSearchExecutedCount(context: ToolContext): number {
  return deepSearchCallCountByContext.get(context) ?? 0;
}

function markDeepSearchExecuted(context: ToolContext): void {
  const prev = deepSearchCallCountByContext.get(context) ?? 0;
  deepSearchCallCountByContext.set(context, prev + 1);
}

/**
 * Deep Search 工具侧配置常量（仅包含“递归防护”等工具语义）
 *
 * - 子 Agent 的默认运行参数（maxSteps / candidateTopK）以 `agent-registry/agents/deep_search` 为单一真源；
 * - KnowledgeSearchTool 若需要覆盖默认值，应显式传参给 runDeepSearch（而不是在此重复定义默认常量）。
 */
const DEEP_SEARCH_TOOL_CONFIG = {
  /** 最大递归深度（用于防护） */
  MAX_DEPTH: 1,
} as const;

/**
 * 统一知识库搜索工具
 * 支持全库搜索和单文档搜索
 */
export class KnowledgeSearchTool extends BaseTool {
  readonly name = 'knowledge_search';

  get description() {
    return `Unified search tool for the knowledge base.

Note: The \`query\` string does not support search operators/syntax such as AND/OR/NOT (no boolean logic, phrase syntax, or fielded query parsing).

Important (ID semantics):
- \`doc_id\` is the **full document ID**. Use it as input to \`knowledge_read\`.
- \`[@ref]\` is a **citation short id** (ref) for tracing evidence to a specific block. It is **NOT** the same as \`doc_id\`.
- Only cite canonical \`[@XXXXXX]\` references shown in this result. Never cite a document ID, block ID, result number, or an invented reference.

# When to Use
- **Global Search (without doc_id)**: When you need to find information across all documents, or when you don't know which document contains the information.
- **Document Search (with doc_id)**: When you want to focus on a particular document, or after using global search to identify a relevant document.
- **Deep Search (with deep_search=true)**: When you need high-quality results (such as multiple parallel concepts, cross-document analysis, more rigorous evidence, high-risk fields (financial, legal, medical, financial, security, etc.), etc.). This mode performs comprehensive retrieval.

# Usage Modes
1. **Global Search**: Searches across all documents in the knowledge base, returns results from multiple documents

2. **Document Search**: Searches within a specific document, use the document ID from previous search results

3. **Deep Search**: 
   - Returns higher quality, more relevant results
   - Use when you need rigorous evidence or precise answers
   - When you perform a normal search and find that the results are scattered, noisy, or the number of results is large, you can enable deep search
   - Don't perform multiple similar queries at the same time, this tool will return a comprehensive result, which may cause duplicate results
   - **Maximum number of calls to deep search is 2** for the same user request, similar queries will cause a lot of duplicate results

# Strategy
- Use deep search when the problem is complex, noisy, or the results are not satisfactory after repeated searches and browsing
- Use specific, focused search terms rather than general questions
- If you have performed multiple document searches and browsed the documents and don't find the information all you need, you should use deep search instead of continuing to search
- Outputs include document ID, block ID for further exploration`;
  }

  readonly parameters: ToolParameterSchema = {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'The search query. Use specific terms for better results.',
      },
      doc_id: {
        ...CommonParameterTypes.docId,
        description:
          'Optional. The unique ID of a specific document to search within. If omitted, searches across all documents.',
      },
      top_k: {
        type: 'integer',
        description: 'The maximum number of results to return. Default is 5.',
        default: 5,
      },
      deep_search: {
        type: 'boolean',
        description:
          'Optional. Enable deep search mode with relevance filtering. The same user request can only call this tool twice. Default is false.',
        default: false,
      },
    },
    required: ['query'],
  };

  getExecutionSummary(output: string): string {
    const parsed = KnowledgeSearchResultSchema.parse(JSON.parse(output) as unknown);
    /**
     * deep_search 的 summary 来自 assemble_documents，必须优先用于历史压缩；
     * 子 Agent 的内部工具输出不在主历史里，不能依赖压缩器自行回溯。
     */
    const summaryFromData = parsed.data.summary;
    if (summaryFromData) {
      return summaryFromData;
    }
    const observation = parsed.observation;
    const isDocumentSearch = parsed.data.search_mode === 'document';

    if (observation.includes('did not match any documents')) {
      return isDocumentSearch ? '在指定文档中没有找到匹配的内容。' : '搜索没有返回任何结果。';
    }

    const allBlocks = observation.split('---').filter(s => s.trim());
    const resultBlocks = allBlocks.filter(block => /Ref: doc_id=/.test(block));

    if (resultBlocks.length === 0) {
      if (observation.trim().length > 100) {
        const prefix = isDocumentSearch ? '在指定文档中搜索到了一些结果' : '搜索到了一些结果';
        return `${prefix}，摘要: ${observation.trim().slice(0, 100)}...`;
      }
      return observation.trim();
    }

    const summaryItems = resultBlocks.slice(0, 3).map(block => {
      const titleMatch = block.match(/Document '([^']*)'/);
      const hitMatch = block.match(/├─ Hit:\s*"([\s\S]*?)"(?=\n\s*(└─ Next:|Ref:|---))/);
      const docName = titleMatch?.[1] ?? '未知文档';
      const snippet = hitMatch?.[1]?.trim() ?? '...';
      return `来自 '${docName}': "${snippet.slice(0, 50)}..."`;
    });

    const searchScope = isDocumentSearch ? '在指定文档中' : '';
    const suffix = resultBlocks.length > 3 ? '...' : '';
    return `${searchScope}搜索返回了 ${resultBlocks.length} 个结果。前 ${summaryItems.length} 个是: ${summaryItems.join('; ')}${suffix}`;
  }

  async run(args: Record<string, unknown>, context: ToolContext): Promise<string> {
    const input = KnowledgeSearchArgsSchema.parse(args);

    // ✅ 用户终止：工具层必须尽快停止，避免终止后仍继续占用资源
    if (context.abortSignal?.aborted) {
      const err = new Error('The user aborted a request.');
      err.name = 'AbortError';
      throw err;
    }

    // 说明：工具入参已在 ToolNode 侧按 schema 做过“无歧义规范化”，这里仍保持严格读取（不使用 any/断言）。
    const query = input.query;
    const doc_id = input.doc_id;
    const top_k = input.top_k;
    const deep_search = input.deep_search;
    const { knowledgeBaseService } = context;

    const citationOffset = requireCitationSequenceOffset(context);

    // 递归防护硬闸统一使用 runtime 的 childRunDepth。
    const deepSearchDepth = readDeepSearchRuntimeDepth(context);
    /**
     * 🔥 deep_search 次数上限（同一 run 内最多 2 次）
     *
     * 注意：这里限制的是“实际执行 deep_search 的次数”，而不是参数传入次数。
     * - 当达到上限时，shouldDeepSearch=false，后续流程将走浅搜索；
     * - 这是确定性限制：避免 token 巨量浪费，同时不影响可用性。
     */
    const deepSearchExecutedCount = getDeepSearchExecutedCount(context);
    const canExecuteMoreDeepSearch = deepSearchExecutedCount < MAX_DEEP_SEARCH_CALLS_PER_RUN;
    const isBlockedByDeepSearchCallLimit = deep_search && !canExecuteMoreDeepSearch;
    const shouldDeepSearch =
      deep_search &&
      deepSearchDepth < DEEP_SEARCH_TOOL_CONFIG.MAX_DEPTH &&
      canExecuteMoreDeepSearch;

    // ✅ 图谱能力档位由业务决定（ToolContext 注入 / childRunDepth），模型无权选择
    const graphPolicy = resolveGraphPolicyFromContext(context);

    if (deep_search && !shouldDeepSearch) {
      if (deepSearchDepth >= DEEP_SEARCH_TOOL_CONFIG.MAX_DEPTH) {
        logger.warn('深度搜索触发递归限制，改走浅搜索', {
          runId: context.runId,
          childRunDepth: deepSearchDepth,
          maxDepth: DEEP_SEARCH_TOOL_CONFIG.MAX_DEPTH,
        });
      } else if (!canExecuteMoreDeepSearch) {
        logger.warn('深度搜索触发单次 run 限额，改走浅搜索', {
          runId: context.runId,
          executedCount: deepSearchExecutedCount,
          limit: MAX_DEEP_SEARCH_CALLS_PER_RUN,
        });
      }
    }

    if (!knowledgeBaseService) {
      throw new Error('Knowledge base service not available in context');
    }

    // 深度搜索模式：启动子 Agent
    if (shouldDeepSearch) {
      try {
        // 进入 deep_search 前先计数：确保同一 run 内最多执行 2 次
        markDeepSearchExecuted(context);
        const deepResult = await runDeepSearch({
          query,
          docId: doc_id,
          topK: top_k,
          context,
          citationOffset,
          // ✅ 工具侧可显式覆盖；若不传则 runDeepSearch 会回退到 agent-registry 的默认值（单一真源）
          maxSteps: DEEP_SEARCH_AGENT_CONFIG.MAX_STEPS,
          candidateTopK: DEEP_SEARCH_AGENT_CONFIG.CANDIDATE_TOP_K,
        });
        /**
         * ✅ 行为修复：deep_search 不应把结果写入证据库然后只返回指针
         *
         * 约束（与浅搜索保持一致）：
         * - 直接返回 StructuredToolResult（包含 data + observation）；
         * - 让上层（UI/历史压缩/编排）看到与浅搜索一致的结构，而不是 citation_snapshot_bundle_id 指针包。
         */
        return JSON.stringify(deepResult);
      } catch (e) {
        // 用户终止：必须向上抛出，不能降级为浅搜索
        if (e instanceof Error && e.name === 'AbortError') {
          throw e;
        }
        // deep_search 失败：按既有产品语义降级为浅搜索
        if (e instanceof DeepSearchFailedError) {
          logger.warn('深度搜索执行失败，改走浅搜索', {
            runId: context.runId,
            error: e.message,
          });
          const shallowResult = await runShallowSearch({
            query,
            docId: doc_id,
            topK: Math.max(top_k, DEEP_SEARCH_AGENT_CONFIG.CANDIDATE_TOP_K),
            context,
            citationOffset,
          });
          // 轻量化：不 pretty-print，降低 tool_output 体积
          return JSON.stringify(shallowResult);
        }
        throw e;
      }
    }

    // 浅搜索模式
    /**
     * 🔥 deep_search 次数上限降级策略（你提出的规则）
     *
     * 目标：
     * - 当用户/模型显式请求 deep_search（deep_search=true），但因为“同一 run 超过 2 次”被拦截时，
     *   为了保持召回覆盖面，浅搜索 topK 至少提升到 DEEP_SEARCH_AGENT_CONFIG.CANDIDATE_TOP_K。
     *
     * 注意：
     * - 这是“超限降级”的确定性策略；
     * - 递归防护（childRunDepth）导致的降级不在此列，仍然尊重调用方传入的 top_k（默认 5）。
     */
    const effectiveShallowTopK =
      isBlockedByDeepSearchCallLimit && deepSearchDepth < DEEP_SEARCH_TOOL_CONFIG.MAX_DEPTH
        ? Math.max(top_k, DEEP_SEARCH_AGENT_CONFIG.CANDIDATE_TOP_K)
        : top_k;
    const shallowResult = await runShallowSearch({
      query,
      docId: doc_id,
      topK: effectiveShallowTopK,
      context,
      citationOffset,
      graph: graphPolicy,
    });
    // 超长 observation 由 ToolNode 的 ToolOutputStore 统一治理，搜索工具不再维护第二套落盘协议。
    return JSON.stringify(shallowResult);
  }
}
