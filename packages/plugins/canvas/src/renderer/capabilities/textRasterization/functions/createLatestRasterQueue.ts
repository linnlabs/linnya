import type { RasterQueueResult } from '../definitions/cardRasterization';

interface RasterJob<I, O> {
  readonly key: string;
  readonly input: I;
  readonly controller: AbortController;
  readonly resolve: (result: RasterQueueResult<O>) => void;
  superseded: boolean;
}
type Execution<I, O> =
  | { readonly execute: (input: I, signal: AbortSignal) => Promise<O>; readonly executeBatch?: never; readonly batchSize?: never }
  | { readonly executeBatch: (inputs: readonly I[], signal: AbortSignal) => Promise<readonly O[]>; readonly batchSize: number; readonly execute?: never };

/** 有界最新任务队列；可把同一paint批次的卡串行交给一个DOM staging，绝不并行操作它。 */
export function createLatestRasterQueue<I, O>(options: Execution<I, O> & {
  readonly disposeResult: (output: O) => void;
  readonly capacity?: number;
}) {
  const capacity = options.capacity ?? 64, batchSize = options.batchSize ?? 1;
  if (!Number.isInteger(capacity) || capacity < 1 || !Number.isInteger(batchSize) || batchSize < 1 || batchSize > 64) throw new Error('raster_queue_capacity');
  const pending = new Map<string, RasterJob<I, O>>();
  let running: readonly RasterJob<I, O>[] = [];
  let group: AbortController | null = null;
  let disposed = false, peakPending = 0, completed = 0, discarded = 0;
  const abortGroupIfUnused = () => { if (running.length && running.every(job => job.controller.signal.aborted)) group?.abort(); };
  async function drain(): Promise<void> {
    if (running.length || disposed || !pending.size) return;
    const jobs = [...pending.values()].slice(0, batchSize);
    jobs.forEach(job => pending.delete(job.key)); running = jobs;
    const active = new AbortController(); group = active;
    try {
      const values = options.executeBatch ? await options.executeBatch(jobs.map(job => job.input), active.signal)
        : [await options.execute(jobs[0].input, active.signal)];
      if (values.length !== jobs.length) { values.forEach(options.disposeResult); throw new Error('raster_batch_result_count'); }
      jobs.forEach((job, index) => {
        const value = values[index];
        if (job.superseded || job.controller.signal.aborted || disposed) {
          options.disposeResult(value); discarded++; job.resolve({ status: job.superseded ? 'superseded' : 'cancelled' });
        } else { completed++; job.resolve({ status: 'ready', value }); }
      });
    } catch (error) {
      jobs.forEach(job => job.resolve(job.superseded ? { status: 'superseded' }
        : job.controller.signal.aborted || disposed ? { status: 'cancelled' } : { status: 'failed', error }));
    } finally { running = []; group = null; void drain(); }
  }
  return {
    enqueue(key: string, input: I): Promise<RasterQueueResult<O>> {
      if (disposed) return Promise.resolve({ status: 'cancelled' });
      const previous = pending.get(key); if (previous) previous.resolve({ status: 'superseded' }); pending.delete(key);
      for (const job of running) if (job.key === key) { job.superseded = true; job.controller.abort(); }
      abortGroupIfUnused();
      if (pending.size >= capacity) {
        const oldest = pending.values().next();
        if (!oldest.done) { pending.delete(oldest.value.key); oldest.value.resolve({ status: 'dropped' }); discarded++; }
      }
      const result = new Promise<RasterQueueResult<O>>(resolve => pending.set(key, { key, input, resolve, controller: new AbortController(), superseded: false }));
      peakPending = Math.max(peakPending, pending.size); void drain(); return result;
    },
    cancel(key: string): void {
      const job = pending.get(key); if (job) { pending.delete(key); job.resolve({ status: 'cancelled' }); }
      for (const active of running) if (active.key === key) active.controller.abort(); abortGroupIfUnused();
    },
    readStats() { return { pending: pending.size, running: running.length > 0, peakPending, completed, discarded }; },
    dispose(): void {
      disposed = true; running.forEach(job => job.controller.abort()); group?.abort();
      for (const job of pending.values()) job.resolve({ status: 'cancelled' }); pending.clear();
    },
  };
}
