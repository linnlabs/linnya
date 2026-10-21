import type { ToolContext } from '../../../types';
import {
  ShallowWebSearchArgsSchema,
  ShallowWebSearchResultSchema,
  type WebSearchCitation,
  type WebSearchResult as WebSearchToolResult,
} from '@app/schemas';
import { createWebSearchProvider } from '../providers/factory';
import { Logger } from '@shared/logger';
import { getWebFailureDiagnostics, getWebFailureKind } from '../../shared/webFailure';
import type { WebSearchProvider, WebSearchResult } from '../providers/types';
import type { WebEvidenceWriter } from '../../shared/ports/webEvidenceWriter';
import type { WebEvidenceCaptureItem } from '../../shared/definitions/webEvidenceCapture';
import { requireWebEvidenceWriter } from '../../shared/orchestration/webEvidenceWriterContext';
import type { WebCacheRuntime } from '../../shared/cache/webCacheFactory';
import { getWebCacheRuntime } from '../../shared/cache/webCacheFactory';
import { searchWebWithCache } from './searchWithCache';
import { saveEvidenceWithInFlight } from '../../shared/cache/orchestration/saveEvidenceWithInFlight';
import type { WebCacheStatus } from '../../shared/cache/definitions/webCache';
import { buildWebSearchObservation } from '../functions/buildWebSearchObservation';
import {
  requireCitationRefAllocator,
  requireCitationSequenceOffset,
} from '../../../../domains/citation';

const logger = new Logger('WebSearchTool');

export interface ShallowWebSearchDependencies {
  provider?: WebSearchProvider;
  evidenceWriter?: WebEvidenceWriter;
  cacheRuntime?: WebCacheRuntime;
}

/** 两个搜索入口复用取得、缓存、引用及 Evidence 的同一条生产链。 */
export async function runShallowWebSearch(
  rawArgs: Record<string, unknown>,
  context: ToolContext,
  dependencies: ShallowWebSearchDependencies = {}
): Promise<string> {
  if (context.abortSignal?.aborted) {
    const error = new Error('The user aborted a request.');
    error.name = 'AbortError';
    throw error;
  }

  const args = ShallowWebSearchArgsSchema.parse(rawArgs);
  const query = args.query;
  const topK = args.top_k;
  const recencyDays = args.recency_days;
  const citationOffset = requireCitationSequenceOffset(context);

  // 1. 调用 provider 获取原始搜索结果
  const provider = dependencies.provider ?? createWebSearchProvider();
  const startedAt = Date.now();
  logger.info('[WebSearchTool] 开始搜索', {
    operation: 'search',
    provider: provider.name,
    queryLength: query.length,
    topK,
  });

  let rawResults: WebSearchResult[];
  let cacheStatus: WebCacheStatus;
  const cacheRuntime = dependencies.cacheRuntime ?? getWebCacheRuntime();
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
      ...getWebFailureDiagnostics(error),
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
      writer: dependencies.evidenceWriter ?? requireWebEvidenceWriter(context),
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

  const result = ShallowWebSearchResultSchema.parse({
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
