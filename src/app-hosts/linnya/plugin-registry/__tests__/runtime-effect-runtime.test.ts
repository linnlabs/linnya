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
