import { describe, expect, it, vi } from 'vitest';
import { createProviderModelSynchronizationLifecycle } from './createProviderModelSynchronizationLifecycle';
import { createChatGptAccountModelDiscovery } from 'src/domains/provider-account';

describe('账号模型后台同步生命周期', () => {
  it('启动不等待远端目录，重入共享同一同步，完成后只发一次刷新通知', async () => {
    let complete!: () => void;
    const upstream = new Promise<void>(resolve => { complete = resolve; });
    const synchronize = vi.fn(() => upstream);
    const publishModelsChanged = vi.fn();
    const lifecycle = createProviderModelSynchronizationLifecycle({
      startupConnectionIds: ['account'], synchronize, publishModelsChanged,
    });
    expect(lifecycle.start()).toBeUndefined();
    const first = lifecycle.synchronizeConnectedProviderModels('account');
    expect(lifecycle.synchronizeConnectedProviderModels('account')).toBe(first);
    await Promise.resolve();
    expect(synchronize).toHaveBeenCalledOnce();
    expect(publishModelsChanged).not.toHaveBeenCalled();
    complete();
    await first;
    expect(publishModelsChanged).toHaveBeenCalledOnce();
    await lifecycle.stop();
    await expect(lifecycle.synchronizeConnectedProviderModels('account')).rejects.toThrow('stopped');
  });

  it('用户目录提交信号在 start 后转发为刷新通知，重复 start 不重复订阅，stop 后退订', async () => {
    const listeners = new Set<() => void>();
    const subscribeToUserCatalogChanges = vi.fn((listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    });
    const publishModelsChanged = vi.fn();
    const lifecycle = createProviderModelSynchronizationLifecycle({
      startupConnectionIds: [], synchronize: vi.fn(async () => {}), publishModelsChanged,
      subscribeToUserCatalogChanges,
    });
    expect(subscribeToUserCatalogChanges).not.toHaveBeenCalled();
    lifecycle.start();
    lifecycle.start();
    expect(subscribeToUserCatalogChanges).toHaveBeenCalledOnce();
    for (const listener of listeners) listener();
    expect(publishModelsChanged).toHaveBeenCalledOnce();
    await lifecycle.stop();
    expect(listeners.size).toBe(0);
    lifecycle.start();
    expect(subscribeToUserCatalogChanges).toHaveBeenCalledOnce();
  });

  it('未提供目录订阅时照常启动与停止', async () => {
    const lifecycle = createProviderModelSynchronizationLifecycle({
      startupConnectionIds: [], synchronize: vi.fn(async () => {}), publishModelsChanged: vi.fn(),
    });
    lifecycle.start();
    await expect(lifecycle.stop()).resolves.toBeUndefined();
  });

  it('退出取消真实模型发现 HTTP 请求，收口后不提交迟到目录；重新授权可再次同步', async () => {
    const fetchStarted: AbortSignal[] = [];
    const discovery = createChatGptAccountModelDiscovery({
      credentials: { resolve: async () => ({ access_token: 'fixture', request_headers: {} }) },
      applicationVersion: '0.0.0',
      fetchImplementation: async (_url, init) => new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        if (!signal) throw new Error('目录请求必须携带取消信号');
        fetchStarted.push(signal);
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      }),
    });
    const commit = vi.fn();
    const notify = vi.fn();
    const lifecycle = createProviderModelSynchronizationLifecycle({
      startupConnectionIds: ['account'], publishModelsChanged: notify,
      async synchronize(id, signal) {
        const models = await discovery.listModels(id, signal);
        signal.throwIfAborted();
        commit(models);
      },
    });
    lifecycle.start();
    await vi.waitFor(() => expect(fetchStarted).toHaveLength(1));
    await lifecycle.cancelAndWait('account');
    expect(fetchStarted[0].aborted).toBe(true);
    expect(commit).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
    const next = lifecycle.synchronizeConnectedProviderModels('account');
    const rejected = expect(next).rejects.toMatchObject({ name: 'AbortError' });
    await vi.waitFor(() => expect(fetchStarted).toHaveLength(2));
    await lifecycle.stop();
    await rejected;
    expect(fetchStarted[1].aborted).toBe(true);
  });

  it('远端失败不会成为未处理拒绝，仍通知前端读取已提交的部分结果', async () => {
    const publishModelsChanged = vi.fn();
    const lifecycle = createProviderModelSynchronizationLifecycle({
      startupConnectionIds: ['account'], publishModelsChanged,
      async synchronize() { throw new Error('upstream unavailable'); },
    });
    lifecycle.start();
    await vi.waitFor(() => expect(publishModelsChanged).toHaveBeenCalledOnce());
    await lifecycle.stop();
  });
});
