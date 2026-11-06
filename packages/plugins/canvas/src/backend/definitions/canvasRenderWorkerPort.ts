import type { CanvasWorkerRequest, CanvasWorkerResult } from '../../shared/rendering';

export interface CanvasRenderWorkerPort {
  invoke(
    workerId: string,
    request: CanvasWorkerRequest,
    options?: { readonly signal?: AbortSignal }
  ): Promise<unknown>;
}
export class CanvasRenderingError extends Error {
  constructor(
    readonly code: Extract<CanvasWorkerResult, { status: 'failure' }>['code'] | 'invalid_result',
    message: string
  ) {
    super(message);
    this.name = 'CanvasRenderingError';
  }
}
