import { describe, expect, it, vi } from 'vitest';

import type { MainWindowCloseDecision } from '../definitions/mainWindowCloseLifecycle';
import { createMainWindowCloseLifecycle } from './createMainWindowCloseLifecycle';

function createFixture(input: {
  readonly executing: boolean;
  readonly decision?: MainWindowCloseDecision;
}) {
  const events: string[] = [];
  const lifecycle = createMainWindowCloseLifecycle({
    hasExecutingCommands: () => input.executing,
    requestExecutingCommandsDecision: async () => {
      events.push('decision');
      return input.decision ?? 'return';
    },
    prepareRendererForClose: async () => {
      events.push('renderer_prepared');
    },
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

    await expect(fixture.lifecycle.requestClose('install_update')).resolves.toBe('ready_to_quit');
    expect(fixture.events).toEqual(['decision', 'renderer_prepared']);
  });

  it('并发关闭请求共享同一次用户选择和 renderer 保存', async () => {
    let resolveDecision: ((value: MainWindowCloseDecision) => void) | undefined;
    const requestExecutingCommandsDecision = vi.fn(() => new Promise<MainWindowCloseDecision>(resolve => {
      resolveDecision = resolve;
    }));
    const prepareRendererForClose = vi.fn(async () => undefined);
    const lifecycle = createMainWindowCloseLifecycle({
      hasExecutingCommands: () => true,
      requestExecutingCommandsDecision,
      prepareRendererForClose,
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
      hasExecutingCommands: () => false,
      requestExecutingCommandsDecision: async () => 'return',
      prepareRendererForClose,
    });

    await expect(lifecycle.requestClose('ordinary_exit')).rejects.toThrow('save failed');
    await expect(lifecycle.requestClose('ordinary_exit')).resolves.toBe('ready_to_quit');
  });
});
