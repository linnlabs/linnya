import { afterEach, describe, expect, it, vi } from 'vitest';
import { pluginDiagnostics } from '../diagnostics';
import type { BackendPluginRuntimeEffectRegistration } from '../registry';
import {
  clearSyncedBackendPluginRuntimeEffectsForTests,
  syncBackendPluginRuntimeEffects,
} from '../runtimeEffectRuntime';

describe('backend plugin runtime effects', () => {
  afterEach(async () => {
    await clearSyncedBackendPluginRuntimeEffectsForTests();
    pluginDiagnostics.clear();
  });

  it('按 enabled contribution 挂载和卸载运行态副作用', async () => {
    const activate = vi.fn();
    const deactivate = vi.fn();
    const registrations: BackendPluginRuntimeEffectRegistration[] = [{
      pluginId: 'demo',
      effect: {
        id: 'effect',
        activate,
        deactivate,
      },
    }];

    await syncBackendPluginRuntimeEffects(registrations);
    await syncBackendPluginRuntimeEffects(registrations);

    expect(activate).toHaveBeenCalledTimes(1);
    expect(deactivate).not.toHaveBeenCalled();

    await syncBackendPluginRuntimeEffects([]);

    expect(deactivate).toHaveBeenCalledTimes(1);
  });

  it('同 ID artifact 替换等待旧实例关闭后再启用新实例，失败时不启动第二套资源', async () => {
    const calls: string[] = [];
    let allowClose = false;
    const previous: BackendPluginRuntimeEffectRegistration = {
      pluginId: 'demo',
      effect: {
        id: 'effect',
        activate: () => { calls.push('old:start'); },
        deactivate: async () => {
          calls.push('old:stop');
          await Promise.resolve();
          if (!allowClose) throw new Error('owned worker still running');
          calls.push('old:settled');
        },
      },
    };
    const next: BackendPluginRuntimeEffectRegistration = {
      pluginId: 'demo',
      effect: {
        id: 'effect',
        activate: () => { calls.push('new:start'); },
        deactivate: () => { calls.push('new:stop'); },
      },
    };
    await syncBackendPluginRuntimeEffects([previous]);
    await expect(syncBackendPluginRuntimeEffects([next])).rejects.toThrow('owned worker still running');
    expect(calls).toEqual(['old:start', 'old:stop']);
    allowClose = true;
    await syncBackendPluginRuntimeEffects([next]);
    await syncBackendPluginRuntimeEffects([next]);
    expect(calls).toEqual(['old:start', 'old:stop', 'old:stop', 'old:settled', 'new:start']);
    await syncBackendPluginRuntimeEffects([]);
    expect(calls[calls.length - 1]).toBe('new:stop');
  });

  it('停用失败后重新启用同一 effect，先完成旧 owner 收尾再创建新实例', async () => {
    const sequence: string[] = [];
    let canStop = false;
    const registration: BackendPluginRuntimeEffectRegistration = {
      pluginId: 'demo', effect: {
        id: 'effect',
        activate() { sequence.push('start'); },
        deactivate() {
          sequence.push('stop');
          if (!canStop) throw new Error('owned cleanup failed');
          sequence.push('settled');
        },
      },
    };
    await syncBackendPluginRuntimeEffects([registration]);
    await expect(syncBackendPluginRuntimeEffects([])).rejects.toThrow('owned cleanup failed');
    canStop = true;
    await syncBackendPluginRuntimeEffects([registration]);
    expect(sequence).toEqual(['start', 'stop', 'stop', 'settled', 'start']);
    await syncBackendPluginRuntimeEffects([registration]);
    expect(sequence).toHaveLength(5);
  });

  it('拒绝同一插件重复声明同一个 runtime effect id', async () => {
    const registrations: BackendPluginRuntimeEffectRegistration[] = [
      {
        pluginId: 'demo',
        effect: {
          id: 'duplicate',
          activate: vi.fn(),
          deactivate: vi.fn(),
        },
      },
      {
        pluginId: 'demo',
        effect: {
          id: 'duplicate',
          activate: vi.fn(),
          deactivate: vi.fn(),
        },
      },
    ];

    await expect(syncBackendPluginRuntimeEffects(registrations))
      .rejects.toThrow('runtime effect 重复声明: demo:duplicate');
  });
});
