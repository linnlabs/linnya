/**
 * @file WebSearchTool.ts
 * @description 联网搜索工具（web_search）
 *
 * 职责边界：
 * - 输入：query + 少量可选参数
 * - 输出：StructuredToolResult，包含 data.citations（供消息依赖投影）和 observation（供 LLM 引用）
 * - 复用现有 [@ref] 引用体系：citationOffset、ref 生成、Conversation message dependency 投影
 * - 不负责 provider 选择逻辑（委托给 factory）
 *
 * 引用约束：
 * - observation 中必须明确展示每条结果的 [@ref]（模型只允许引用它看见过的 ref）
 * - citations[].index = citationOffset + localIndex + 1（保证同 turn 内编号连续）
 */

import { BaseTool } from '../../types';
import type { ToolContext, ToolParameterSchema } from '../../types';
import {
  WEB_SEARCH_DEFAULT_TOP_K,
  WEB_SEARCH_MAX_TOP_K,
  WEB_SEARCH_MIN_TOP_K,
  WebSearchArgsSchema,
  WebSearchResultSchema,
  type WebSearchCitation,
  type WebSearchResult as WebSearchToolResult,
} from '@app/schemas';
import { createWebSearchProvider } from './providers/factory';
import { Logger } from '@shared/logger';
import { getWebFailureKind } from '../shared/webFailure';
import type { WebSearchProvider, WebSearchResult } from './providers/types';
import type { WebEvidenceWriter } from '../shared/ports/webEvidenceWriter';
import type { WebEvidenceCaptureItem } from '../shared/definitions/webEvidenceCapture';
import { requireWebEvidenceWriter } from '../shared/orchestration/webEvidenceWriterContext';
import type { WebCacheRuntime } from '../shared/cache/webCacheFactory';
import { createWebCacheRuntime, getWebCacheRuntime } from '../shared/cache/webCacheFactory';
import { MemoryWebCache } from '../shared/cache/adapters/memoryWebCache';
import { searchWebWithCache } from './orchestration/searchWithCache';
import { saveEvidenceWithInFlight } from '../shared/cache/orchestration/saveEvidenceWithInFlight';
import type { WebCacheStatus } from '../shared/cache/definitions/webCache';
import { buildWebSearchObservation } from './functions/buildWebSearchObservation';
import {
  requireCitationRefAllocator,
  requireCitationSequenceOffset,
} from '../../../domains/citation';

const logger = new Logger('WebSearchTool');

export class WebSearchTool extends BaseTool {
  private readonly injectedProvider?: WebSearchProvider;
  private readonly injectedEvidenceWriter?: WebEvidenceWriter;
  private readonly injectedCacheRuntime?: WebCacheRuntime;

  constructor(
    dependencies: {
      provider?: WebSearchProvider;
      evidenceWriter?: WebEvidenceWriter;
      cacheRuntime?: WebCacheRuntime;
    } = {}
  ) {
    super();
    this.injectedProvider = dependencies.provider;
    this.injectedEvidenceWriter = dependencies.evidenceWriter;
    this.injectedCacheRuntime =
      dependencies.cacheRuntime ??
      (dependencies.provider ? createWebCacheRuntime(new MemoryWebCache()) : undefined);
  }

  readonly name = 'web_search';

  readonly description = `Search the web for real-time information using a search engine.

# When to Use
- When the user's question requires up-to-date information not available in the knowledge base.
- When the user explicitly asks to search the web or internet.
- When the topic involves current events, recent developments, or frequently changing information.

# Output
Returns a list of web search results with titles, URLs, and snippets. Each result has a stable short reference [@XXXXXX] that can be cited in your answer.

# Query tips
- Supports common operators like \`site:example.com\` and quotes (e.g. \`"exact phrase"\`).

# Important
- You MUST only cite references ([@ref]) that appear in the tool output. Do NOT invent references.
- The references are stable short IDs, not result numbers.`;

  readonly parameters: ToolParameterSchema = {
    type: 'object',
    additionalProperties: false,
    properties: {
      query: {
        type: 'string',
        description: 'The search query to look up on the web.',
      },
      top_k: {
        type: 'number',
        description: 'Maximum number of results to return. Default: 10 (min: 6).',
        default: WEB_SEARCH_DEFAULT_TOP_K,
        minimum: WEB_SEARCH_MIN_TOP_K,
        maximum: WEB_SEARCH_MAX_TOP_K,
      },
      recency_days: {
        type: 'number',
        minimum: 1,
        description:
          'Optional. Prefer results within the last N days (e.g. 7/30/180/365). Availability depends on provider.',
      },
    },
    required: ['query'],
  };

