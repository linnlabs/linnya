import type { Worker } from 'node:worker_threads';
import type {
  CanvasComputationRequest,
  CanvasComputationResponse,
} from '../../../orchestration/definitions/canvasComputationWorker';
export interface CanvasComputationJob {
  readonly request: CanvasComputationRequest;
  readonly signal?: AbortSignal;
  readonly resolve: (result: CanvasComputationResponse) => void;
  readonly reject: (error: unknown) => void;
  readonly removeAbort: () => void;
}
export interface CanvasComputationJobOptions {
  readonly worker: Worker;
  readonly job: CanvasComputationJob;
  readonly timeoutMs: number;
  readonly finished: (reuse: boolean) => void;
}
