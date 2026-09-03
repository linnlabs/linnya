import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  COMMAND_PERMISSION_SETTINGS_READ_CHANNEL,
  COMMAND_PERMISSION_SETTINGS_UPDATE_CHANNEL,
  CommandPermissionSettingsV1Schema,
  CommandPermissionSettingsReadResultV1Schema,
  CommandPermissionSettingsUpdateResultV1Schema,
} from '@app/schemas/commands';
import type { CommandPermissionSettingsPort } from 'src/domains/commands/ports';
import {
  DEFAULT_COMMAND_PERMISSION_SETTINGS,
  serializeCommandPermissionSettings,
} from 'src/domains/commands/features/permission-settings';
import { createLocalCommandPermissionSettingsRendererGateway } from 'src/app-hosts/linnya/adapters/commands/permission-settings-authority';

type IpcHandler = (event: unknown, raw?: unknown) => unknown;
const registeredHandlers = new Map<string, IpcHandler>();

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: IpcHandler) => {
      registeredHandlers.set(channel, handler);
    }),
  },
}));

async function registerWithPort(port: CommandPermissionSettingsPort): Promise<void> {
  const { registerCommandPermissionSettingsHandlers } = await import(
    './command-permission-settings-ipc'
  );
  registerCommandPermissionSettingsHandlers({
    gateway: createLocalCommandPermissionSettingsRendererGateway(port),
  });
}

async function invokeRead(): Promise<unknown> {
  const handler = registeredHandlers.get(COMMAND_PERMISSION_SETTINGS_READ_CHANNEL);
  if (!handler) throw new Error('命令权限读取 handler 未注册');
  return handler(undefined);
}

async function invokeUpdate(raw: unknown): Promise<unknown> {
  const handler = registeredHandlers.get(COMMAND_PERMISSION_SETTINGS_UPDATE_CHANNEL);
  if (!handler) throw new Error('命令权限更新 handler 未注册');
  return handler(undefined, raw);
}

describe('command permission settings IPC', () => {
  beforeEach(() => {
    registeredHandlers.clear();
    vi.resetModules();
  });

  it('缺少配置时关闭读取，不在 IPC 路径静默恢复默认权限', async () => {
    await registerWithPort({
      read: () => ({ status: 'missing' }),
      write: () => ({ status: 'written' }),
    });

    await expect(invokeRead()).resolves.toEqual({ success: false, code: 'invalid_config' });
  });

  it('损坏配置关闭读取且不向 renderer 泄露文件内容', async () => {
    await registerWithPort({
      read: () => ({ status: 'found', serialized: '{broken-json' }),
      write: () => ({ status: 'written' }),
    });

    await expect(invokeRead()).resolves.toEqual({ success: false, code: 'invalid_config' });
  });

  it('更新两个可变字段并保持固定能力关闭', async () => {
    let serialized = serializeCommandPermissionSettings(DEFAULT_COMMAND_PERMISSION_SETTINGS);
    await registerWithPort({
      read: () => ({ status: 'found', serialized }),
      write: (next) => {
        serialized = next;
        return { status: 'written' };
      },
    });

    expect(CommandPermissionSettingsUpdateResultV1Schema.parse(await invokeUpdate({
      schema_version: 1,
      kind: 'command_permission_settings_update',
      expected_revision: 0,
      permission_level: 'full_access',
      internal_data_access: 'denied',
    }))).toEqual({
      success: true,
      settings: {
        schema_version: 1,
        kind: 'command_permission_settings',
        revision: 1,
        permission_level: 'full_access',
        internal_data_access: 'denied',
        gui_control: 'denied',
        local_ipc_control: 'denied',
        process_lifecycle: 'terminate_with_run',
      },
    });
  });

  it('旧 revision 被拒绝并回读最新 backend 事实', async () => {
    const backendSettings = CommandPermissionSettingsV1Schema.parse({
      schema_version: 1,
      kind: 'command_permission_settings',
      revision: 9,
      permission_level: 'read_only',
      internal_data_access: 'denied',
      gui_control: 'denied',
      local_ipc_control: 'denied',
      process_lifecycle: 'terminate_with_run',
    });
    const serialized = JSON.stringify(backendSettings);
    let writes = 0;
    await registerWithPort({
      read: () => ({ status: 'found', serialized }),
      write: () => {
        writes += 1;
        return { status: 'written' };
      },
    });

    expect(await invokeUpdate({
      schema_version: 1,
      kind: 'command_permission_settings_update',
      expected_revision: 8,
      permission_level: 'full_access',
      internal_data_access: 'allowed',
    })).toEqual({
      success: false,
      code: 'revision_conflict',
      settings: backendSettings,
    });
    expect(writes).toBe(0);
  });

  it('坏 wire 不写入，写入失败保持并回读旧事实', async () => {
    const backendSettings = CommandPermissionSettingsV1Schema.parse({
      schema_version: 1,
      kind: 'command_permission_settings',
      revision: 2,
      permission_level: 'standard',
      internal_data_access: 'allowed',
      gui_control: 'denied',
      local_ipc_control: 'denied',
      process_lifecycle: 'terminate_with_run',
    });
    const serialized = JSON.stringify(backendSettings);
    let writes = 0;
    await registerWithPort({
      read: () => ({ status: 'found', serialized }),
      write: () => {
        writes += 1;
        return { status: 'failed', message: 'disk full: /private/settings.json' };
      },
    });

    expect(await invokeUpdate({ expected_revision: 2 })).toEqual({
      success: false,
      code: 'invalid_update',
    });
    expect(writes).toBe(0);

    expect(await invokeUpdate({
      schema_version: 1,
      kind: 'command_permission_settings_update',
      expected_revision: 2,
      permission_level: 'read_only',
      internal_data_access: 'denied',
    })).toEqual({
      success: false,
      code: 'write_failed',
      settings: backendSettings,
    });
    expect(writes).toBe(1);
  });

  it('preload 专用方法到 main handler 的完整边界不经过通用 invoke 白名单', async () => {
    let serialized = serializeCommandPermissionSettings(DEFAULT_COMMAND_PERMISSION_SETTINGS);
    await registerWithPort({
      read: () => ({ status: 'found', serialized }),
      write: (next) => {
        serialized = next;
        return { status: 'written' };
      },
    });
    const { buildCommandPermissionSettingsPreloadApi } = await import(
      '../../../preload/modules/command-permission-settings-preload'
    );
    const preload = buildCommandPermissionSettingsPreloadApi({
      async invoke(channel, ...args) {
        const handler = registeredHandlers.get(channel);
        if (!handler) throw new Error(`未注册 IPC handler: ${channel}`);
        return handler(undefined, args[0]);
      },
    });

    const before = await preload.readCommandPermissionSettings();
    expect(CommandPermissionSettingsReadResultV1Schema.parse(before)).toMatchObject({
      success: true,
      settings: { revision: 0 },
    });
    const updated = await preload.updateCommandPermissionSettings({
      schema_version: 1,
      kind: 'command_permission_settings_update',
      expected_revision: 0,
      permission_level: 'read_only',
      internal_data_access: 'denied',
    });
    expect(CommandPermissionSettingsUpdateResultV1Schema.parse(updated)).toMatchObject({
      success: true,
      settings: {
        revision: 1,
        permission_level: 'read_only',
        internal_data_access: 'denied',
        gui_control: 'denied',
        local_ipc_control: 'denied',
      },
    });
  });
});
