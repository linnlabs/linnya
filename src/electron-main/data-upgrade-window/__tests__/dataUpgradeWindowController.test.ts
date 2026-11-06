import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AppServerStartupProgress } from '../../../app-hosts/linnya/app-server-control';
import type { DataUpgradeWindowPort } from '../definitions/dataUpgradeWindow';
import { createDataUpgradeWindowController } from '../orchestration/createDataUpgradeWindowController';

const TIMING = { showDelayMs: 1_000, minimumVisibleMs: 800 };

function createPort() {
  const calls: string[] = [];
  const port: DataUpgradeWindowPort = {
    open: fraction => calls.push(`open:${fraction}`),
    setProgress: fraction => calls.push(`progress:${fraction}`),
    hide: () => calls.push('hide'),
    close: () => calls.push('close'),
  };
  return { port, calls };
}

function progress(
  state: AppServerStartupProgress['state'],
  completedSteps: number,
  upgrading = true,
): AppServerStartupProgress {
  return { state, upgrading, completedSteps, totalSteps: 4 };
}

describe('data upgrade window controller', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('升级在显示延迟内完成时从不打开窗口', async () => {
    const { port, calls } = createPort();
    const controller = createDataUpgradeWindowController({ port, timing: TIMING });
    controller.handleProgress(progress('started', 0));
    vi.advanceTimersByTime(600);
    controller.handleProgress(progress('progress', 4));
    controller.handleProgress(progress('finished', 4));
    // 升级已结束，之后的其他启动步骤再久也不弹出“正在升级数据”。
    vi.advanceTimersByTime(5_000);
    await controller.settle();
    controller.close();
    expect(calls).toEqual([]);
  });

  it('没有数据格式升级时不打开窗口', () => {
    const { port, calls } = createPort();
    const controller = createDataUpgradeWindowController({ port, timing: TIMING });
    controller.handleProgress(progress('started', 0, false));
    vi.advanceTimersByTime(10_000);
    expect(calls).toEqual([]);
  });

  it('升级超过显示延迟时打开，按步骤更新进度并保留最短显示时间', async () => {
    const { port, calls } = createPort();
    const controller = createDataUpgradeWindowController({ port, timing: TIMING });
    controller.handleProgress(progress('started', 0));
    controller.handleProgress(progress('progress', 1));
    vi.advanceTimersByTime(1_000);
    expect(calls).toEqual(['open:0.25']);
    controller.handleProgress(progress('progress', 3));
    controller.handleProgress(progress('finished', 4));
    expect(calls).toEqual(['open:0.25', 'progress:0.75', 'progress:1']);

    vi.advanceTimersByTime(300);
    let settled = false;
    const settling = controller.settle().then(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(400);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(100);
    await settling;
    expect(settled).toBe(true);
    controller.close();
    expect(calls[calls.length - 1]).toBe('close');
  });

  it('启动失败时隐藏已显示的窗口，并取消尚未到时的显示', () => {
    const shown = createPort();
    const visible = createDataUpgradeWindowController({ port: shown.port, timing: TIMING });
    visible.handleProgress(progress('started', 0));
    vi.advanceTimersByTime(1_000);
    visible.hide();
    expect(shown.calls).toEqual(['open:0', 'hide']);

    const pending = createPort();
    const notYetShown = createDataUpgradeWindowController({ port: pending.port, timing: TIMING });
    notYetShown.handleProgress(progress('started', 0));
    notYetShown.hide();
    vi.advanceTimersByTime(5_000);
    expect(pending.calls).toEqual([]);
  });
});
