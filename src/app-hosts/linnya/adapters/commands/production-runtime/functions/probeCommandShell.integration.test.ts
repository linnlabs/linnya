import { describe, expect, it, vi } from 'vitest';

const { warn } = vi.hoisted(() => ({ warn: vi.fn() }));
vi.mock('src/shared/logger', () => ({ getLogger: () => ({ warn }) }));

import { probeCommandShell } from './probeCommandShell';

describe('Command Shell startup probe', () => {
  it('等待超过旧三秒预算的真实子进程启动，同时保持宿主事件循环可用', async () => {
    let ticks = 0;
    const timer = setInterval(() => { ticks += 1; }, 100);
    try {
      const version = await probeCommandShell({
        executablePath: process.execPath,
        argv: ['-e', 'setTimeout(() => console.log("5.1.fixture"), 4000)'],
        environment: {},
        timeoutMs: 10_000,
        kind: 'version',
      });
      expect(version).toBe('5.1.fixture');
      expect(ticks).toBeGreaterThan(0);
    } finally {
      clearInterval(timer);
    }
  }, 15_000);

  it('真正无法完成的探测仍失败，并保留退出原因而不记录宿主环境', async () => {
    warn.mockClear();
    const result = await probeCommandShell({
      executablePath: process.execPath,
      argv: ['-e', 'setInterval(() => {}, 1000)'],
      environment: { PRIVATE_PROBE_VALUE: 'must-not-be-logged' },
      timeoutMs: 250,
      kind: 'version',
    });
    expect(result).toBeUndefined();
    expect(warn).toHaveBeenCalledWith('命令 Shell 探测失败', expect.objectContaining({
      kind: 'version', killed: true,
    }));
    expect(JSON.stringify(warn.mock.calls)).not.toContain('must-not-be-logged');
  });
});
