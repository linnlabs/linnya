import { describe, expect, it, vi } from 'vitest';
import { createOnDemandQdrantRuntime } from './createOnDemandQdrantRuntime';

describe('on-demand vector process ownership', () => {
  it('冷态退出不创建进程；启动中退出等待同一进程并禁止新请求', async () => {
    const cold = { start: vi.fn(async () => 'url'), stop: vi.fn(async () => undefined) };
    await createOnDemandQdrantRuntime(cold).stop();
    expect(cold.start).not.toHaveBeenCalled();
    expect(cold.stop).not.toHaveBeenCalled();

    let finishStart: ((url: string) => void) | undefined;
    const owner = {
      start: vi.fn(() => new Promise<string>(resolve => { finishStart = resolve; })),
      stop: vi.fn(async () => undefined),
    };
    const runtime = createOnDemandQdrantRuntime(owner);
    const first = runtime.ensureReady();
    expect(runtime.ensureReady()).toBe(first);
    const stopped = runtime.stop();
    expect(owner.stop).not.toHaveBeenCalled();
    await expect(runtime.ensureReady()).rejects.toThrow('正在停止');
    finishStart?.('http://127.0.0.1:49000');
    await stopped;
    expect(owner.start).toHaveBeenCalledOnce();
    expect(owner.stop).toHaveBeenCalledOnce();
  });

  it('启动故障不会自动重试，清理失败保留 owner 供正式停止重试', async () => {
    const failure = new Error('binary missing');
    const owner = {
      start: vi.fn(async () => { throw failure; }),
      stop: vi.fn().mockRejectedValueOnce(new Error('cleanup failed')).mockResolvedValue(undefined),
    };
    const runtime = createOnDemandQdrantRuntime(owner);
    await expect(runtime.ensureReady()).rejects.toBe(failure);
    await expect(runtime.ensureReady()).rejects.toBe(failure);
    expect(owner.start).toHaveBeenCalledOnce();
    await expect(runtime.stop()).rejects.toThrow('cleanup failed');
    await runtime.stop();
    expect(owner.stop).toHaveBeenCalledTimes(2);
  });
});
