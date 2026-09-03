import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getDefaultSandboxService } from '../../../../features/sandbox/sandboxCompositionRoot';
import type { SandboxProfile } from '../../../../features/sandbox/types';
import {
  ensureBuiltinBackendPluginsRegistered,
  syncRegisteredBackendPluginSandboxProfiles,
} from '../builtin';
import { pluginDiagnostics } from '../diagnostics';
import {
  backendPluginRegistry,
  type BackendPluginSandboxProfileRegistration,
} from '../registry';
import {
  clearSyncedBackendPluginSandboxProfilesForTests,
  syncBackendPluginSandboxProfiles,
} from '../sandboxProfileRuntime';
import {
  clearPluginRuntimeStateForTests,
  setPluginRuntimeStateForTests,
} from '../pluginRuntimeState';

function makeProfile(id: string): SandboxProfile {
  return {
    id,
    policyVersion: 'test',
    allowedCapabilities: new Set(),
    buildPolicy() {
      throw new Error('test profile should not execute buildPolicy');
    },
    prepareExecution() {
      throw new Error('test profile should not execute prepareExecution');
    },
    finalizeExecution() {
      throw new Error('test profile should not execute finalizeExecution');
    },
  };
}

describe('backend plugin sandbox profile runtime', () => {
  const pluginId = 'sandbox-profile-fixture';
  const profileId = 'fixture-profile';

  beforeEach(() => {
    pluginDiagnostics.clear();
    clearSyncedBackendPluginSandboxProfilesForTests();
    clearPluginRuntimeStateForTests();
  });

  afterEach(() => {
    clearSyncedBackendPluginSandboxProfilesForTests();
    clearPluginRuntimeStateForTests();
    pluginDiagnostics.clear();
  });

  it('只挂载 enabled 插件的 sandbox profile，禁用后注销', () => {
    const sandboxService = getDefaultSandboxService();
    ensureBuiltinBackendPluginsRegistered();
    if (!backendPluginRegistry.has(pluginId)) {
      backendPluginRegistry.register({
        meta: {
          id: pluginId,
          name: pluginId,
          version: '1.0.0',
          description: 'Sandbox profile runtime fixture',
          developer: 'Linnya',
          builtin: false,
        },
        sandboxProfiles: [makeProfile(profileId)],
      });
    }

    setPluginRuntimeStateForTests({
      installedPluginIds: ['platform', pluginId],
      enabledPluginIds: ['platform'],
    });
    syncRegisteredBackendPluginSandboxProfiles();

    expect(sandboxService.hasProfile(profileId)).toBe(false);
    expect(sandboxService.listProfileIds()).not.toContain(profileId);

    setPluginRuntimeStateForTests({
      installedPluginIds: ['platform', pluginId],
      enabledPluginIds: ['platform', pluginId],
    });
    syncRegisteredBackendPluginSandboxProfiles();

    expect(sandboxService.hasProfile(profileId)).toBe(true);
    expect(sandboxService.listProfileIds()).toContain(profileId);

    setPluginRuntimeStateForTests({
      installedPluginIds: ['platform', pluginId],
      enabledPluginIds: ['platform'],
    });
    syncRegisteredBackendPluginSandboxProfiles();

    expect(sandboxService.hasProfile(profileId)).toBe(false);
    expect(sandboxService.listProfileIds()).not.toContain(profileId);
  });

  it('拒绝两个 enabled 插件声明同一个 sandbox profile id', () => {
    const profile = makeProfile('duplicate');
    const registrations: BackendPluginSandboxProfileRegistration[] = [
      { pluginId: 'first-plugin', profile },
      { pluginId: 'second-plugin', profile },
    ];

    expect(() => syncBackendPluginSandboxProfiles(registrations))
      .toThrow('sandbox profile id 冲突: duplicate (first-plugin, second-plugin)');
    expect(getDefaultSandboxService().hasProfile('duplicate')).toBe(false);
  });

  it('拒绝插件覆盖非插件运行态注册的 sandbox profile', () => {
    const sandboxService = getDefaultSandboxService();
    sandboxService.registerProfile(makeProfile('host-owned'));

    try {
      expect(() => syncBackendPluginSandboxProfiles([
        { pluginId: 'plugin-owned', profile: makeProfile('host-owned') },
      ])).toThrow('sandbox profile 已被非插件运行态注册，拒绝覆盖: host-owned');
    } finally {
      sandboxService.unregisterProfile('host-owned');
    }
  });
});
