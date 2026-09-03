import { describe, expect, it, vi } from 'vitest';

import type {
  AppShutdownLifecyclePorts,
  AppShutdownPreparation,
  UserPreparedAppShutdownIntent,
} from '../definitions/appShutdownLifecycle';
import { createAppShutdownLifecycle } from './createAppShutdownLifecycle';

function createFixture(input: {
  readonly prepare?: (
    intent: UserPreparedAppShutdownIntent,
  ) => Promise<AppShutdownPreparation>;
  readonly updateReady?: boolean;
  readonly stage?: () => Promise<void>;
  readonly handoff?: () => void;
} = {}) {
  const events: string[] = [];
  let lifecycle: ReturnType<typeof createAppShutdownLifecycle> | undefined;
  const ports: AppShutdownLifecyclePorts = {
    prepareAppShutdown: input.prepare ?? (async () => 'ready_to_quit'),
    commitWindowClosePermission: () => events.push('window_close_committed'),
    requestElectronQuit: () => events.push('electron_quit'),
    runShutdownStages: async () => {
      events.push('shutdown_stages');
      await input.stage?.();
    },
    drainDiagnosticLog: async () => {
      events.push('log_drain');
    },
    exitElectron: exitCode => events.push(`exit:${exitCode}`),
    updateHandoff: {
      isReady: () => input.updateReady ?? false,
      handoff: () => {
        expect(lifecycle?.isUpdateHandoffInProgress()).toBe(true);
        events.push('update_handoff');
        input.handoff?.();
      },
    },
  };
  lifecycle = createAppShutdownLifecycle(ports);
  return { events, lifecycle };
}

