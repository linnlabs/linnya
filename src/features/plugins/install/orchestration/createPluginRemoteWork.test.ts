import { describe, expect, it, vi } from 'vitest';

import { createPluginRemoteWork } from './createPluginRemoteWork';

function pendingUntilAborted(signal: AbortSignal): Promise<never> {
  return new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  });
}

describe('插件远程工作的停止', () => {
  it('停止时取消在途下载，并等它们收尾后才完成', async () => {
    const remoteWork = createPluginRemoteWork();
    const cleanup = vi.fn();
    const download = remoteWork.run(async signal => {
      try {
        await pendingUntilAborted(signal);
      } finally {
        await new Promise(resolve => setTimeout(resolve, 5));
        cleanup();
      }
    });
    const outcome = expect(download).rejects.toMatchObject({ code: 'cancelled' });

    await remoteWork.stop();

    expect(cleanup).toHaveBeenCalledOnce();
    expect(remoteWork.stopped).toBe(true);
    await outcome;
  });

  it('停止后不再接受新的工作；排在嵌套工作里的也不会开始', async () => {
    const remoteWork = createPluginRemoteWork();
    const nested = vi.fn(async () => undefined);
    const outer = remoteWork.run(async signal => {
      await pendingUntilAborted(signal).catch(() => undefined);
      await remoteWork.run(nested);
    });
    const outcome = expect(outer).rejects.toMatchObject({ code: 'cancelled' });

    await remoteWork.stop();
    await outcome;

    await expect(remoteWork.run(nested)).rejects.toMatchObject({ code: 'cancelled' });
    expect(nested).not.toHaveBeenCalled();
  });

  it('没有在途工作时停止立即完成，已完成的工作不受影响', async () => {
    const remoteWork = createPluginRemoteWork();
    await expect(remoteWork.run(async () => 'ok')).resolves.toBe('ok');
    expect(remoteWork.stopped).toBe(false);
    await remoteWork.stop();
  });
});
