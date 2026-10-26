import { Logger } from '@shared/logger';
import {
  WebFailureError,
  getWebFailureDiagnostics,
  getWebExtractionFailureStage,
  getWebFailureKind,
  isEscalatableWebFailureKind,
  type WebExtractionFailureStage,
  type WebFailureKind,
} from '../../shared/webFailure';
import type { WebReadEscalationReason, WebReadLadderResult } from '../definitions/readLadder';
import { DEFAULT_WEB_READ_CONFIG, type WebReadConfig } from '../definitions/webReadConfig';
import { createWebReadFailure } from '../functions/createWebReadFailure';
import { getWebFileFormat } from '../file-acquisition/functions/validateWebFile';
import { assessWebReadQuality } from '../functions/assessWebReadQuality';
import {
  createLocalRenderWebReadProvider,
  createLocalWebReadProvider,
  createWebReadProvider,
} from '../providers/factory';
import type { WebReadParams, WebReadProvider, WebReadResult } from '../providers/types';
import type { WebPageResource } from '../../definitions/webDocument';
import { attachWebReadRecoveryResources, mergeWebReadRecoveryResources } from '../functions/webReadRecoveryResources';

const logger = new Logger('WebReadLadder');
const DEFAULT_WEB_READ_TOTAL_TIMEOUT_MS = 90_000;

const MANAGED_AFTER_RENDER_FAILURE: ReadonlySet<WebFailureKind> = new Set([
  'timeout',
  'network_error',
  'provider_error',
  'extraction_error',
  'http_403',
  'captcha',
  'login_required',
  'js_required',
  'empty_content',
]);

export interface WebReadLadderDependencies {
  /** 保留原 provider 注入语义：测试可覆写默认的本地首跳。 */
  provider?: WebReadProvider;
  /** undefined 使用默认本地渲染；null 显式关闭渲染，供 R3 配置层使用。 */
  renderProvider?: WebReadProvider | null;
  managedProvider?: WebReadProvider | null;
  /** 单次读取捕获的配置快照，禁止在阶梯内部重新读取配置 port。 */
  config?: WebReadConfig;
  totalTimeoutMs?: number;
}

/** 质量不足失败时随错误附带的已取得正文上限；只在不可信边界内展示，不进入诊断或日志。 */
const WEB_READ_PARTIAL_EXCERPT_CHARS = 1_000;

/** 本次本地与渲染结果中正文最长的一份；未取得任何结果时不提供摘录事实。 */
function describePartialContent(
  results: readonly (WebReadResult | undefined)[]
): { extractedChars?: number; partialContent?: string } {
  const best = results
    .filter((result): result is WebReadResult => result !== undefined)
    .reduce<WebReadResult | undefined>(
      (longest, result) => (!longest || result.content.length > longest.content.length ? result : longest),
      undefined
    );
  if (!best) return {};
  const content = best.content.trim();
  return {
    extractedChars: content.length,
    ...(content ? { partialContent: content.slice(0, WEB_READ_PARTIAL_EXCERPT_CHARS) } : {}),
  };
}

