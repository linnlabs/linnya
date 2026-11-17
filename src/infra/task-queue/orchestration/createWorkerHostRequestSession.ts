import type { WorkerHostRequestHandler } from '@linnya/plugin-host-contract/backend/workerRequests';

/** 每个 Worker 一个 owner；退出/取消会中止并等待它发出的 Host 请求。 */
export function createWorkerHostRequestSession(
  handler: WorkerHostRequestHandler,
  post: (message: unknown) => void,
) {
  const requests = new Map<string, { controller: AbortController; completed: Promise<void> }>();
  let accepting = true;
  let responding = true;
  let stopping: Promise<void> | undefined;

  function abort(): void {
    accepting = false;
    for (const request of requests.values()) request.controller.abort();
  }

  function stop(): Promise<void> {
    if (stopping) return stopping;
    abort();
    responding = false;
    stopping = Promise.all([...requests.values()].map(request => request.completed)).then(() => undefined);
    return stopping;
  }

  function handle(message: unknown): boolean {
    if (typeof message !== 'object' || message === null || !('type' in message)) return false;
    if (message.type !== 'host-request' && message.type !== 'host-cancel') return false;
    if (!('requestId' in message) || typeof message.requestId !== 'string' || !message.requestId) {
      throw new Error('Worker Host 请求缺少 requestId');
    }
    const requestId = message.requestId;
    if (message.type === 'host-cancel') {
      requests.get(requestId)?.controller.abort();
      return true;
    }
    if (!('operation' in message) || typeof message.operation !== 'string' || !('payload' in message)) {
      throw new Error('Worker Host 请求缺少 operation/payload');
    }
    if (!accepting) throw new Error('Worker Host 请求通道正在关闭');
    if (requests.has(requestId)) throw new Error('Worker Host requestId 已在执行');
    const controller = new AbortController();
    const operation = message.operation;
    const payload = message.payload;
    // 先登记，后开始调用；同步失败也进入同一收尾路径。
    const completed = Promise.resolve().then(async () => {
      try {
        const result = await handler.execute(operation, payload, {
          signal: controller.signal,
          progress: value => {
            if (responding && !controller.signal.aborted) post({ type: 'host-progress', requestId, value });
          },
        });
        if (responding) post({ type: 'host-result', requestId, result });
      } catch (error) {
        if (responding) post({ type: 'host-failure', requestId, error: handler.projectFailure(error) });
      } finally {
        requests.delete(requestId);
      }
    });
    requests.set(requestId, { controller, completed });
    return true;
  }

  return { handle, abort, stop };
}
