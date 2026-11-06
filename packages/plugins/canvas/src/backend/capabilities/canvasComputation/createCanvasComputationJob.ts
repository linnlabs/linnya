import {
  CanvasComputationWorkerResponseSchema,
  type CanvasComputationRequest,
  type CanvasComputationResponse,
} from '../../orchestration/definitions/canvasComputationWorker';
import type { CanvasComputationJobOptions } from './definitions/canvasComputationJob';
function matchesRequest(
  request: CanvasComputationRequest,
  response: CanvasComputationResponse
): boolean {
  const sequence =
    request.kind === 'layout' ? request.request.snapshot.sequence : request.snapshot.sequence;
  if (response.kind !== request.kind || response.result.sequence !== sequence) return false;
  if (response.kind !== 'layout' || request.kind !== 'layout') return true;
  const execution = response.result.computation;
  return (
    execution.requestId === request.request.requestId &&
    execution.sequence === sequence &&
    execution.algorithm === request.request.algorithm
  );
}
/** 单个任务拥有其timer/listeners；线程是否回池由运行态决定。 */
export function createCanvasComputationJob(options: CanvasComputationJobOptions) {
  const { worker, job } = options;
  let settled = false;
  const settle = (result: CanvasComputationResponse | null, error?: unknown, reuse = false) => {
    if (settled) return;
    settled = true;
    clearTimeout(timeout);
    job.removeAbort();
    worker.removeListener('message', message);
    worker.removeListener('error', failed);
    worker.removeListener('exit', exited);
    if (result) job.resolve(result);
    else job.reject(error);
    options.finished(reuse);
  };
  const timeout = setTimeout(
    () => settle(null, new Error('canvas_layout_timeout')),
    options.timeoutMs
  );
  const message = (value: unknown) => {
    try {
      const response = CanvasComputationWorkerResponseSchema.parse(value);
      if (response.status === 'failed') settle(null, new Error(response.message), true);
      else if (!matchesRequest(job.request, response.response))
        settle(null, new Error('canvas_computation_identity_mismatch'));
      else settle(response.response, undefined, true);
    } catch (error) {
      settle(null, error);
    }
  };
  const failed = (error: Error) => settle(null, error);
  const exited = (code: number) => settle(null, new Error(`canvas_layout_worker_exit:${code}`));
  return {
    cancel: () => settle(null, job.signal?.reason ?? new Error('canvas_layout_cancelled')),
    start() {
      worker.once('message', message);
      worker.once('error', failed);
      worker.once('exit', exited);
      worker.postMessage(job.request);
    },
  };
}
