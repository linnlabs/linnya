export const DEFAULT_OFFICIAL_PLUGIN_CONCURRENCY = 3;

/**
 * 解析官方插件批量打包与冒烟的最大并发度，默认不超过 3 并随目标数收敛。
 */
export function resolveOfficialPluginConcurrency(rawValue, targetCount) {
  if (!Number.isInteger(targetCount) || targetCount < 0) {
    throw new Error(`Invalid official plugin target count: ${String(targetCount)}`);
  }

  let requested = DEFAULT_OFFICIAL_PLUGIN_CONCURRENCY;
  if (rawValue !== undefined) {
    const trimmed = String(rawValue).trim();
    if (trimmed !== '') {
      if (!/^[1-9]\d*$/u.test(trimmed)) {
        throw new Error(
          `LINNYA_OFFICIAL_PLUGIN_CONCURRENCY must be a positive integer, got: ${JSON.stringify(rawValue)}`,
        );
      }
      requested = Number(trimmed);
    }
  }

  return Math.min(requested, Math.max(1, targetCount));
}

/**
 * 按固定并发上限执行一组异步任务，并在任一任务失败后停止领取后续目标。
 */
export async function runBoundedParallel(items, concurrency, worker) {
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new Error(`Concurrency must be a positive integer, got: ${String(concurrency)}`);
  }
  if (items.length === 0) return [];

  const results = new Array(items.length);
  const workerCount = Math.min(concurrency, items.length);
  let nextIndex = 0;
  let aborted = false;

  async function runWorker() {
    while (!aborted) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      if (currentIndex >= items.length) return;
      try {
        results[currentIndex] = await worker(items[currentIndex], currentIndex);
      } catch (error) {
        aborted = true;
        throw error;
      }
    }
  }

  await Promise.all(Array.from({ length: workerCount }, () => runWorker()));
  return results;
}
