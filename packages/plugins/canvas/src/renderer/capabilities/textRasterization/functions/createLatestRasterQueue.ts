import type { RasterQueueResult } from '../definitions/cardRasterization';

interface RasterJob<I, O> {
  readonly key: string;
  readonly input: I;
  readonly controller: AbortController;
  readonly resolve: (result: RasterQueueResult<O>) => void;
  superseded: boolean;
}

/**
 * 串行使用 DOM 光栅器。每张卡只保留最新请求；旧任务即使已经完成也不能覆盖新图。
 * 队列有界，离开视口后由调用方 cancel，不为屏外内容无限积压。
 */
export function createLatestRasterQueue<I, O>(options: {
  readonly execute: (input: I, signal: AbortSignal) => Promise<O>;
  readonly disposeResult: (output: O) => void;
  readonly capacity?: number;
}) {
  const capacity = options.capacity ?? 64;
  if (!Number.isInteger(capacity) || capacity < 1) throw new Error('raster_queue_capacity');
  const pending = new Map<string, RasterJob<I, O>>();
  let running: RasterJob<I, O> | null = null;
  let disposed = false;
  let peakPending = 0;
  let completed = 0;
  let discarded = 0;

  async function drain(): Promise<void> {
    if (running || disposed) return;
    const next = pending.values().next();
    if (next.done) return;
    const job = next.value;
    pending.delete(job.key);
    running = job;
    try {
      const value = await options.execute(job.input, job.controller.signal);
      if (job.superseded || job.controller.signal.aborted || disposed) {
        options.disposeResult(value);
        discarded++;
        job.resolve({ status: job.superseded ? 'superseded' : 'cancelled' });
      } else {
        completed++;
        job.resolve({ status: 'ready', value });
      }
    } catch (error) {
      job.resolve(job.superseded ? { status: 'superseded' }
        : job.controller.signal.aborted || disposed ? { status: 'cancelled' }
          : { status: 'failed', error });
    } finally {
      running = null;
      void drain();
    }
  }

  return {
    enqueue(key: string, input: I): Promise<RasterQueueResult<O>> {
      if (disposed) return Promise.resolve({ status: 'cancelled' });
      const previous = pending.get(key);
      if (previous) previous.resolve({ status: 'superseded' });
      pending.delete(key);
      if (running?.key === key) {
        running.superseded = true;
        running.controller.abort();
      }
      if (pending.size >= capacity) {
        const oldest = pending.values().next();
        if (!oldest.done) {
          pending.delete(oldest.value.key);
          oldest.value.resolve({ status: 'dropped' });
          discarded++;
        }
      }
      const result = new Promise<RasterQueueResult<O>>((resolve) => {
        pending.set(key, { key, input, resolve, controller: new AbortController(), superseded: false });
      });
      peakPending = Math.max(peakPending, pending.size);
      void drain();
      return result;
    },
    cancel(key: string): void {
      const job = pending.get(key);
      if (job) { pending.delete(key); job.resolve({ status: 'cancelled' }); }
      if (running?.key === key) running.controller.abort();
    },
    readStats() { return { pending: pending.size, running: running !== null, peakPending, completed, discarded }; },
    dispose(): void {
      disposed = true;
      running?.controller.abort();
      for (const job of pending.values()) job.resolve({ status: 'cancelled' });
      pending.clear();
    },
  };
}
