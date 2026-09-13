import { describe, expect, it, vi } from 'vitest';

import { createParentProcessLivenessMonitor } from './createParentProcessLivenessMonitor';

describe('App Server parent process liveness', () => {
  it('直接 parent identity 改变时只触发一次 owner-lost', async () => {
    let parentPid = 4100;
    const onParentLost = vi.fn();
    const monitor = createParentProcessLivenessMonitor({
      expectedParentPid: 4100,
      readCurrentParentPid: () => parentPid,
      isExpectedParentAlive: () => true,
      intervalMs: 5,
      onParentLost,
    });

    monitor.start();
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(onParentLost).not.toHaveBeenCalled();
    parentPid = 1;
    await vi.waitFor(() => expect(onParentLost).toHaveBeenCalledOnce());
    await new Promise(resolve => setTimeout(resolve, 15));
    expect(onParentLost).toHaveBeenCalledOnce();

    monitor.dispose();
  });

  it('平台缓存旧 ppid 时仍按父进程存活探针触发 owner-lost', async () => {
    let alive = true;
    const onParentLost = vi.fn();
    const monitor = createParentProcessLivenessMonitor({
      expectedParentPid: 4200,
      readCurrentParentPid: () => 4200,
      isExpectedParentAlive: () => alive,
      intervalMs: 5,
      onParentLost,
    });

    monitor.start();
    alive = false;
    await vi.waitFor(() => expect(onParentLost).toHaveBeenCalledOnce());
    monitor.dispose();
  });
});
