import { setImmediate as yieldToEventLoop } from 'node:timers/promises';

export interface FreePageReclaimTarget {
  reclaimFreePages(maxPages: number): number;
  readFreePageCount(): number;
}

export interface FreePageReclaimPolicy {
  /** 空闲页少于此值时不处理：少量空闲页会被后续写入直接复用，归还后再增长反而多一次文件扩展。 */
  readonly minimumFreePages: number;
  /** 归还后保留的空闲页。 */
  readonly retainedFreePages: number;
  /** 每个写事务最多归还的页数；批次之间让出事件循环，不长时间占用写锁。 */
  readonly batchPages: number;
}

/** 4KB 页时：超过 8MB 空闲才回收，回收到剩 2MB，每批 8MB。 */
export const DEFAULT_FREE_PAGE_RECLAIM_POLICY: FreePageReclaimPolicy = Object.freeze({
  minimumFreePages: 2048,
  retainedFreePages: 512,
  batchPages: 2048,
});

/**
 * 分批把数据库空闲页归还给文件系统，返回归还的总页数。
 *
 * 只对开启增量回收（auto_vacuum = INCREMENTAL）的库有效；其他库 `reclaimFreePages` 返回 0，
 * 这里随即结束。取消信号在批次之间检查，已开始的批次是一个完整短事务。
 */
export async function reclaimFreePagesInBatches(
  target: FreePageReclaimTarget,
  signal: AbortSignal,
  policy: FreePageReclaimPolicy = DEFAULT_FREE_PAGE_RECLAIM_POLICY,
): Promise<number> {
  if (target.readFreePageCount() < policy.minimumFreePages) return 0;
  let reclaimed = 0;
  while (!signal.aborted) {
    const excess = target.readFreePageCount() - policy.retainedFreePages;
    if (excess <= 0) break;
    const freed = target.reclaimFreePages(Math.min(excess, policy.batchPages));
    if (freed <= 0) break;
    reclaimed += freed;
    await yieldToEventLoop();
  }
  return reclaimed;
}
