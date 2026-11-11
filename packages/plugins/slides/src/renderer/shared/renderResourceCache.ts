import type { RenderResourceBudget, SettledRenderResourceEntry } from './definitions/renderResourceCache';

/** 只移除最旧的已完成引用；进行中与本次资源继续留在各自 feature 的 Map 中。 */
export function evictSettledRenderResources<Entry extends SettledRenderResourceEntry>(
  entries: Map<string, Entry>,
  protectedKey: string,
  budget: RenderResourceBudget,
): number {
  let decodedBytes = budget.decodedBytes;
  while (entries.size > budget.maxEntries || decodedBytes > budget.maxDecodedBytes) {
    const candidate = Array.from(entries.values()).find(entry => (
      entry.cacheKey !== protectedKey && entry.loaded !== null
    ));
    if (!candidate) return decodedBytes;
    decodedBytes -= candidate.decodedBytes;
    entries.delete(candidate.cacheKey);
  }
  return decodedBytes;
}

/** 取消只结束消费者的等待，不把 signal 传给所有消费者共享的资源任务。 */
export function waitForResourceConsumer<T>(pending: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return pending;
  signal.throwIfAborted();
  return new Promise<T>((resolve, reject) => {
    const abort = (): void => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    pending.then(
      value => { signal.removeEventListener('abort', abort); resolve(value); },
      (error: unknown) => { signal.removeEventListener('abort', abort); reject(error); },
    );
  });
}
