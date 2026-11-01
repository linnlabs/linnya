const NETWORK_RETRY_DELAYS_MS = [5_000, 15_000, 30_000, 60_000, 120_000, 300_000] as const;

/** 断网后的下载重试间隔逐步拉长，最长 5 分钟，之后一直按 5 分钟重试。 */
export function resolveUpdateRetryDelay(attempt: number): number {
  const index = Math.min(Math.max(attempt, 0), NETWORK_RETRY_DELAYS_MS.length - 1);
  return NETWORK_RETRY_DELAYS_MS[index];
}
