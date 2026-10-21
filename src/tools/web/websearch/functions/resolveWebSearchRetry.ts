import { WebHttpError } from '../../../../infra/adapters/web-http/webHttpFetch';
import { getWebFailureDiagnostics, getWebFailureKind } from '../../shared/webFailure';

const SEARCH_RETRY_DELAY_MS = 250;
const SEARCH_MAX_RETRY_DELAY_MS = 1_000;

/** 已确认的瞬态才补一次；不能从 MCP 错误码或任意供应商文案推测可重试性。 */
export function resolveWebSearchRetryDelay(
  error: unknown,
  remainingMs: number
): number | undefined {
  const kind = getWebFailureKind(error);
  // GET adapter 已用过一次瞬态重试时不再叠加第二套循环。
  if ((getWebFailureDiagnostics(error).retryCount ?? 0) > 0) return undefined;
  if (
    kind !== 'timeout' &&
    kind !== 'network_error' &&
    kind !== 'rate_limited' &&
    kind !== 'http_5xx'
  )
    return undefined;
  const retryAfterMs = error instanceof WebHttpError ? (error.retryAfterMs ?? 0) : 0;
  // Retry-After 是最早可补发的时间，不能为了本地等待上限把它裁短。
  if (retryAfterMs > SEARCH_MAX_RETRY_DELAY_MS) return undefined;
  const delayMs = Math.max(SEARCH_RETRY_DELAY_MS, retryAfterMs);
  return delayMs < remainingMs ? delayMs : undefined;
}
