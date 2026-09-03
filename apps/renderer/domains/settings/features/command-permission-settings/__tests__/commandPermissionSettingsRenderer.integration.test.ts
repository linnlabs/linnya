import { createPinia, setActivePinia, type Pinia } from 'pinia';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  CommandPermissionSettingsV1Schema,
  type CommandPermissionSettingsUpdateV1,
  type CommandPermissionSettingsV1,
} from '@app/schemas/commands';

import type { CommandPermissionSettingsGateway } from '../infrastructure/commandPermissionSettingsGateway';
import { applyCommandPermissionSettingsChange } from '../orchestration/applyCommandPermissionSettingsChange';
import { ensureCommandPermissionSettingsLoaded } from '../orchestration/ensureCommandPermissionSettingsLoaded';
import { useCommandPermissionSettingsStore } from '../store/commandPermissionSettingsStore';

function settings(input: Partial<CommandPermissionSettingsV1> = {}): CommandPermissionSettingsV1 {
  return CommandPermissionSettingsV1Schema.parse({
    schema_version: 1,
    kind: 'command_permission_settings',
    revision: 0,
    permission_level: 'standard',
    internal_data_access: 'allowed',
    gui_control: 'denied',
    local_ipc_control: 'denied',
    process_lifecycle: 'terminate_with_run',
    ...input,
  });
}

function memoryGateway(initial: CommandPermissionSettingsV1 = settings()) {
  let backend = initial;
  let failWrite = false;
  const updates: CommandPermissionSettingsUpdateV1[] = [];
  const gateway: CommandPermissionSettingsGateway = {
    read: async () => ({ success: true, settings: backend }),
    update: async (update) => {
      updates.push(update);
      if (update.expected_revision !== backend.revision) {
        return { success: false, code: 'revision_conflict', settings: backend };
      }
      if (failWrite) return { success: false, code: 'write_failed', settings: backend };
      backend = settings({
        revision: backend.revision + 1,
        permission_level: update.permission_level,
        internal_data_access: update.internal_data_access,
      });
      return { success: true, settings: backend };
    },
  };
  return {
    gateway,
    updates,
    backend: () => backend,
    failNextWrite: () => {
      failWrite = true;
    },
  };
}

async function loadIn(pinia: Pinia, gateway: CommandPermissionSettingsGateway): Promise<void> {
  setActivePinia(pinia);
  await ensureCommandPermissionSettingsLoaded(gateway);
}

