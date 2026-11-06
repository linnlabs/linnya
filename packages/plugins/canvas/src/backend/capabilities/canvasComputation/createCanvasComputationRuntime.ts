import { CANVAS_COMPUTATION_TIMEOUT_MS, CANVAS_COMPUTATION_QUEUE_LIMIT } from './definitions/canvasComputationLimits';
import { Worker } from 'node:worker_threads';
import { Logger } from '@plugin/backend/workspaceRuntime';
import type { CanvasComputationRuntime } from '../../../shared';
import { CanvasComputationWorkerResponseSchema, type CanvasComputationRequest, type CanvasComputationResponse } from '../../orchestration/definitions/canvasComputationWorker';

interface Job {
  readonly request: CanvasComputationRequest;
  readonly signal?: AbortSignal;
  readonly resolve: (result: CanvasComputationResponse) => void;
  readonly reject: (error: unknown) => void;
  readonly removeAbort: () => void;
}
function matchesRequest(request: CanvasComputationRequest, response: CanvasComputationResponse): boolean {
  const sequence = request.kind === 'layout' ? request.request.snapshot.sequence : request.snapshot.sequence;
  if (response.kind !== request.kind || response.result.sequence !== sequence) return false;
  if (response.kind !== 'layout' || request.kind !== 'layout') return true;
  const execution = response.result.computation;
  return execution.requestId === request.request.requestId && execution.sequence === sequence && execution.algorithm === request.request.algorithm;
}
/** 一次只有一个真实worker；取消终止计算，待办有界，不让ELK占住Backend事件循环。 */
export function createCanvasComputationRuntime(options: { readonly workerPath: string; readonly timeoutMs?: number }): CanvasComputationRuntime {
  const pending: Job[] = [];
  let running: { readonly worker: Worker; readonly cancel: () => void } | null = null;
  let reusable: Worker | null = null;
  let disposed = false;
  const logger = new Logger('CanvasComputation');
  function createWorker(): Worker {
    const worker = new Worker(options.workerPath);
    worker.on('error', error => {
      if (reusable === worker) reusable = null;
      if (running?.worker !== worker) logger.error('Canvas 空闲计算线程异常，下一任务重新创建', { error });
    });
    worker.once('exit', () => { if (reusable === worker) reusable = null; });
    return worker;
  }
  const drain = () => {
    if (disposed || running) return;
    const job = pending.shift(); if (!job) return;
    // 正常任务复用已装入 ELK 的线程；取消/超时仍等旧线程终止后才接纳下一任务。
    const worker = reusable ?? createWorker();
    reusable = worker; worker.ref();
    let settled = false;
    const settle = (result: CanvasComputationResponse | null, error?: unknown, reuse = false) => {
      if (settled) return; settled = true; clearTimeout(timeout); job.removeAbort();
      worker.removeListener('message', message); worker.removeListener('error', failed); worker.removeListener('exit', exited);
      if (result) job.resolve(result); else job.reject(error);
      if (reuse) { worker.unref(); running = null; drain(); }
      else {
        reusable = null;
        void worker.terminate().finally(() => { running = null; drain(); });
      }
    };
    const timeout = setTimeout(() => settle(null, new Error('canvas_layout_timeout')), options.timeoutMs ?? CANVAS_COMPUTATION_TIMEOUT_MS);
    running = { worker, cancel: () => settle(null, job.signal?.reason ?? new Error('canvas_layout_cancelled')) };
    const message = (value: unknown) => {
      try {
        const response = CanvasComputationWorkerResponseSchema.parse(value);
        if (response.status === 'failed') settle(null, new Error(response.message), true);
        else if (!matchesRequest(job.request, response.response)) settle(null, new Error('canvas_computation_identity_mismatch'));
        else settle(response.response, undefined, true);
      } catch (error) { settle(null, error); }
    };
    const failed = (error: Error) => settle(null, error);
    const exited = (code: number) => settle(null, new Error(`canvas_layout_worker_exit:${code}`));
    worker.once('message', message);
    worker.once('error', failed);
    worker.once('exit', exited);
    worker.postMessage(job.request);
  };
  const invoke = (request: CanvasComputationRequest, signal?: AbortSignal): Promise<CanvasComputationResponse> => {
      signal?.throwIfAborted();
      if (disposed) return Promise.reject(new Error('canvas_layout_disposed'));
      if (pending.length >= CANVAS_COMPUTATION_QUEUE_LIMIT) return Promise.reject(new Error('canvas_layout_queue_full'));
      return new Promise<CanvasComputationResponse>((resolve, reject) => {
        const abort = () => {
          const index = pending.indexOf(job);
          if (index >= 0) { pending.splice(index, 1); job.removeAbort(); reject(signal?.reason ?? new Error('canvas_layout_cancelled')); }
          else running?.cancel();
        };
        const job: Job = { request, signal, resolve, reject, removeAbort: () => signal?.removeEventListener('abort', abort) };
        signal?.addEventListener('abort', abort, { once: true }); pending.push(job); drain();
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
      for (const job of pending.splice(0)) { job.removeAbort(); job.reject(new Error('canvas_layout_disposed')); }
      const current = running; current?.cancel();
      const worker = current?.worker ?? reusable; reusable = null;
      if (worker) await worker.terminate();
    },
  };
}
