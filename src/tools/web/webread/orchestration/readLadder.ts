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
import type {
  WebReadEscalationReason,
  WebReadLadderResult,
} from '../definitions/readLadder';
import {
  DEFAULT_WEB_READ_CONFIG,
  type WebReadConfig,
} from '../definitions/webReadConfig';
import { assessWebReadQuality } from '../functions/assessWebReadQuality';
import {
  createLocalRenderWebReadProvider,
  createLocalWebReadProvider,
  createWebReadProvider,
} from '../providers/factory';
import type { WebReadParams, WebReadProvider, WebReadResult } from '../providers/types';

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
}): Promise<WebReadLadderResult> {
  if (args.managedProvider === null
    || (args.managedProvider === undefined && args.config.managedReader === 'none')) {
    const previousFailureKind = args.previousFailure === undefined
      ? undefined
      : getWebFailureKind(args.previousFailure);
    const previousFailureMessage = args.previousFailure instanceof Error
      ? args.previousFailure.message
      : undefined;
    const extractionStage = args.previousFailure === undefined
      ? args.initialFailureStage
      : getWebExtractionFailureStage(args.previousFailure) ?? args.initialFailureStage;
    const failureReason = previousFailureKind ?? args.initialFailureKind ?? args.reason;
    const stageSuffix = extractionStage ? `，stage=${extractionStage}` : '';
    throw new WebFailureError<WebReadEscalationReason>(
      'managed_disabled',
      `[WEB_READ_MANAGED_DISABLED] 本机网页读取未完成（${failureReason}${stageSuffix}），且未启用第三方增强解析。`,
      {
        details: {
          escalationReason: args.reason,
          initialFailureKind: args.initialFailureKind,
          previousFailureKind,
          previousFailureMessage,
          renderAttempted: args.renderAttempted,
          ...(extractionStage ? { extractionStage } : {}),
          ...getWebFailureDiagnostics(args.previousFailure),
        },
      },
    );
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
  } catch (error: unknown) {
    logger.error('[readWebPageWithLadder] 托管读取失败', {
      operation: 'read',
      provider: managedProvider.name,
      escalationReason: args.reason,
      initialFailureStage: args.initialFailureStage,
      qualityScore: args.qualityScore,
      failureKind: getWebFailureKind(error),
      ...getWebFailureDiagnostics(error),
    });
    throw error;
  }
}

function shouldAttemptRender(
  reason: WebReadEscalationReason,
  extractionStage?: WebExtractionFailureStage,
): boolean {
  // Chromium 能独立修复原始 HTML 的建树差异；但 canonical DOM 上的
  // Readability 异常在渲染后仍会进入同一个抽取器，不能机械重试。
  if (reason === 'extraction_error') return extractionStage === 'dom_canonicalization';
  return reason !== 'http_403'
    && reason !== 'captcha'
    && reason !== 'login_required';
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
  } catch (error: unknown) {
    const failureKind = getWebFailureKind(error);
    if (!MANAGED_AFTER_RENDER_FAILURE.has(failureKind)) throw error;
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
  });
}

async function executeReadLadder(
  params: WebReadParams,
  dependencies: WebReadLadderDependencies,
): Promise<WebReadLadderResult> {
  const config = dependencies.config ?? DEFAULT_WEB_READ_CONFIG;
  const initialProvider = dependencies.provider ?? createLocalWebReadProvider();
  const renderEnabled = dependencies.renderProvider === undefined
    ? config.renderEnabled
    : dependencies.renderProvider !== null;
  let readResult: WebReadResult;

  try {
    readResult = await initialProvider.read(params);
  } catch (error: unknown) {
    const failureKind = getWebFailureKind(error);
    const initialFailureStage = getWebExtractionFailureStage(error);
    if (!isEscalatableWebFailureKind(failureKind)) throw error;
    if (renderEnabled && shouldAttemptRender(failureKind, initialFailureStage)) {
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
  });
}

export async function readWebPageWithLadder(
  params: WebReadParams,
  dependencies: WebReadLadderDependencies = {},
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
    return await executeReadLadder(
      { ...params, signal: controller.signal },
      dependencies,
    );
  } catch (error: unknown) {
    if (totalBudgetExpired) {
      throw new WebFailureError('timeout', `网页读取总耗时超过 ${totalTimeoutMs}ms。`);
    }
    throw error;
  } finally {
    clearTimeout(totalTimer);
    params.signal?.removeEventListener('abort', abortFromCaller);
  }
}