describe('createAppShutdownLifecycle', () => {
  it('用户返回时不提交退出，也不提前销毁任何参与者', async () => {
    const fixture = createFixture({ prepare: async () => 'kept_open' });

    await expect(fixture.lifecycle.requestOrdinaryExit()).resolves.toBe('kept_open');

    expect(fixture.lifecycle.getPhase()).toBe('running');
    expect(fixture.lifecycle.isWindowClosePermitted()).toBe(false);
    expect(fixture.lifecycle.canAcceptWindowRequest()).toBe(true);
    expect(fixture.events).toEqual([]);
  });

  it('并发普通退出只准备一次，准备期间拒绝新窗口，提交后状态不可逆', async () => {
    let finishPreparation: ((value: AppShutdownPreparation) => void) | undefined;
    const prepare = vi.fn(() => new Promise<AppShutdownPreparation>(resolve => {
      finishPreparation = resolve;
    }));
    const fixture = createFixture({ prepare });

    const first = fixture.lifecycle.requestOrdinaryExit();
    const second = fixture.lifecycle.requestOrdinaryExit();
    expect(second).toBe(first);
    expect(fixture.lifecycle.getPhase()).toBe('preparing_exit');
    expect(fixture.lifecycle.canAcceptWindowRequest()).toBe(false);

    finishPreparation?.('ready_to_quit');
    await expect(first).resolves.toBe('shutdown_committed');
    expect(prepare).toHaveBeenCalledOnce();
    expect(fixture.lifecycle.getIntent()).toBe('ordinary_exit');
    expect(fixture.lifecycle.isWindowClosePermitted()).toBe(true);
    expect(fixture.events).toEqual(['window_close_committed', 'electron_quit']);

    await expect(fixture.lifecycle.requestOrdinaryExit()).resolves.toBe('shutdown_committed');
    expect(prepare).toHaveBeenCalledOnce();
  });

  it('普通退出按参与者、日志、Electron 的顺序完成，且只完成一次', async () => {
    const fixture = createFixture();
    await fixture.lifecycle.requestOrdinaryExit();

    const first = fixture.lifecycle.completeCommittedShutdown();
    const second = fixture.lifecycle.completeCommittedShutdown();
    expect(second).toBe(first);
    await expect(first).resolves.toEqual({
      intent: 'ordinary_exit',
      exitCode: 0,
      completed: true,
      updateHandoffStarted: false,
    });
    expect(fixture.events).toEqual([
      'window_close_committed',
      'electron_quit',
      'shutdown_stages',
      'log_drain',
      'exit:0',
    ]);
  });

  it('未下载完成时更新请求不确认、不停止资源', async () => {
    const prepare = vi.fn(async (): Promise<AppShutdownPreparation> => 'ready_to_quit');
    const fixture = createFixture({ prepare, updateReady: false });

    await expect(fixture.lifecycle.requestInstallUpdate()).resolves.toBe('update_not_ready');
    expect(prepare).not.toHaveBeenCalled();
    expect(fixture.lifecycle.getPhase()).toBe('running');
    expect(fixture.events).toEqual([]);
  });

  it('用户选择稍后更新时窗口、命令和 updater 均保持不变', async () => {
    const fixture = createFixture({
      prepare: async intent => {
        expect(intent).toBe('install_update');
        return 'kept_open';
      },
      updateReady: true,
    });

    await expect(fixture.lifecycle.requestInstallUpdate()).resolves.toBe('kept_open');
    expect(fixture.lifecycle.getPhase()).toBe('running');
    expect(fixture.events).toEqual([]);
  });

  it('更新只在保存和全部收口完成后执行 handoff', async () => {
    let finishStage: (() => void) | undefined;
    const onCommitted = vi.fn();
    const fixture = createFixture({
      updateReady: true,
      stage: () => new Promise<void>(resolve => {
        finishStage = resolve;
      }),
    });

    const request = fixture.lifecycle.requestInstallUpdate(onCommitted);
    await vi.waitFor(() => expect(onCommitted).toHaveBeenCalledOnce());
    expect(fixture.events).toEqual(['window_close_committed', 'shutdown_stages']);

    finishStage?.();
    await expect(request).resolves.toBe('shutdown_committed');
    expect(fixture.events).toEqual([
      'window_close_committed',
      'shutdown_stages',
      'log_drain',
      'update_handoff',
    ]);
    await expect(fixture.lifecycle.completeCommittedShutdown()).resolves.toEqual({
      intent: 'install_update',
      exitCode: null,
      completed: true,
      updateHandoffStarted: true,
    });
  });

  it('普通退出与更新并发时只冻结第一个意图', async () => {
    let finishPreparation: ((value: AppShutdownPreparation) => void) | undefined;
    const fixture = createFixture({
      updateReady: true,
      prepare: () => new Promise<AppShutdownPreparation>(resolve => {
        finishPreparation = resolve;
      }),
    });

    const ordinary = fixture.lifecycle.requestOrdinaryExit();
    await expect(fixture.lifecycle.requestInstallUpdate()).resolves.toBe('intent_conflict');
    finishPreparation?.('ready_to_quit');
    await expect(ordinary).resolves.toBe('shutdown_committed');
    expect(fixture.lifecycle.getIntent()).toBe('ordinary_exit');
    expect(fixture.events).toEqual(['window_close_committed', 'electron_quit']);
  });

  it('更新收口或 handoff 失败时不调用 updater 后续路径，并以 1 退出', async () => {
    const stageFailure = createFixture({
      updateReady: true,
      stage: async () => { throw new Error('backend stop failed'); },
    });
    await expect(stageFailure.lifecycle.requestInstallUpdate()).resolves.toBe('shutdown_committed');
    expect(stageFailure.events).toEqual([
      'window_close_committed',
      'shutdown_stages',
      'log_drain',
      'exit:1',
    ]);

    const handoffFailure = createFixture({
      updateReady: true,
      handoff: () => { throw new Error('quitAndInstall failed'); },
    });
    await expect(handoffFailure.lifecycle.requestInstallUpdate()).resolves.toBe('shutdown_committed');
    expect(handoffFailure.events).toEqual([
      'window_close_committed',
      'shutdown_stages',
      'log_drain',
      'update_handoff',
      'exit:1',
    ]);
  });

  it('启动失败不询问窗口，收口已有参与者后固定以 1 退出', async () => {
    const prepare = vi.fn(async (): Promise<AppShutdownPreparation> => 'ready_to_quit');
    const fixture = createFixture({ prepare });

    fixture.lifecycle.requestStartupFailure();
    await expect(fixture.lifecycle.completeCommittedShutdown()).resolves.toEqual({
      intent: 'startup_failure',
      exitCode: 1,
      completed: true,
      updateHandoffStarted: false,
    });
    expect(prepare).not.toHaveBeenCalled();
    expect(fixture.events).toEqual([
      'window_close_committed',
      'electron_quit',
      'shutdown_stages',
      'log_drain',
      'exit:1',
    ]);
  });
});