async function readManagedFallback(args: {
  params: WebReadParams;
  initialProvider: WebReadProvider;
  reason: WebReadEscalationReason;
  managedProvider: WebReadProvider | null | undefined;
  config: WebReadConfig;
  qualityScore: number | undefined;
  renderAttempted: boolean;
  initialFailureKind?: WebFailureKind;
  initialFailureStage?: WebExtractionFailureStage;
  previousFailure?: unknown;
  resources?: readonly WebPageResource[];
  /** 质量不足时本次已取得的本地/渲染结果。 */
  partialResults?: readonly (WebReadResult | undefined)[];
}): Promise<WebReadLadderResult> {
  if (
    args.managedProvider === null ||
    (args.managedProvider === undefined && args.config.managedReader === 'none')
  ) {
    const previousFailureKind =
      args.previousFailure === undefined ? undefined : getWebFailureKind(args.previousFailure);
    const extractionStage =
      args.previousFailure === undefined
        ? args.initialFailureStage
        : (getWebExtractionFailureStage(args.previousFailure) ?? args.initialFailureStage);
    const failureReason = previousFailureKind ?? args.initialFailureKind ?? args.reason;
    const stageSuffix = extractionStage ? `，stage=${extractionStage}` : '';
    throw attachWebReadRecoveryResources(new WebFailureError<WebReadEscalationReason>(
      'managed_disabled',
      `[WEB_READ_MANAGED_DISABLED] 本机网页读取未取得合格正文（${failureReason}${stageSuffix}）。`,
      {
        details: {
          ...describePartialContent(args.partialResults ?? []),
          escalationReason: args.reason,
          initialFailureKind: args.initialFailureKind,
          previousFailureKind,
          renderAttempted: args.renderAttempted,
          ...(extractionStage ? { extractionStage } : {}),
          ...getWebFailureDiagnostics(args.previousFailure),
          failureStage:
            getWebFailureDiagnostics(args.previousFailure).failureStage ?? 'read_ladder',
        },
      }
    ), args.resources ?? []);
  }
  const managedProvider = args.managedProvider ?? createWebReadProvider(args.config);
  logger.info('[readWebPageWithLadder] 升级托管读取', {
    operation: 'read',
    fromProvider: args.initialProvider.name,
    toProvider: managedProvider.name,
    escalationReason: args.reason,
    initialFailureStage: args.initialFailureStage,
    qualityScore: args.qualityScore,
  });

  try {
    const readResult = await managedProvider.read(args.params);
    return {
      readResult,
      initialProvider: args.initialProvider.name,
      selectedProvider: managedProvider.name,
      renderAttempted: args.renderAttempted,
      escalated: true,
      escalationReason: args.reason,
      initialFailureKind: args.initialFailureKind,
      initialFailureStage: args.initialFailureStage,
    };
  } catch (cause: unknown) {
    const error = createWebReadFailure(cause, 'managed_reader', {
      initialFailureKind: args.initialFailureKind,
      ...(args.previousFailure !== undefined
        ? { previousFailureKind: getWebFailureKind(args.previousFailure) }
        : {}),
      escalationReason: args.reason,
      renderAttempted: args.renderAttempted,
    });
    logger.error('[readWebPageWithLadder] 托管读取失败', {
      operation: 'read',
      provider: managedProvider.name,
      escalationReason: args.reason,
      initialFailureStage: args.initialFailureStage,
      qualityScore: args.qualityScore,
      failureKind: getWebFailureKind(error),
      ...getWebFailureDiagnostics(error),
    });
    throw attachWebReadRecoveryResources(error, args.resources ?? []);
  }
}

/** 已确认来自正式文件响应的失败（如正文下载超时）不交给 Chromium：渲染器读不出文件正文。 */
function isFileResponseFailure(error: unknown): boolean {
  const contentType = getWebFailureDiagnostics(error).contentType;
  return contentType !== undefined && getWebFileFormat(contentType) !== undefined;
}

function shouldAttemptRender(
  reason: WebReadEscalationReason,
  extractionStage?: WebExtractionFailureStage
): boolean {
  // Chromium 能独立修复原始 HTML 的建树差异；但 canonical DOM 上的
  // Readability 异常在渲染后仍会进入同一个抽取器，不能机械重试。
  if (reason === 'extraction_error') return extractionStage === 'dom_canonicalization';
  return reason !== 'http_403' && reason !== 'captcha' && reason !== 'login_required';
}

async function readRenderedOrManaged(args: {
  params: WebReadParams;
  initialProvider: WebReadProvider;
  renderProvider: WebReadProvider;
  managedProvider: WebReadProvider | null | undefined;
  config: WebReadConfig;
  reason: WebReadEscalationReason;
  qualityScore: number | undefined;
  initialFailureKind?: WebFailureKind;
  initialFailureStage?: WebExtractionFailureStage;
  resources?: readonly WebPageResource[];
  /** 本地读取成功但质量不足时的结果，渲染仍不合格时用于描述已取得正文。 */
  localResult?: WebReadResult;
}): Promise<WebReadLadderResult> {
  logger.info('[readWebPageWithLadder] 升级本地渲染', {
    operation: 'read',
    fromProvider: args.initialProvider.name,
    toProvider: args.renderProvider.name,
    escalationReason: args.reason,
    initialFailureStage: args.initialFailureStage,
    qualityScore: args.qualityScore,
  });

  let renderedResult: WebReadResult;
  try {
    renderedResult = await args.renderProvider.read(args.params);
  } catch (cause: unknown) {
    const error = createWebReadFailure(cause, 'local_render');
    const failureKind = getWebFailureKind(error);
    if (!MANAGED_AFTER_RENDER_FAILURE.has(failureKind)) {
      throw attachWebReadRecoveryResources(error, args.resources ?? []);
    }
    return readManagedFallback({
      params: args.params,
      initialProvider: args.initialProvider,
      reason: isEscalatableWebFailureKind(failureKind) ? failureKind : args.reason,
      managedProvider: args.managedProvider,
      config: args.config,
      qualityScore: args.qualityScore,
      renderAttempted: true,
      initialFailureKind: args.initialFailureKind,
      initialFailureStage: args.initialFailureStage,
      previousFailure: error,
      resources: args.resources,
      partialResults: [args.localResult],
    });
  }

  const quality = assessWebReadQuality(renderedResult);
  if (!quality.shouldEscalate || !quality.reason) {
    return {
      readResult: renderedResult,
      initialProvider: args.initialProvider.name,
      selectedProvider: args.renderProvider.name,
      renderAttempted: true,
      escalated: false,
      escalationReason: args.reason,
      initialFailureKind: args.initialFailureKind,
      initialFailureStage: args.initialFailureStage,
    };
  }

  return readManagedFallback({
    params: args.params,
    initialProvider: args.initialProvider,
    reason: quality.reason,
    managedProvider: args.managedProvider,
    config: args.config,
    qualityScore: quality.qualityScore,
    renderAttempted: true,
    initialFailureKind: args.initialFailureKind,
    initialFailureStage: args.initialFailureStage,
    resources: mergeWebReadRecoveryResources(args.resources, renderedResult.resources),
    partialResults: [args.localResult, renderedResult],
  });
}