describe('command permission settings renderer write slice', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('每次选择都立即写入并同步 backend projection 与界面值', async () => {
    const memory = memoryGateway();
    await ensureCommandPermissionSettingsLoaded(memory.gateway);
    const store = useCommandPermissionSettingsStore();
    await applyCommandPermissionSettingsChange({
      kind: 'permission_level',
      value: 'read_only',
    }, { gateway: memory.gateway });
    await applyCommandPermissionSettingsChange({
      kind: 'internal_data_access',
      value: 'denied',
    }, { gateway: memory.gateway });

    expect(memory.updates).toEqual([
      {
        schema_version: 1,
        kind: 'command_permission_settings_update',
        expected_revision: 0,
        permission_level: 'read_only',
        internal_data_access: 'allowed',
      },
      {
        schema_version: 1,
        kind: 'command_permission_settings_update',
        expected_revision: 1,
        permission_level: 'read_only',
        internal_data_access: 'denied',
      },
    ]);
    expect(store.projection?.revision).toBe(2);
    expect(store.draft).toEqual({
      permissionLevel: 'read_only',
      internalDataAccess: 'denied',
    });
    expect(store.isDirty).toBe(false);
    expect(store.saveState).toBe('saved');
  });

  it('两个页面并发时拒绝旧 revision，并恢复页面 B 的最新后端事实', async () => {
    const memory = memoryGateway();
    const pageA = createPinia();
    const pageB = createPinia();
    await loadIn(pageA, memory.gateway);
    await loadIn(pageB, memory.gateway);

    setActivePinia(pageA);
    await applyCommandPermissionSettingsChange({
      kind: 'permission_level',
      value: 'read_only',
    }, { gateway: memory.gateway });

    setActivePinia(pageB);
    const storeB = useCommandPermissionSettingsStore();
    await applyCommandPermissionSettingsChange({
      kind: 'permission_level',
      value: 'full_access',
    }, {
      gateway: memory.gateway,
      confirmExpansion: async () => true,
    });
    expect(storeB.saveFailure).toBe('revision_conflict');
    expect(storeB.projection?.revision).toBe(1);
    expect(storeB.projection?.permissionLevel).toBe('read_only');
    expect(storeB.draft?.permissionLevel).toBe('read_only');
    expect(storeB.isDirty).toBe(false);

    await applyCommandPermissionSettingsChange({
      kind: 'permission_level',
      value: 'full_access',
    }, {
      gateway: memory.gateway,
      confirmExpansion: async () => true,
    });
    expect(storeB.saveState).toBe('saved');
    expect(storeB.projection?.revision).toBe(2);
    expect(memory.backend().permission_level).toBe('full_access');
  });

  it('renderer reload 重新读取 backend revision', async () => {
    const memory = memoryGateway(settings({ revision: 4, permission_level: 'standard' }));
    const reloadedPage = createPinia();
    await loadIn(reloadedPage, memory.gateway);
    const reloaded = useCommandPermissionSettingsStore();
    expect(reloaded.projection?.revision).toBe(4);
    expect(reloaded.draft?.permissionLevel).toBe('standard');
    expect(reloaded.isDirty).toBe(false);
  });

  it('同一页面重复加载只读取一次', async () => {
    const memory = memoryGateway();
    let reads = 0;
    const gateway: CommandPermissionSettingsGateway = {
      read: async () => {
        reads += 1;
        return memory.gateway.read();
      },
      update: update => memory.gateway.update(update),
    };

    await Promise.all([
      ensureCommandPermissionSettingsLoaded(gateway),
      ensureCommandPermissionSettingsLoaded(gateway),
    ]);
    await ensureCommandPermissionSettingsLoaded(gateway);

    expect(reads).toBe(1);
    expect(useCommandPermissionSettingsStore().projection?.permissionLevel).toBe('standard');
  });

  it('持久化失败恢复真实 backend，坏配置不补 renderer 默认值', async () => {
    const memory = memoryGateway(settings({ revision: 2 }));
    memory.failNextWrite();
    await ensureCommandPermissionSettingsLoaded(memory.gateway);
    const store = useCommandPermissionSettingsStore();
    await applyCommandPermissionSettingsChange({
      kind: 'permission_level',
      value: 'read_only',
    }, { gateway: memory.gateway });
    expect(store.saveFailure).toBe('write_failed');
    expect(store.projection?.permissionLevel).toBe('standard');
    expect(store.projection?.revision).toBe(2);
    expect(store.draft?.permissionLevel).toBe('standard');
    expect(store.isDirty).toBe(false);
    expect(memory.backend().permission_level).toBe('standard');

    const rejectedGateway: CommandPermissionSettingsGateway = {
      read: async () => ({ success: false, code: 'invalid_config' }),
      update: async () => ({ success: false, code: 'invalid_config' }),
    };
    // renderer reload 使用新的 Pinia owner；同一页面的 ensure 不会覆盖已加载事实和草稿。
    setActivePinia(createPinia());
    await ensureCommandPermissionSettingsLoaded(rejectedGateway);
    const reloadedStore = useCommandPermissionSettingsStore();
    expect(reloadedStore.loadState).toBe('unavailable');
    expect(reloadedStore.projection).toBeUndefined();
    expect(reloadedStore.draft).toBeUndefined();
  });

  it('只读到标准和标准到完全访问都确认，取消后回滚，降低权限直接生效', async () => {
    const memory = memoryGateway(settings({ permission_level: 'read_only' }));
    await ensureCommandPermissionSettingsLoaded(memory.gateway);
    let confirmations = 0;
    await applyCommandPermissionSettingsChange({
      kind: 'permission_level',
      value: 'standard',
    }, {
      gateway: memory.gateway,
      confirmExpansion: async () => {
        confirmations += 1;
        return false;
      },
    });
    expect(confirmations).toBe(1);
    expect(memory.updates).toEqual([]);
    expect(useCommandPermissionSettingsStore().draft?.permissionLevel).toBe('read_only');

    await applyCommandPermissionSettingsChange({
      kind: 'permission_level',
      value: 'standard',
    }, {
      gateway: memory.gateway,
      confirmExpansion: async () => {
        confirmations += 1;
        return true;
      },
    });
    await applyCommandPermissionSettingsChange({
      kind: 'permission_level',
      value: 'full_access',
    }, {
      gateway: memory.gateway,
      confirmExpansion: async () => {
        confirmations += 1;
        return true;
      },
    });
    await applyCommandPermissionSettingsChange({
      kind: 'permission_level',
      value: 'standard',
    }, {
      gateway: memory.gateway,
      confirmExpansion: async () => {
        confirmations += 1;
        return true;
      },
    });

    expect(confirmations).toBe(3);
    expect(memory.updates).toHaveLength(3);
    expect(memory.backend().permission_level).toBe('standard');
  });
});
