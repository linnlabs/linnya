import { setTimeout as wait } from 'node:timers/promises';
import { resolveWebSearchRetryDelay } from '../functions/resolveWebSearchRetry';
import { Logger } from '@shared/logger';
import { WebHttpError } from '../../../../infra/adapters/web-http/webHttpFetch';
import {
  WebFailureError,
  formatWebFailureDiagnostics,
  getWebFailureDiagnostics,
  getWebFailureKind,
} from '../../shared/webFailure';
import type { WebSearchParams, WebSearchProvider, WebSearchResult } from '../providers/types';

const logger = new Logger('WebSearchRetry');
const SEARCH_TOTAL_TIMEOUT_MS = 60_000;

export interface SearchRetryDependencies {
  /** 内部测试预算，生产所有搜索共享同一固定总预算，不向模型增加参数。 */
  totalTimeoutMs?: number;
}

/** 同一次缓存/in-flight 取得内最多补一次请求；取消、等待和两次尝试共享总预算。 */
export async function searchWebWithRetry(
  args: {
    params: WebSearchParams;
    provider: WebSearchProvider;
  },
  dependencies: SearchRetryDependencies = {}
): Promise<WebSearchResult[]> {
  const startedAt = Date.now();
  const totalTimeoutMs = dependencies.totalTimeoutMs ?? SEARCH_TOTAL_TIMEOUT_MS;
  const controller = new AbortController();
  let totalBudgetExpired = false;
  const timer = setTimeout(() => {
    totalBudgetExpired = true;
    controller.abort();
  }, totalTimeoutMs);
  const signal = args.params.signal
    ? AbortSignal.any([args.params.signal, controller.signal])
    : controller.signal;
  let attempt = 0;
  let firstFailureKind: ReturnType<typeof getWebFailureKind> | undefined;
  try {
    while (true) {
      signal.throwIfAborted();
      attempt += 1;
      try {
        const results = await args.provider.search({ ...args.params, signal });
        signal.throwIfAborted();
        return results;
      } catch (error: unknown) {
        if (signal.aborted) throw error;
        const delayMs = resolveWebSearchRetryDelay(
          error,
          totalTimeoutMs - (Date.now() - startedAt)
        );
        if (attempt === 2 || delayMs === undefined) throw error;
        firstFailureKind = getWebFailureKind(error);
        logger.info('[searchWebWithRetry] 瞬态失败后退避一次', {
          provider: args.provider.name,
          failureKind: firstFailureKind,
          attempt,
          retryCount: 1,
          delayMs,
          ...getWebFailureDiagnostics(error),
        });
        await wait(delayMs, undefined, { signal });
      }
    }
  } catch (error: unknown) {
    const diagnostics = getWebFailureDiagnostics(error);
    const kind = args.params.signal?.aborted
      ? 'aborted'
      : totalBudgetExpired
        ? 'timeout'
        : getWebFailureKind(error);
    const details = {
      ...diagnostics,
      failureStage: 'search' as const,
      // 底层已有重试时保留它的次数，否则记录本次共享取得的尝试，而非工具调用数。
      attempt: Math.max(attempt, diagnostics.attempt ?? 0),
      retryCount: Math.max(Math.max(0, attempt - 1), diagnostics.retryCount ?? 0),
      ...(firstFailureKind ? { previousFailureKind: firstFailureKind } : {}),
    };
    const message = args.params.signal?.aborted
      ? '网页搜索已由调用方取消。'
      : totalBudgetExpired
        ? `网页搜索总耗时超过 ${totalTimeoutMs}ms。`
        : error instanceof WebHttpError || error instanceof WebFailureError
          ? error.message
          : `网页搜索失败（${kind}）。`;
    throw new WebFailureError(kind, `${message}\n${formatWebFailureDiagnostics(details)}`, {
      status: diagnostics.status,
      details,
    });
  } finally {
    clearTimeout(timer);
  }
}
