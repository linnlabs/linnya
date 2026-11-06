import { describe, expect, it, vi } from 'vitest';

import type { MainWindowCloseDecision } from '../definitions/mainWindowCloseLifecycle';
import { createMainWindowCloseLifecycle } from './createMainWindowCloseLifecycle';

function createFixture(input: {
  readonly executing: boolean;
  readonly decision?: MainWindowCloseDecision;
}) {
  const events: string[] = [];
  const lifecycle = createMainWindowCloseLifecycle({
    isBackendUnavailable: () => false,
    hasExecutingCommands: () => input.executing,
    requestExecutingCommandsDecision: async () => {
      events.push('decision');
      return input.decision ?? 'return';
    },
    prepareRendererForClose: async () => {
      events.push('renderer_prepared');
    },
    requestPreparationFailureDecision: async () => 'return',
  });
  return { events, lifecycle };
}

describe('createMainWindowCloseLifecycle', () => {
  it('没有运行中命令时等待 renderer 保存后请求 App 退出', async () => {
    const fixture = createFixture({ executing: false });

    await expect(fixture.lifecycle.requestClose('ordinary_exit')).resolves.toBe('ready_to_quit');
    expect(fixture.events).toEqual(['renderer_prepared']);
  });

  it('运行中命令选择返回时保持窗口和 owner 不变', async () => {
    const fixture = createFixture({ executing: true, decision: 'return' });

    await expect(fixture.lifecycle.requestClose('ordinary_exit')).resolves.toBe('kept_open');
    expect(fixture.events).toEqual(['decision']);
  });

  it('运行中命令明确停止后才保存并进入唯一 App 退出链', async () => {
    const fixture = createFixture({ executing: true, decision: 'stop_and_close' });

    await expect(fixture.lifecycle.requestClose('ordinary_exit')).resolves.toBe('ready_to_quit');
    expect(fixture.events).toEqual(['decision', 'renderer_prepared']);
  });

  it('安装更新不再询问命令：任务确认已由更新入口在提交前完成', async () => {
    const fixture = createFixture({ executing: true, decision: 'return' });

    await expect(fixture.lifecycle.requestClose('install_update')).resolves.toBe('ready_to_quit');
    expect(fixture.events).toEqual(['renderer_prepared']);
  });

  it('并发关闭请求共享同一次用户选择和 renderer 保存', async () => {
    let resolveDecision: ((value: MainWindowCloseDecision) => void) | undefined;
    const requestExecutingCommandsDecision = vi.fn(() => new Promise<MainWindowCloseDecision>(resolve => {
      resolveDecision = resolve;
    }));
    const prepareRendererForClose = vi.fn(async () => undefined);
    const lifecycle = createMainWindowCloseLifecycle({
      isBackendUnavailable: () => false,
      hasExecutingCommands: () => true,
      requestExecutingCommandsDecision,
      prepareRendererForClose,
      requestPreparationFailureDecision: async () => 'return',
    });

    const first = lifecycle.requestClose('ordinary_exit');
    const second = lifecycle.requestClose('ordinary_exit');
    expect(second).toBe(first);
    expect(requestExecutingCommandsDecision).toHaveBeenCalledTimes(1);

    resolveDecision?.('stop_and_close');
    await expect(first).resolves.toBe('ready_to_quit');
    expect(prepareRendererForClose).toHaveBeenCalledTimes(1);
  });

  it('renderer 保存失败时不退出，并允许用户修复后重试', async () => {
    const prepareRendererForClose = vi.fn()
      .mockRejectedValueOnce(new Error('save failed'))
      .mockResolvedValueOnce(undefined);
    const lifecycle = createMainWindowCloseLifecycle({
      isBackendUnavailable: () => false,
      hasExecutingCommands: () => false,
      requestExecutingCommandsDecision: async () => 'return',
      prepareRendererForClose,
      requestPreparationFailureDecision: async () => 'return',
    });

    await expect(lifecycle.requestClose('ordinary_exit')).resolves.toBe('kept_open');
    await expect(lifecycle.requestClose('ordinary_exit')).resolves.toBe('ready_to_quit');
  });

  it('已观察到 Backend 退出时跳过活动 RPC，但仍执行 renderer 保存', async () => {
    const hasExecutingCommands = vi.fn(() => { throw new Error('RPC not ready'); });
    const prepareRendererForClose = vi.fn(async () => undefined);
    const requestPreparationFailureDecision = vi.fn(async () => 'return' as const);
    const lifecycle = createMainWindowCloseLifecycle({
      isBackendUnavailable: () => true,
      hasExecutingCommands,
      requestExecutingCommandsDecision: async () => 'return',
      requestPreparationFailureDecision,
      prepareRendererForClose,
    });
    await expect(lifecycle.requestClose('ordinary_exit')).resolves.toBe('ready_to_quit');
    expect(hasExecutingCommands).not.toHaveBeenCalled();
    expect(prepareRendererForClose).toHaveBeenCalledOnce();
    expect(requestPreparationFailureDecision).not.toHaveBeenCalled();
  });

  it.each(['return', 'close_anyway'] as const)('活动查询超时必须取得用户决定：%s', async decision => {
    const failure = new Error('activity RPC timeout');
    const prepareRendererForClose = vi.fn(async () => undefined);
    const requestPreparationFailureDecision = vi.fn(async () => decision);
    const lifecycle = createMainWindowCloseLifecycle({
      isBackendUnavailable: () => false,
      hasExecutingCommands: async () => { throw failure; },
      requestExecutingCommandsDecision: async () => 'return',
      requestPreparationFailureDecision,
      prepareRendererForClose,
    });
    await expect(lifecycle.requestClose('ordinary_exit')).resolves.toBe(
      decision === 'return' ? 'kept_open' : 'ready_to_quit',
    );
    expect(requestPreparationFailureDecision).toHaveBeenCalledExactlyOnceWith({
      stage: 'activity_query', intent: 'ordinary_exit', error: failure,
    });
    expect(prepareRendererForClose).toHaveBeenCalledTimes(decision === 'return' ? 0 : 1);
  });

  it('活动查询期间 Backend 退出，按退出事实继续而不把已结束的命令当作未知任务', async () => {
    let unavailable = false;
    const requestPreparationFailureDecision = vi.fn(async () => 'return' as const);
    const lifecycle = createMainWindowCloseLifecycle({
      isBackendUnavailable: () => unavailable,
      hasExecutingCommands: async () => {
        unavailable = true;
        throw new Error('child exited');
      },
      requestExecutingCommandsDecision: async () => 'return',
      requestPreparationFailureDecision,
      prepareRendererForClose: async () => undefined,
    });
    await expect(lifecycle.requestClose('ordinary_exit')).resolves.toBe('ready_to_quit');
    expect(requestPreparationFailureDecision).not.toHaveBeenCalled();
  });

  it.each(['ordinary_exit', 'install_update'] as const)('未保存修改只有用户明确放弃后才能继续 %s', async intent => {
    const failure = new Error('save failed');
    const requestPreparationFailureDecision = vi.fn(async () => 'close_anyway' as const);
    const lifecycle = createMainWindowCloseLifecycle({
      isBackendUnavailable: () => true,
      hasExecutingCommands: () => false,
      requestExecutingCommandsDecision: async () => 'return',
      requestPreparationFailureDecision,
      prepareRendererForClose: async () => { throw failure; },
    });
    await expect(lifecycle.requestClose(intent)).resolves.toBe('ready_to_quit');
    expect(requestPreparationFailureDecision).toHaveBeenCalledExactlyOnceWith({
      stage: 'renderer_save', intent, error: failure,
    });
  });
});