async function executeReadLadder(
  params: WebReadParams,
  dependencies: WebReadLadderDependencies
): Promise<WebReadLadderResult> {
  const config = dependencies.config ?? DEFAULT_WEB_READ_CONFIG;
  const initialProvider = dependencies.provider ?? createLocalWebReadProvider();
  const renderEnabled =
    dependencies.renderProvider === undefined
      ? config.renderEnabled
      : dependencies.renderProvider !== null;
  let readResult: WebReadResult;

  try {
    readResult = await initialProvider.read(params);
  } catch (cause: unknown) {
    const error = createWebReadFailure(cause, 'local_http');
    const failureKind = getWebFailureKind(error);
    const initialFailureStage = getWebExtractionFailureStage(error);
    if (!isEscalatableWebFailureKind(failureKind)) throw error;
    if (renderEnabled && shouldAttemptRender(failureKind, initialFailureStage)
      && !isFileResponseFailure(error)) {
      return readRenderedOrManaged({
        params,
        initialProvider,
        renderProvider: dependencies.renderProvider ?? createLocalRenderWebReadProvider(),
        managedProvider: dependencies.managedProvider,
        config,
        reason: failureKind,
        qualityScore: undefined,
        initialFailureKind: failureKind,
        initialFailureStage,
      });
    }
    return readManagedFallback({
      params,
      initialProvider,
      reason: failureKind,
      managedProvider: dependencies.managedProvider,
      config,
      qualityScore: undefined,
      renderAttempted: false,
      initialFailureKind: failureKind,
      initialFailureStage,
      previousFailure: error,
    });
  }

  const quality = assessWebReadQuality(readResult);
  if (!quality.shouldEscalate || !quality.reason) {
    return {
      readResult,
      initialProvider: initialProvider.name,
      selectedProvider: initialProvider.name,
      renderAttempted: false,
      escalated: false,
    };
  }

  if (renderEnabled && shouldAttemptRender(quality.reason)) {
    return readRenderedOrManaged({
      params,
      initialProvider,
      renderProvider: dependencies.renderProvider ?? createLocalRenderWebReadProvider(),
      managedProvider: dependencies.managedProvider,
      config,
      reason: quality.reason,
      qualityScore: quality.qualityScore,
      resources: readResult.resources,
      localResult: readResult,
    });
  }

  return readManagedFallback({
    params,
    initialProvider,
    reason: quality.reason,
    managedProvider: dependencies.managedProvider,
    config,
    qualityScore: quality.qualityScore,
    renderAttempted: false,
    resources: readResult.resources,
    partialResults: [readResult],
  });
}

export async function readWebPageWithLadder(
  params: WebReadParams,
  dependencies: WebReadLadderDependencies = {}
): Promise<WebReadLadderResult> {
  const controller = new AbortController();
  let totalBudgetExpired = false;
  const abortFromCaller = (): void => controller.abort();
  if (params.signal?.aborted) controller.abort();
  else params.signal?.addEventListener('abort', abortFromCaller, { once: true });
  const totalTimeoutMs = dependencies.totalTimeoutMs ?? DEFAULT_WEB_READ_TOTAL_TIMEOUT_MS;
  const totalTimer = setTimeout(() => {
    totalBudgetExpired = true;
    controller.abort();
  }, totalTimeoutMs);

  try {
    return await executeReadLadder({ ...params, signal: controller.signal }, dependencies);
  } catch (error: unknown) {
    if (totalBudgetExpired) {
      throw new WebFailureError('timeout', `网页读取总耗时超过 ${totalTimeoutMs}ms。`, {
        details: { ...getWebFailureDiagnostics(error), failureStage: 'read_ladder',
          ...(error instanceof WebFailureError && error.details?.resources
            ? { resources: error.details.resources } : {}),
        },
      });
    }
    throw error;
  } finally {
    clearTimeout(totalTimer);
    params.signal?.removeEventListener('abort', abortFromCaller);
  }
}
