import type { RasterJob } from '../definitions/rasterQueue';

export function readRasterQueueLimits(options: {
  readonly capacity?: number;
  readonly batchSize?: number;
}) {
  const capacity = options.capacity ?? 64,
    batchSize = options.batchSize ?? 1;
  if (
    !Number.isInteger(capacity) ||
    capacity < 1 ||
    !Number.isInteger(batchSize) ||
    batchSize < 1 ||
    batchSize > 64
  )
    throw new Error('raster_queue_capacity');
  return { capacity, batchSize };
}

/** 在本次drain开始时冻结优先队列及移动预算，不改变执行期间的任务批次。 */
export function selectRasterQueueBatch<I, O>(
  pending: ReadonlyMap<string, RasterJob<I, O>>,
  batchSize: number,
  readBatchSize?: (inputs: readonly I[]) => number
): RasterJob<I, O>[] {
  const candidates = [...pending.values()].slice(0, batchSize);
  const limit = Math.max(
    1,
    Math.min(batchSize, Math.floor(readBatchSize?.(candidates.map(job => job.input)) ?? batchSize))
  );
  return candidates.slice(0, limit);
}

/** 优先项仍按调用方顺序，同批其余任务保持原 Map 顺序。 */
export function prioritizeRasterQueue<I, O>(
  pending: Map<string, RasterJob<I, O>>,
  keys: readonly string[]
): void {
  const ordered = keys.flatMap(key => {
    const job = pending.get(key);
    return job ? [job] : [];
  });
  for (const job of ordered) pending.delete(job.key);
  const tail = [...pending.values()];
  pending.clear();
  for (const job of [...ordered, ...tail]) pending.set(job.key, job);
}
