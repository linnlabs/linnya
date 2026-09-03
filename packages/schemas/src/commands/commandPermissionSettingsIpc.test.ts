import { describe, expect, it } from 'vitest';

import {
  CommandPermissionSettingsReadResultV1Schema,
  CommandPermissionSettingsUpdateResultV1Schema,
  CommandPermissionSettingsUpdateV1Schema,
} from './commandPermissionSettings';

describe('CommandPermissionSettingsReadResultV1Schema', () => {
  it('接纳完整后端投影并拒绝 renderer 无法解释的额外字段', () => {
    const valid = {
      success: true,
      settings: {
        schema_version: 1,
        kind: 'command_permission_settings',
        revision: 3,
        permission_level: 'standard',
        internal_data_access: 'allowed',
        gui_control: 'denied',
        local_ipc_control: 'denied',
        process_lifecycle: 'terminate_with_run',
      },
    };

    expect(CommandPermissionSettingsReadResultV1Schema.parse(valid)).toEqual(valid);
    expect(() => CommandPermissionSettingsReadResultV1Schema.parse({
      ...valid,
      can_update_without_single_instance: true,
    })).toThrow();
  });

  it('错误结果不携带配置正文或任意平台错误', () => {
    expect(CommandPermissionSettingsReadResultV1Schema.parse({
      success: false,
      code: 'invalid_config',
    })).toEqual({ success: false, code: 'invalid_config' });

    expect(() => CommandPermissionSettingsReadResultV1Schema.parse({
      success: false,
      code: 'invalid_config',
      error: '{ damaged config body }',
    })).toThrow();
  });
});

describe('CommandPermissionSettings update IPC schemas', () => {
  it('更新请求只允许两个可变字段和 backend revision', () => {
    const valid = {
      schema_version: 1,
      kind: 'command_permission_settings_update',
      expected_revision: 4,
      permission_level: 'full_access',
      internal_data_access: 'denied',
    };
    expect(CommandPermissionSettingsUpdateV1Schema.parse(valid)).toEqual(valid);
    expect(() => CommandPermissionSettingsUpdateV1Schema.parse({
      ...valid,
      gui_control: 'allowed',
    })).toThrow();
    expect(() => CommandPermissionSettingsUpdateV1Schema.parse({
      ...valid,
      local_ipc_control: 'allowed',
    })).toThrow();
  });

  it('冲突和写入失败携带严格 backend 事实，不泄露路径或平台错误', () => {
    const settings = {
      schema_version: 1,
      kind: 'command_permission_settings',
      revision: 5,
      permission_level: 'standard',
      internal_data_access: 'allowed',
      gui_control: 'denied',
      local_ipc_control: 'denied',
      process_lifecycle: 'terminate_with_run',
    };
    expect(CommandPermissionSettingsUpdateResultV1Schema.parse({
      success: false,
      code: 'revision_conflict',
      settings,
    })).toEqual({ success: false, code: 'revision_conflict', settings });
    expect(CommandPermissionSettingsUpdateResultV1Schema.parse({
      success: false,
      code: 'write_failed',
      settings,
    })).toEqual({ success: false, code: 'write_failed', settings });
    expect(() => CommandPermissionSettingsUpdateResultV1Schema.parse({
      success: false,
      code: 'write_failed',
      settings,
      file_path: '/private/settings.json',
    })).toThrow();
  });
});
