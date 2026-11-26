import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  WebPageRenderParams,
  WebPageRenderResult,
} from '../../tools/web/webread/definitions/webPageRenderer';
import type {
  WebPageRenderMainFrameResponse,
  WebPageRenderResponseDecision,
  WebPageRenderRuntime,
  WebPageRenderSession,
  WebPageRenderWindow,
} from './definitions/webPageRenderRuntime';
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

function rendered(html: string, finalUrl: string): WebPageRenderResult {
  return { html, finalUrl, mainResponse: { status: 200, headers: {} } };
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
    worker.pending[0]?.resolve(rendered('one', 'https://example.com/one'));
    await first;
    await vi.waitFor(() => expect(worker.calls).toHaveLength(2));
    worker.pending[1]?.resolve(rendered('two', 'https://example.com/two'));
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
    worker.pending[0]?.resolve(rendered('one', 'https://example.com/one'));
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
    workers[0]?.pending[0]?.resolve(rendered('one', 'https://example.com/one'));
    await first;
    await vi.advanceTimersByTimeAsync(100);
    expect(workers[0]?.disposeCount).toBe(1);

    const second = manager.render({ url: 'https://example.com/two' });
    await flushMicrotasks();
    expect(workers).toHaveLength(2);
    expect(workers[1]?.pending).toHaveLength(1);
    workers[1]?.pending[0]?.resolve(rendered('two', 'https://example.com/two'));
    await second;
    await manager.dispose();
  });

  it('闲置清理完成后直接交给最早未取消的读取', async () => {
    vi.useFakeTimers();
    const cleaned = deferred<void>();
    const worker = new ControlledWorker();
    const manager = new WebPageRenderManager({ idleTimeoutMs: 100, createWorker: () => worker });
    vi.spyOn(worker, 'dispose').mockReturnValueOnce(cleaned.promise);
    const first = manager.render({ url: 'https://example.com/first' });
    await flushMicrotasks();
    worker.pending[0]?.resolve(rendered('first', 'https://example.com/first'));
    await first;
    await vi.advanceTimersByTimeAsync(100);
    const controller = new AbortController();
    const cancelled = manager.render({ url: 'https://example.com/a', signal: controller.signal });
    const next = manager.render({ url: 'https://example.com/b' });
    controller.abort();
    await expect(cancelled).rejects.toMatchObject({ kind: 'aborted' });
    expect(worker.calls).toHaveLength(1);
    cleaned.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(worker.calls.map(call => call.url)).toEqual(['https://example.com/first', 'https://example.com/b']);
    worker.pending[1]?.resolve(rendered('b', 'https://example.com/b'));
    await next;
    await manager.dispose();
  });

  it('按槽位分配固定 partition（slot-0 / slot-1），空闲回收重建仍复用同一槽位 partition', async () => {
    vi.useFakeTimers();
    const assignedPartitions: string[] = [];
    const workers: ControlledWorker[] = [];
    const manager = new WebPageRenderManager({
      maxConcurrency: 2,
      idleTimeoutMs: 100,
      createWorker: ({ partition }) => {
        assignedPartitions.push(partition);
        const worker = new ControlledWorker();
        workers.push(worker);
        return worker;
      },
    });

    const p1 = manager.render({ url: 'https://example.com/a' });
    const p2 = manager.render({ url: 'https://example.com/b' });
    await flushMicrotasks();
    expect(assignedPartitions).toEqual(['web-render:slot-0', 'web-render:slot-1']);
    workers[0]?.pending[0]?.resolve(rendered('a', 'https://example.com/a'));
    workers[1]?.pending[0]?.resolve(rendered('b', 'https://example.com/b'));
    await Promise.all([p1, p2]);

    await vi.advanceTimersByTimeAsync(100);
    expect(workers[0]?.disposeCount).toBe(1);
    expect(workers[1]?.disposeCount).toBe(1);

    const p3 = manager.render({ url: 'https://example.com/c' });
    await flushMicrotasks();
    expect(assignedPartitions).toEqual(['web-render:slot-0', 'web-render:slot-1', 'web-render:slot-0']);
    workers[2]?.pending[0]?.resolve(rendered('c', 'https://example.com/c'));
    await p3;
    await manager.dispose();
  });

  it('多轮 idle 销毁与重建后只创建一次槽位 session、安全守卫始终在位、空闲期拒绝未知主响应', async () => {
    const partitions: string[] = [];
    let guardsInstalled = 0;
    let guardsRemoved = 0;
    let clearCount = 0;
    let responseObserver: ((response: WebPageRenderMainFrameResponse) => WebPageRenderResponseDecision) | undefined;

    const session: WebPageRenderSession = {
      clearStorageData: async () => {
        clearCount += 1;
      },
      installSecurityGuards: () => {
        guardsInstalled += 1;
        return () => {
          guardsRemoved += 1;
        };
      },
      observeMainFrameResponses: (listener) => {
        responseObserver = listener;
        return () => {
          responseObserver = undefined;
        };
      },
      observeSubresources: () => () => undefined,
    };

    const runtime: WebPageRenderRuntime = {
      createSession: (partition) => {
        partitions.push(partition);
        return session;
      },
      createWindow: () => {
        let currentUrl = '';
        let destroyed = false;
        const win: WebPageRenderWindow = {
          loadURL: async (url) => {
            currentUrl = url;
            const decision = responseObserver?.({
              url,
              statusCode: 200,
              headers: { get: () => undefined },
            }) ?? 'cancel';
            if (decision !== 'continue') throw new Error('Main response unexpectedly cancelled');
          },
          executeJavaScript: async () => '<html><body>ok</body></html>',
          getURL: () => currentUrl,
          isDestroyed: () => destroyed,
          destroy: () => {
            destroyed = true;
          },
          installNavigationGuards: () => () => undefined,
          onClosed: () => () => undefined,
          onRenderProcessGone: () => () => undefined,
          onUnresponsive: () => () => undefined,
          onDomReady: () => () => undefined,
        };
        return win;
      },
    };

    const manager = new WebPageRenderManager({
      maxConcurrency: 1,
      idleTimeoutMs: 30,
      runtime,
    });

    for (let cycle = 0; cycle < 3; cycle += 1) {
      const res = await manager.render({ url: `https://example.com/cycle-${cycle}` });
      expect(res.mainResponse.status).toBe(200);
      expect(guardsInstalled).toBe(1);
      expect(guardsRemoved).toBe(0);
      await new Promise((resolve) => setTimeout(resolve, 60));
      // idle 销毁 worker 后，安全守卫不能被卸载，且无活跃任务的主框架响应必须被拒绝。
      expect(guardsRemoved).toBe(0);
      expect(responseObserver?.({
        url: 'https://example.com/idle-unexpected',
        statusCode: 200,
        headers: { get: () => undefined },
      })).toBe('cancel');
    }

    expect(partitions).toEqual(['web-render:slot-0']);
    // 每轮 render 开头清理 + 每轮 idle 销毁清理，至少 6 次。
    expect(clearCount).toBeGreaterThanOrEqual(6);
    await manager.dispose();
    expect(guardsRemoved).toBe(1);
  });
});
