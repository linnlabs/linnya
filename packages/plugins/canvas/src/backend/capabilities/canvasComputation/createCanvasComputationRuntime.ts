import { Worker } from 'node:worker_threads';
import type { CanvasLayoutRequest, CanvasLayoutResult, CanvasComputationRuntime } from '../../../shared';
import { CanvasLayoutWorkerResponseSchema } from '../../orchestration/definitions/canvasComputationWorker';

interface Job {
  readonly request: CanvasLayoutRequest;
  readonly signal?: AbortSignal;
  readonly resolve: (result: CanvasLayoutResult) => void;
  readonly reject: (error: unknown) => void;
  readonly removeAbort: () => void;
}
/** 一次只有一个真实worker；取消终止计算，待办有界，不让ELK占住Backend事件循环。 */
export function createCanvasComputationRuntime(options: { readonly workerPath: string; readonly timeoutMs?: number }): CanvasComputationRuntime {
  const pending: Job[] = [];
  let running: { readonly worker: Worker; readonly cancel: () => void } | null = null;
  let disposed = false;
  const drain = () => {
    if (disposed || running) return;
    const job = pending.shift(); if (!job) return;
    const worker = new Worker(options.workerPath);
    let settled = false;
    const settle = (result: CanvasLayoutResult | null, error?: unknown) => {
      if (settled) return; settled = true; clearTimeout(timeout); job.removeAbort();
      if (result) job.resolve(result); else job.reject(error);
      void worker.terminate().finally(() => { running = null; drain(); });
    };
    const timeout = setTimeout(() => settle(null, new Error('canvas_layout_timeout')), options.timeoutMs ?? 30000);
    running = { worker, cancel: () => settle(null, job.signal?.reason ?? new Error('canvas_layout_cancelled')) };
    worker.once('message', (value: unknown) => {
      try {
        const response = CanvasLayoutWorkerResponseSchema.parse(value);
        if (response.status === 'failed') settle(null, new Error(response.message));
        else if (response.result.sequence !== job.request.snapshot.sequence) settle(null, new Error('canvas_layout_sequence_mismatch'));
        else settle(response.result);
      } catch (error) { settle(null, error); }
    });
    worker.once('error', error => settle(null, error));
    worker.once('exit', code => { if (!settled) settle(null, new Error(`canvas_layout_worker_exit:${code}`)); });
    worker.postMessage(job.request);
  };
  return {
    layout(request, signal) {
      signal?.throwIfAborted();
      if (disposed) return Promise.reject(new Error('canvas_layout_disposed'));
      if (pending.length >= 8) return Promise.reject(new Error('canvas_layout_queue_full'));
      return new Promise<CanvasLayoutResult>((resolve, reject) => {
        const abort = () => {
          const index = pending.indexOf(job);
          if (index >= 0) { pending.splice(index, 1); job.removeAbort(); reject(signal?.reason ?? new Error('canvas_layout_cancelled')); }
          else running?.cancel();
        };
        const job: Job = { request, signal, resolve, reject, removeAbort: () => signal?.removeEventListener('abort', abort) };
        signal?.addEventListener('abort', abort, { once: true }); pending.push(job); drain();
      });
    },
    async dispose() {
      disposed = true;
      for (const job of pending.splice(0)) { job.removeAbort(); job.reject(new Error('canvas_layout_disposed')); }
      const current = running; current?.cancel(); if (current) await current.worker.terminate();
    },
  };
}
