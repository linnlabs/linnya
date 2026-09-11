import { Logger } from '@shared/logger';
import {
  WEB_READ_MAX_CONTENT_CHARS,
  WebReadResultSchema,
  type WebReadCitation,
} from '@app/schemas';
import type { ToolContext } from '../../../types';
import { requireToolConversationScope } from 'src/app-hosts/linnya/adapters/tools/conversation-scope';
import { assertAllowedWebUrl } from '../../shared/urlPolicy';
import { normalizeUrl } from '../../websearch/citations/normalizeUrl';
import type { WebReadLadderResult } from '../definitions/readLadder';
import type { WebReadConfig } from '../definitions/webReadConfig';
import type { WebReadProvider } from '../providers/types';
import { getWebReadConfig } from '../ports/webReadConfigReader';
import { WebFailureError, getWebFailureDiagnostics, getWebFailureKind } from '../../shared/webFailure';
import type { WebEvidenceWriter } from '../../shared/ports/webEvidenceWriter';
import { requireWebEvidenceWriter } from '../../shared/orchestration/webEvidenceWriterContext';
import type { WebCacheRuntime } from '../../shared/cache/webCacheFactory';
import { createWebCacheRuntime, getWebCacheRuntime } from '../../shared/cache/webCacheFactory';
import { MemoryWebCache } from '../../shared/cache/adapters/memoryWebCache';
import { readWebPageWithCache } from './readWithCache';
import { saveEvidenceWithInFlight } from '../../shared/cache/orchestration/saveEvidenceWithInFlight';
import type { WebCacheStatus } from '../../shared/cache/definitions/webCache';
import {
  requireCitationRefAllocator,
  requireCitationSequenceOffset,
} from '../../../../domains/citation';
import { buildWebReadObservation } from '../functions/buildWebReadObservation';

const logger = new Logger('ReadWebPage');

export const MAX_WEB_PAGE_CONTENT_CHARS = WEB_READ_MAX_CONTENT_CHARS;
const SNIPPET_CHARS = 300;

export interface ReadWebPageParams {
  url: string;
  maxChars?: number;
  titleHint?: string;
}

export interface ReadWebPageDependencies {
  provider?: WebReadProvider;
  renderProvider?: WebReadProvider | null;
  managedProvider?: WebReadProvider | null;
  config?: WebReadConfig;
  evidenceWriter?: WebEvidenceWriter;
  cacheRuntime?: WebCacheRuntime;
}

function createAbortError(): Error {
  const error = new Error('The user aborted a request.');
  error.name = 'AbortError';
  return error;
}

function resolveMaxChars(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0)
    return MAX_WEB_PAGE_CONTENT_CHARS;
  return Math.min(Math.floor(value), MAX_WEB_PAGE_CONTENT_CHARS);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function tryParseProviderErrorPayload(
  content: string
): { errCode?: number } | null {
  const trimmed = content.trim();
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) return null;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (!isRecord(parsed)) return null;
    const record = parsed;
    const errCode = typeof record['errCode'] === 'number' ? record['errCode'] : undefined;
    const errMsg = typeof record['errMsg'] === 'string' ? record['errMsg'].trim() : undefined;
    if (errCode === undefined && !errMsg) return null;
    // 只保留数值状态；errMsg 仅参与错误形态识别，不能成为可信异常正文。
    return { ...(errCode !== undefined ? { errCode } : {}) };
  } catch {
    return null;
  }
}

