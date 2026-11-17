/** Worker 请求通道不认识业务；操作和 payload 的校验由创建任务的 owner 负责。 */
export interface WorkerHostFailure {
  readonly name: string;
  readonly message: string;
  readonly kind?: string;
  readonly code?: string;
  readonly retryable?: boolean;
  readonly statusCode?: number;
}

export interface WorkerHostRequestContext {
  readonly signal: AbortSignal;
  progress(value: unknown): void;
}

export interface WorkerHostRequestHandler {
  execute(operation: string, payload: unknown, context: WorkerHostRequestContext): Promise<unknown>;
  projectFailure(error: unknown): WorkerHostFailure;
}
