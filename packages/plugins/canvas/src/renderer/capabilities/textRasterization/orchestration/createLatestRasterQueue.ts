import type { RasterQueueResult } from '../definitions/cardRasterization';
import type { RasterJob, LatestRasterQueueOptions } from '../definitions/rasterQueue';
import {
  readRasterQueueLimits,
  selectRasterQueueBatch,
  prioritizeRasterQueue,
} from '../functions/planRasterQueueBatch';
import { settleRasterQueueBatch, failRasterQueueBatch } from './settleRasterQueueBatch';

/** 有界最新任务队列；可把同一paint批次的卡串行交给一个DOM staging，绝不并行操作它。 */
export function createLatestRasterQueue<I, O>(options: LatestRasterQueueOptions<I, O>) {
  const { capacity, batchSize } = readRasterQueueLimits(options);
  const pending = new Map<string, RasterJob<I, O>>();
  let running: readonly RasterJob<I, O>[] = [];
  let group: AbortController | null = null;
  const completion = { disposed: false, completed: 0, discarded: 0 };
  let peakPending = 0,
    peakBatchSize = 0;
  let scheduled: ReturnType<typeof setTimeout> | null = null;
  const scheduleDrain = () => {
    if (scheduled !== null || completion.disposed) return;
    // DOM创建/测高不能接在同步场景投影和身份牌准备的微任务链后，形成一个连续长任务。
    scheduled = setTimeout(() => {
      scheduled = null;
      void drain();
    }, 0);
  };
  const abortGroupIfUnused = () => {
    if (running.length && running.every(job => job.controller.signal.aborted)) group?.abort();
  };
  async function drain(): Promise<void> {
    if (running.length || completion.disposed || !pending.size) return;
    const jobs = selectRasterQueueBatch(pending, batchSize, options.readBatchSize);
    jobs.forEach(job => pending.delete(job.key));
    running = jobs;
    peakBatchSize = Math.max(peakBatchSize, jobs.length);
    const active = new AbortController();
    group = active;
    try {
      const values = options.executeBatch
        ? await options.executeBatch(
            jobs.map(job => job.input),
            active.signal
          )
        : [await options.execute(jobs[0].input, active.signal)];
      settleRasterQueueBatch(jobs, values, options.disposeResult, completion);
    } catch (error) {
      failRasterQueueBatch(jobs, error, completion.disposed);
    } finally {
      running = [];
      group = null;
      scheduleDrain();
    }
  }
  return {
    enqueue(key: string, input: I): Promise<RasterQueueResult<O>> {
      if (completion.disposed) return Promise.resolve({ status: 'cancelled' });
      const previous = pending.get(key);
      if (previous) previous.resolve({ status: 'superseded' });
      pending.delete(key);
      for (const job of running)
        if (job.key === key) {
          job.superseded = true;
          job.controller.abort();
        }
      abortGroupIfUnused();
      if (pending.size >= capacity) {
        const oldest = pending.values().next();
        if (!oldest.done) {
          pending.delete(oldest.value.key);
          oldest.value.resolve({ status: 'dropped' });
          completion.discarded++;
        }
      }
      const result = new Promise<RasterQueueResult<O>>(resolve =>
        pending.set(key, {
          key,
          input,
          resolve,
          controller: new AbortController(),
          superseded: false,
        })
      );
      peakPending = Math.max(peakPending, pending.size);
      scheduleDrain();
      return result;
    },
    prioritize(keys: readonly string[]): void {
      prioritizeRasterQueue(pending, keys);
    },
    cancel(key: string): void {
      const job = pending.get(key);
      if (job) {
        pending.delete(key);
        job.resolve({ status: 'cancelled' });
      }
      for (const active of running) if (active.key === key) active.controller.abort();
      abortGroupIfUnused();
    },
    readStats() {
      return {
        pending: pending.size,
        running: running.length > 0,
        peakPending,
        peakBatchSize,
        capacity,
        batchSize,
        completed: completion.completed,
        discarded: completion.discarded,
      };
    },
    dispose(): void {
      completion.disposed = true;
      running.forEach(job => job.controller.abort());
      group?.abort();
      if (scheduled !== null) {
        clearTimeout(scheduled);
        scheduled = null;
      }
      for (const job of pending.values()) job.resolve({ status: 'cancelled' });
      pending.clear();
    },
  };
}
