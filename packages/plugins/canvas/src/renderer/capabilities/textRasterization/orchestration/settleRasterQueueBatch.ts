import type { RasterJob, RasterQueueCompletion } from '../definitions/rasterQueue';

/** 结算保持同步：统计和资源释放必须先于任务Promise的观察者执行。 */
export function settleRasterQueueBatch<I, O>(
  jobs: readonly RasterJob<I, O>[],
  values: readonly O[],
  disposeResult: (value: O) => void,
  completion: RasterQueueCompletion
): void {
  if (values.length !== jobs.length) {
    values.forEach(disposeResult);
    throw new Error('raster_batch_result_count');
  }
  jobs.forEach((job, index) => {
    const value = values[index];
    if (job.superseded || job.controller.signal.aborted || completion.disposed) {
      disposeResult(value);
      completion.discarded++;
      job.resolve({ status: job.superseded ? 'superseded' : 'cancelled' });
    } else {
      completion.completed++;
      job.resolve({ status: 'ready', value });
    }
  });
}

export function failRasterQueueBatch<I, O>(
  jobs: readonly RasterJob<I, O>[],
  error: unknown,
  disposed: boolean
): void {
  jobs.forEach(job =>
    job.resolve(
      job.superseded
        ? { status: 'superseded' }
        : job.controller.signal.aborted || disposed
          ? { status: 'cancelled' }
          : { status: 'failed', error }
    )
  );
}
