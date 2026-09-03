import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  WebPageRenderParams,
  WebPageRenderResult,
} from '../../tools/web/webread/definitions/webPageRenderer';
import { WebPageRenderManager } from './WebPageRenderManager';

function deferred<T>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
} {
  let resolvePromise: ((value: T) => void) | undefined;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: (value) => resolvePromise?.(value) };
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

class ControlledWorker {
  readonly calls: WebPageRenderParams[] = [];
  readonly pending: Array<ReturnType<typeof deferred<WebPageRenderResult>>> = [];
  disposeCount = 0;

  render(params: WebPageRenderParams): Promise<WebPageRenderResult> {
    this.calls.push(params);
    const result = deferred<WebPageRenderResult>();
    this.pending.push(result);
    return result.promise;
  }

  async dispose(): Promise<void> {
    this.disposeCount += 1;
  }
}

afterEach(() => {
  vi.useRealTimers();
});

describe('WebPageRenderManager', () => {
  it('默认单并发：第二个任务等待首个任务释放同一 worker', async () => {
    const worker = new ControlledWorker();
    const manager = new WebPageRenderManager({ createWorker: () => worker });
    const first = manager.render({ url: 'https://example.com/one' });
    const second = manager.render({ url: 'https://example.com/two' });

    await vi.waitFor(() => expect(worker.calls).toHaveLength(1));
    worker.pending[0]?.resolve({ html: 'one', finalUrl: 'https://example.com/one' });
    await first;
    await vi.waitFor(() => expect(worker.calls).toHaveLength(2));
    worker.pending[1]?.resolve({ html: 'two', finalUrl: 'https://example.com/two' });
    await second;
    await manager.dispose();
  });

  it('排队中的任务取消后不占用 worker', async () => {
    const worker = new ControlledWorker();
    const manager = new WebPageRenderManager({ createWorker: () => worker });
    const first = manager.render({ url: 'https://example.com/one' });
    const controller = new AbortController();
    const queued = manager.render({ url: 'https://example.com/two', signal: controller.signal });
    controller.abort();

    await expect(queued).rejects.toEqual(expect.objectContaining({ kind: 'aborted' }));
    worker.pending[0]?.resolve({ html: 'one', finalUrl: 'https://example.com/one' });
    await first;
    expect(worker.calls).toHaveLength(1);
    await manager.dispose();
  });

  it('idle 到期回收隐藏 worker，下一任务按需重建', async () => {
    vi.useFakeTimers();
    const workers: ControlledWorker[] = [];
    const manager = new WebPageRenderManager({
      idleTimeoutMs: 100,
      createWorker: () => {
        const worker = new ControlledWorker();
        workers.push(worker);
        return worker;
      },
    });
    const first = manager.render({ url: 'https://example.com/one' });
    await flushMicrotasks();
    expect(workers[0]?.pending).toHaveLength(1);
    workers[0]?.pending[0]?.resolve({ html: 'one', finalUrl: 'https://example.com/one' });
    await first;
    await vi.advanceTimersByTimeAsync(100);
    expect(workers[0]?.disposeCount).toBe(1);

    const second = manager.render({ url: 'https://example.com/two' });
    await flushMicrotasks();
    expect(workers).toHaveLength(2);
    expect(workers[1]?.pending).toHaveLength(1);
    workers[1]?.pending[0]?.resolve({ html: 'two', finalUrl: 'https://example.com/two' });
    await second;
    await manager.dispose();
  });
});