export async function runReadWebPage(
  params: ReadWebPageParams,
  context: ToolContext,
  dependencies: ReadWebPageDependencies = {}
): Promise<string> {
  const startedAt = Date.now();
  if (context.abortSignal?.aborted) {
    logger.error('[runReadWebPage] 读取已取消', {
      operation: 'read',
      outcome: 'cancelled',
      failureKind: 'aborted',
      tookMs: 0,
    });
    throw createAbortError();
  }

  let allowedUrl: URL;
  try {
    allowedUrl = assertAllowedWebUrl(params.url);
  } catch (error: unknown) {
    logger.error('[runReadWebPage] URL 策略拒绝', {
      operation: 'read',
      outcome: 'policy_denied',
      failureKind: getWebFailureKind(error),
      tookMs: Date.now() - startedAt,
    });
    throw error;
  }

  const maxChars = resolveMaxChars(params.maxChars);
  const citationOffset = requireCitationSequenceOffset(context);
  const initialProvider = dependencies.provider?.name ?? 'local_http';
  // 一次读取只捕获一次配置，缓存身份与实际 Provider 选路共享该快照。
  const config = dependencies.config ?? getWebReadConfig();
  const renderProvider =
    dependencies.renderProvider !== undefined
      ? dependencies.renderProvider
      : config.renderEnabled
        ? undefined
        : null;
  const managedProvider =
    dependencies.managedProvider !== undefined
      ? dependencies.managedProvider
      : config.managedReader === 'none'
        ? null
        : undefined;

  logger.info('[runReadWebPage] 开始读取', {
    operation: 'read',
    provider: initialProvider,
    routeStrategy: 'local_http_render_managed',
    renderEnabled: config.renderEnabled,
    managedReader: config.managedReader,
    route: allowedUrl.origin,
    maxChars,
  });
  let ladderResult: WebReadLadderResult;
  let cacheStatus: WebCacheStatus;
  const cacheRuntime =
    dependencies.cacheRuntime ??
    (dependencies.provider ? createWebCacheRuntime(new MemoryWebCache()) : getWebCacheRuntime());
  try {
    const cachedRead = await readWebPageWithCache(
      {
        url: allowedUrl.toString(),
        // 缓存统一保存工具允许的最大正文，调用级 limit 只在下方裁剪。
        // 否则先读 1k 会污染同 URL 缓存，后续 50k 请求永远拿不到全文。
        maxChars: MAX_WEB_PAGE_CONTENT_CHARS,
        signal: context.abortSignal,
      },
      {
        ...(dependencies.provider ? { provider: dependencies.provider } : {}),
        ...(renderProvider !== undefined ? { renderProvider } : {}),
        ...(managedProvider !== undefined ? { managedProvider } : {}),
        config,
        runtime: cacheRuntime,
      }
    );
    ladderResult = cachedRead.ladderResult;
    cacheStatus = cachedRead.cacheStatus;
  } catch (error: unknown) {
    logger.error('[runReadWebPage] Provider 读取失败', {
      operation: 'read',
      provider: initialProvider,
      route: allowedUrl.origin,
      outcome: context.abortSignal?.aborted ? 'cancelled' : 'error',
      failureKind: getWebFailureKind(error),
      ...getWebFailureDiagnostics(error),
      tookMs: Date.now() - startedAt,
    });
    throw error;
  }
  const readResult = ladderResult.readResult;

  const providerError = tryParseProviderErrorPayload(readResult.content);
  if (providerError) {
    const errCodeText =
      providerError.errCode !== undefined ? `（errCode=${providerError.errCode}）` : '';
    const error = new WebFailureError(
      'invalid_response',
      `读取网页失败：目标站点或网页读取服务返回错误${errCodeText}。`
    );
    logger.error('[runReadWebPage] Provider 返回错误正文', {
      operation: 'read',
      provider: ladderResult.selectedProvider,
      route: allowedUrl.origin,
      outcome: 'error',
      failureKind: 'invalid_response',
      tookMs: Date.now() - startedAt,
    });
    throw error;
  }

  const truncated = readResult.truncated || readResult.content.length > maxChars;
  const content = truncated ? readResult.content.slice(0, maxChars) : readResult.content;
  const canonicalUrl = normalizeUrl(readResult.finalUrl);
  requireToolConversationScope({ context, errorPrefix: '[read_web_page]' });

  // 标题回填属于证据索引职责，不应在读取热路径扫描会话全部 bundle。
  // 当前由调用方显式传递搜索标题；未来如需自动回填，应接入 Evidence URL 索引 port。
  const resolvedTitle = readResult.title.trim() || params.titleHint?.trim() || canonicalUrl;
  const [ref] = await requireCitationRefAllocator(context).allocate([
    {
      sourceType: 'web',
      url: canonicalUrl,
    },
  ]);
  if (!ref) throw new Error('Web read citation allocator returned an incomplete batch.');
  const snippet = content.slice(0, SNIPPET_CHARS);
  const siteName = readResult.siteName?.trim();
  const publishedAt = readResult.publishedAt?.trim();
  const author = readResult.byline?.trim();
  const citation: WebReadCitation = {
    sourceType: 'web',
    ref,
    index: citationOffset + 1,
    url: canonicalUrl,
    docTitle: resolvedTitle,
    snippet,
    ...(siteName ? { siteName } : {}),
    ...(publishedAt ? { publishedAt } : {}),
    ...(author ? { author } : {}),
  };

  const citations = {
    query: params.url,
    searchMode: 'web' as const,
    citations: [citation] as const,
  };
  let bundleId: string;
  try {
    ({ bundleId } = await saveEvidenceWithInFlight({
      runtime: cacheRuntime,
      writer: dependencies.evidenceWriter ?? requireWebEvidenceWriter(context),
      context,
      query: params.url,
      items: [
        {
          ref,
          title: resolvedTitle,
          snippet,
          contentText: content,
          capturedAtMs: Date.now(),
          url: canonicalUrl,
          canonicalUrl,
          ...(readResult.siteName ? { siteName: readResult.siteName } : {}),
          ...(readResult.publishedAt ? { publishedAt: readResult.publishedAt } : {}),
          captureKind: 'web_page',
        },
      ],
    }));
  } catch (error: unknown) {
    logger.error('[runReadWebPage] Evidence 写入失败', {
      operation: 'read',
      provider: ladderResult.selectedProvider,
      route: allowedUrl.origin,
      outcome: 'error',
      failureKind: 'evidence_error',
      tookMs: Date.now() - startedAt,
      charCount: content.length,
    });
    throw error;
  }

  const observation = buildWebReadObservation({
    ref,
    title: resolvedTitle,
    url: canonicalUrl,
    siteName: readResult.siteName,
    content,
    contentHash: readResult.contentHash,
    capturedCharCount: content.length,
    captureTruncated: truncated,
  });

  logger.info('[runReadWebPage] 读取完成', {
    operation: 'read',
    provider: ladderResult.selectedProvider,
    initialProvider: ladderResult.initialProvider,
    renderMode: readResult.renderMode,
    renderAttempted: ladderResult.renderAttempted,
    extractor: readResult.extractor,
    escalated: ladderResult.escalated,
    escalationReason: ladderResult.escalationReason,
    initialFailureKind: ladderResult.initialFailureKind,
    initialFailureStage: ladderResult.initialFailureStage,
    cacheStatus,
    route: allowedUrl.origin,
    outcome: 'success',
    tookMs: Date.now() - startedAt,
    charCount: content.length,
    truncated,
  });

  const result = WebReadResultSchema.parse({
    data: {
      url: canonicalUrl,
      title: resolvedTitle,
      charCount: content.length,
      truncated,
      provider: ladderResult.selectedProvider,
      renderMode: readResult.renderMode,
      extractor: readResult.extractor,
      renderAttempted: ladderResult.renderAttempted,
      escalated: ladderResult.escalated,
      ...(ladderResult.escalationReason ? { escalationReason: ladderResult.escalationReason } : {}),
      ...(ladderResult.initialFailureKind
        ? { initialFailureKind: ladderResult.initialFailureKind }
        : {}),
      ...(ladderResult.initialFailureStage
        ? { initialFailureStage: ladderResult.initialFailureStage }
        : {}),
      citations,
      evidence_store: { bundle_id: bundleId },
      cacheStatus,
    },
    observation,
  });
  return JSON.stringify(result);
}
