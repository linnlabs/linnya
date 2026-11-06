import {
  CANVAS_COMPUTATION_TIMEOUT_MS,
  CANVAS_COMPUTATION_QUEUE_LIMIT,
} from './definitions/canvasComputationLimits';
import type { CanvasComputationJob } from './definitions/canvasComputationJob';
import { createCanvasComputationJob } from './createCanvasComputationJob';
import { Worker } from 'node:worker_threads';
import { Logger } from '@plugin/backend/workspaceRuntime';
import type { CanvasComputationRuntime } from '../../../shared';
import type {
  CanvasComputationRequest,
  CanvasComputationResponse,
} from '../../orchestration/definitions/canvasComputationWorker';
/** 一个真实线程顺序消费有界待办，取消等待旧线程退出后再执行下一任务。 */
export function createCanvasComputationRuntime(options: {
  readonly workerPath: string;
  readonly timeoutMs?: number;
}): CanvasComputationRuntime {
  const pending: CanvasComputationJob[] = [];
  let running: { readonly worker: Worker; readonly cancel: () => void } | null = null;
  let reusable: Worker | null = null;
  let disposed = false;
  const logger = new Logger('CanvasComputation');
  function createWorker(): Worker {
    const worker = new Worker(options.workerPath);
    worker.on('error', error => {
      if (reusable === worker) reusable = null;
      if (running?.worker !== worker)
        logger.error('Canvas 空闲计算线程异常，下一任务重新创建', { error });
    });
    worker.once('exit', () => {
      if (reusable === worker) reusable = null;
    });
    return worker;
  }
  const drain = () => {
    if (disposed || running) return;
    const job = pending.shift();
    if (!job) return;
    // 正常任务复用已装入 ELK 的线程；取消/超时仍等旧线程终止后才接纳下一任务。
    const worker = reusable ?? createWorker();
    reusable = worker;
    worker.ref();
    const execution = createCanvasComputationJob({
      worker,
      job,
      timeoutMs: options.timeoutMs ?? CANVAS_COMPUTATION_TIMEOUT_MS,
      finished(reuse) {
        if (reuse) {
          worker.unref();
          running = null;
          drain();
        } else {
          reusable = null;
          void worker.terminate().finally(() => {
            running = null;
            drain();
          });
        }
      },
    });
    running = { worker, cancel: execution.cancel };
    execution.start();
  };
  const invoke = (
    request: CanvasComputationRequest,
    signal?: AbortSignal
  ): Promise<CanvasComputationResponse> => {
    signal?.throwIfAborted();
    if (disposed) return Promise.reject(new Error('canvas_layout_disposed'));
    if (pending.length >= CANVAS_COMPUTATION_QUEUE_LIMIT)
      return Promise.reject(new Error('canvas_layout_queue_full'));
    return new Promise<CanvasComputationResponse>((resolve, reject) => {
      const abort = () => {
        const index = pending.indexOf(job);
        if (index >= 0) {
          pending.splice(index, 1);
          job.removeAbort();
          reject(signal?.reason ?? new Error('canvas_layout_cancelled'));
        } else running?.cancel();
      };
      const job: CanvasComputationJob = {
        request,
        signal,
        resolve,
        reject,
        removeAbort: () => signal?.removeEventListener('abort', abort),
      };
      signal?.addEventListener('abort', abort, { once: true });
      pending.push(job);
      drain();
    });
  };
  return {
    async layout(request, signal) {
      const response = await invoke({ kind: 'layout', request }, signal);
      if (response.kind !== 'layout') throw new Error('canvas_computation_kind_mismatch');
      return response.result;
    },
    async check(snapshot, signal) {
      const response = await invoke({ kind: 'check', snapshot }, signal);
      if (response.kind !== 'check') throw new Error('canvas_computation_kind_mismatch');
      return response.result;
    },
    async dispose() {
      disposed = true;
      for (const job of pending.splice(0)) {
        job.removeAbort();
        job.reject(new Error('canvas_layout_disposed'));
      }
      const current = running;
      current?.cancel();
      const worker = current?.worker ?? reusable;
      reusable = null;
      if (worker) await worker.terminate();
    },
  };
}
