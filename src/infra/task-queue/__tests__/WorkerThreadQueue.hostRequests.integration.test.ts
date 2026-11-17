import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { WorkerThreadQueue } from '../WorkerThreadQueue';

const workerScript = fileURLToPath(new URL('./fixtures/hostRequest.worker.cjs', import.meta.url));
type Payload = { taskId: string; operation: string; exitEarly?: boolean };

function completion(queue: WorkerThreadQueue<Payload>) {
  return new Promise<unknown>((resolve, reject) => {
    queue.once('taskCompleted', ({ result }: { result: unknown }) => resolve(result));
    queue.once('taskFailed', ({ error }: { error: string }) => reject(new Error(error)));
  });
}

describe('owned worker Host requests', () => {
  it('返回当前任务的结果和领域失败，不把 Host 对象交给 Worker', async () => {
    const queue = new WorkerThreadQueue<Payload>({
      workerScript,
      hostRequestHandler: job => ({
        async execute(operation, payload) {
          expect(payload).toEqual({ taskId: job.id });
          if (operation === 'fail') throw new Error('上游暂时不可用');
          return { vectors: [[1, 2]], spaceId: 'space-1' };
        },
        projectFailure: error => ({ name: 'EmbeddingFailure', kind: 'provider', code: 'provider_http_503',
          retryable: true, message: error instanceof Error ? error.message : String(error) }),
      }),
    });
    try {
      let done = completion(queue);
      await queue.addTask({ taskId: 'success', operation: 'embed' });
      await expect(done).resolves.toEqual({ type: 'host-result', requestId: 'request-1',
        result: { vectors: [[1, 2]], spaceId: 'space-1' } });
      done = completion(queue);
      await queue.addTask({ taskId: 'failure', operation: 'fail' });
      await expect(done).resolves.toMatchObject({ type: 'host-failure', error: {
        kind: 'provider', retryable: true, code: 'provider_http_503', message: '上游暂时不可用',
      } });
    } finally { await queue.shutdown(); }
  });

  for (const mode of ['cancel', 'exit', 'shutdown'] as const) {
    it(`${mode} 中止并收口仍在执行的 Host 请求`, async () => {
      let started: (() => void) | undefined;
      const ready = new Promise<void>(resolve => { started = resolve; });
      let settled = false;
      const queue = new WorkerThreadQueue<Payload>({
        workerScript,
        hostRequestHandler: () => ({
          async execute(_operation, _payload, { signal }) {
            started?.();
            await new Promise<void>(resolve => {
              if (signal.aborted) resolve();
              else signal.addEventListener('abort', () => resolve(), { once: true });
            });
            settled = true;
            throw new Error('已取消');
          },
          projectFailure: () => ({ name: 'AbortError', message: '已取消', retryable: false }),
        }),
      });
      const exited = new Promise<void>(resolve => queue.once('taskFailed', () => resolve()));
      try {
        await queue.addTask({ taskId: mode, operation: 'wait', exitEarly: mode === 'exit' });
        await ready;
        if (mode === 'cancel') expect(await queue.cancelTask(mode)).toBe(true);
        if (mode === 'exit') await exited;
        await queue.shutdown();
        expect(settled).toBe(true);
      } finally { await queue.shutdown(); }
    });
  }
});
