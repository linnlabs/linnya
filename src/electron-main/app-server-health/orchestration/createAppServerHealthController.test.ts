import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppServerHealthStatus } from '../../../shared/app-server-health/definitions/appServerHealthMessage';
import {
  APP_SERVER_RECOVERED_NOTICE_MS,
  APP_SERVER_RELAUNCH_DELAY_MS,
  APP_SERVER_UNRESPONSIVE_AFTER_MS,
  createAppServerHealthController,
} from './createAppServerHealthController';

function setup(options: { crashes?: number[]; recovered?: boolean } = {}) {
  let history = [...(options.crashes ?? [])];
  let notice = options.recovered ?? false;
  let alive = true;
  let respond = true;
  const published: AppServerHealthStatus[] = [];
  const ports = {
    ping: vi.fn(() => (respond ? Promise.resolve() : new Promise<void>(() => undefined))),
    isAppServerAlive: () => alive,
    killAppServer: vi.fn(() => { alive = false; }),
    relaunchApp: vi.fn(),
    crashHistory: { read: () => history, write: (next: readonly number[]) => { history = [...next]; } },
    recoveredNotice: { take: () => { const value = notice; notice = false; return value; }, set: () => { notice = true; } },
    publish: (state: { status: AppServerHealthStatus }) => { published.push(state.status); },
    timers: {
      now: () => Date.now(),
      setTimeout: (callback: () => void, delayMs: number) => setTimeout(callback, delayMs),
      clearTimeout: (handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>),
    },
    log: () => undefined,
  };
  const controller = createAppServerHealthController(ports);
  return {
    controller, ports, published,
    history: () => history,
    notice: () => notice,
    hang() { respond = false; },
    recover() { respond = true; },
  };
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('createAppServerHealthController', () => {
  it('意外停止：先显示正在重新启动，稍后重开应用，并留下恢复提示', async () => {
    const t = setup();
    t.controller.start();
    t.controller.handleExit({ expected: false });
    expect(t.published).toEqual(['restarting']);
    expect(t.ports.relaunchApp).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(APP_SERVER_RELAUNCH_DELAY_MS);
    expect(t.ports.relaunchApp).toHaveBeenCalledOnce();
    expect(t.notice()).toBe(true);
    expect(t.history()).toHaveLength(1);
  });

  it('5 分钟内第 3 次停止：不再自动重启，等用户处理', async () => {
    const now = Date.now();
    const t = setup({ crashes: [now - 60_000, now - 30_000] });
    t.controller.start();
    t.controller.handleExit({ expected: false });
    expect(t.published).toEqual(['stopped']);
    await vi.advanceTimersByTimeAsync(APP_SERVER_RELAUNCH_DELAY_MS * 4);
    expect(t.ports.relaunchApp).not.toHaveBeenCalled();
    // 用户点重新启动：清空限额，立即重开。
    t.ports.isAppServerAlive = () => false;
    t.controller.restart();
    await vi.advanceTimersByTimeAsync(0);
    expect(t.ports.relaunchApp).toHaveBeenCalledOnce();
    expect(t.history()).toEqual([]);
  });

  it('启动完成前退出交给启动失败对话框，不自动重启', async () => {
    const t = setup();
    t.controller.handleExit({ expected: false });
    await vi.advanceTimersByTimeAsync(APP_SERVER_RELAUNCH_DELAY_MS * 2);
    expect(t.published).toEqual([]);
    expect(t.ports.relaunchApp).not.toHaveBeenCalled();
    expect(t.history()).toEqual([]);
  });

  it('正常关闭不算停止', async () => {
    const t = setup();
    t.controller.start();
    t.controller.handleExit({ expected: true });
    await vi.advanceTimersByTimeAsync(APP_SERVER_RELAUNCH_DELAY_MS * 2);
    expect(t.published).toEqual([]);
    expect(t.ports.relaunchApp).not.toHaveBeenCalled();
  });

  it('连续 15 秒没有回应才提示，回应后自动收起', async () => {
    const t = setup();
    t.controller.start();
    t.hang();
    await vi.advanceTimersByTimeAsync(APP_SERVER_UNRESPONSIVE_AFTER_MS - 5_000);
    expect(t.published).toEqual([]);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(t.published).toEqual(['unresponsive']);
    t.recover();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(t.published).toEqual(['unresponsive', 'ok']);
  });

  it('卡住时重新启动：先结束后台进程，退出后重开，不计入意外停止', async () => {
    const t = setup();
    t.controller.start();
    t.controller.restart();
    expect(t.ports.killAppServer).toHaveBeenCalledOnce();
    expect(t.ports.relaunchApp).not.toHaveBeenCalled();
    t.controller.handleExit({ expected: false });
    await vi.advanceTimersByTimeAsync(0);
    expect(t.ports.relaunchApp).toHaveBeenCalledOnce();
    expect(t.history()).toEqual([]);
    expect(t.published).toEqual(['restarting']);
  });

  it('重开后的第一次启动显示已恢复，几秒后回到正常', async () => {
    const t = setup({ recovered: true });
    t.controller.start();
    expect(t.controller.getState()).toEqual({ status: 'recovered' });
    await vi.advanceTimersByTimeAsync(APP_SERVER_RECOVERED_NOTICE_MS);
    expect(t.published).toEqual(['recovered', 'ok']);
    expect(t.notice()).toBe(false);
  });
});