  async run(rawArgs: Record<string, unknown>, context: ToolContext): Promise<string> {
    if (context.abortSignal?.aborted) {
      const error = new Error('The user aborted a request.');
      error.name = 'AbortError';
      throw error;
    }

    const args = WebSearchArgsSchema.parse(rawArgs);
    const query = args.query;
    const topK = args.top_k;
    const recencyDays = args.recency_days;
    const citationOffset = requireCitationSequenceOffset(context);

    // 1. 调用 provider 获取原始搜索结果
    const provider = this.injectedProvider ?? createWebSearchProvider();
    const startedAt = Date.now();
    logger.info('[WebSearchTool] 开始搜索', {
      operation: 'search',
      provider: provider.name,
      queryLength: query.length,
      topK,
    });

    let rawResults: WebSearchResult[];
    let cacheStatus: WebCacheStatus;
    const cacheRuntime = this.injectedCacheRuntime ?? getWebCacheRuntime();
    try {
      const searchResult = await searchWebWithCache({
        params: { query, topK, recencyDays, signal: context.abortSignal },
        provider,
        runtime: cacheRuntime,
      });
      rawResults = searchResult.results;
      cacheStatus = searchResult.cacheStatus;
    } catch (error: unknown) {
      logger.error('[WebSearchTool] 搜索失败', {
        operation: 'search',
        provider: provider.name,
        outcome: context.abortSignal?.aborted ? 'cancelled' : 'error',
        failureKind: getWebFailureKind(error),
        tookMs: Date.now() - startedAt,
      });
      throw error;
    }

    // 2. 构建 citations（规范化 URL + 生成 ref + 应用 citationOffset）
    const seenUrls = new Set<string>();
    const admittedResults: WebSearchResult[] = [];
    for (const result of rawResults) {
      const canonicalUrl = result.canonicalUrl;
      if (seenUrls.has(canonicalUrl)) continue;
      seenUrls.add(canonicalUrl);
      admittedResults.push(result);
    }
    const refs = await requireCitationRefAllocator(context).allocate(
      admittedResults.map(result => ({
        sourceType: 'web' as const,
        url: result.canonicalUrl,
      }))
    );
    const citations: WebSearchCitation[] = admittedResults.map((result, localIndex) => {
      const ref = refs[localIndex];
      if (!ref) throw new Error('Web search citation allocator returned an incomplete batch.');
      return {
        sourceType: 'web' as const,
        ref,
        index: citationOffset + localIndex + 1,
        url: result.canonicalUrl,
        docTitle: result.title,
        snippet: result.snippet,
        siteName: result.siteName,
        publishedAt: result.publishedAt,
      };
    });

    // 3. 构建 observation（给 LLM 的可引用文本视图，每条必须包含 [@ref]）
    const observation = buildWebSearchObservation({
      query,
      results: citations.map(citation => ({
        ref: citation.ref,
        index: citation.index,
        url: citation.url,
        title: citation.docTitle,
        snippet: citation.snippet,
      })),
    });

    // 4. 构建结构化业务事实；Renderer 在 admission 边界独立派生 presentation。
    const citationMetadata: WebSearchToolResult['data']['citations'] = {
      query,
      searchMode: 'web',
      citations,
    };

    const evidenceItems: WebEvidenceCaptureItem[] = citations.map(citation => ({
      ref: citation.ref,
      title: citation.docTitle,
      snippet: citation.snippet,
      contentText: citation.snippet,
      capturedAtMs: Date.now(),
      url: citation.url,
      canonicalUrl: citation.url,
      ...(citation.siteName ? { siteName: citation.siteName } : {}),
      ...(citation.publishedAt ? { publishedAt: citation.publishedAt } : {}),
      captureKind: 'web_search_result',
    }));
    let bundleId: string;
    try {
      ({ bundleId } = await saveEvidenceWithInFlight({
        runtime: cacheRuntime,
        writer: this.injectedEvidenceWriter ?? requireWebEvidenceWriter(context),
        context,
        query,
        items: evidenceItems,
      }));
    } catch (error: unknown) {
      logger.error('[WebSearchTool] Evidence 写入失败', {
        operation: 'search',
        provider: provider.name,
        outcome: 'error',
        failureKind: 'evidence_error',
        tookMs: Date.now() - startedAt,
        resultCount: citations.length,
      });
      throw error;
    }

    logger.info('[WebSearchTool] 搜索完成', {
      operation: 'search',
      provider: provider.name,
      outcome: citations.length > 0 ? 'success' : 'empty',
      cacheStatus,
      tookMs: Date.now() - startedAt,
      resultCount: citations.length,
    });

    const result = WebSearchResultSchema.parse({
      data: {
        query,
        resultCount: citations.length,
        citations: citationMetadata,
        evidence_store: { bundle_id: bundleId },
        cacheStatus,
      },
      observation,
    });

    return JSON.stringify(result);
  }

  getExecutionSummary(output: string): string {
    try {
      const parsed = WebSearchResultSchema.parse(JSON.parse(output));
      return `联网搜索 "${parsed.data.query}"，返回 ${parsed.data.resultCount} 条结果。`;
    } catch {
      return '联网搜索完成。';
    }
  }
}
