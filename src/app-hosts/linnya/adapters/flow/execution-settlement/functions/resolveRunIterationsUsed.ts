/**
 * checkpoint 的绝对预算优先；只有已知本次增量时才与旧 Registry 累加。
 * 两种输入都未知代表没有完整预算事实，不能用零覆盖已有持久状态。
 */
export function resolveRunIterationsUsed(
  stepCount: number | undefined,
  absoluteIterations: number | undefined,
  previousIterations: number | undefined,
): number | undefined {
  if (absoluteIterations !== undefined) return absoluteIterations;
  if (stepCount === undefined) return undefined;
  return (previousIterations ?? 0) + stepCount;
}
