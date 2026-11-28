import { describe, expect, it } from 'vitest';
import {
  CommandAgentRunIdSchema,
  CommandExecutionIdentitySchema,
} from '@app/schemas/commands';

import type { CommandPermissionSettingsPort } from '../../../ports/commandPermissionSettingsPort';
import {
  DEFAULT_COMMAND_PERMISSION_SETTINGS,
  createInitialCommandPermissionSnapshot,
  readCommandPermissionSettings,
  serializeCommandPermissionSettings,
  snapshotCommandPermissionSettingsForRun,
  updateCommandPermissionSettings,
} from '..';

function createMemoryPort(
  initial: string | undefined = serializeCommandPermissionSettings(
    DEFAULT_COMMAND_PERMISSION_SETTINGS,
  ),
): {
  readonly port: CommandPermissionSettingsPort;
  readSerialized(): string | undefined;
} {
  let serialized = initial;
  return {
    port: {
      read: () => serialized === undefined
        ? { status: 'missing' }
        : { status: 'found', serialized },
      write: (value) => {
        serialized = value;
        return { status: 'written' };
      },
    },
    readSerialized: () => serialized,
  };
}

describe('command permission settings business flow', () => {
  it('已初始化默认值可更新，且只改变可配置字段并递增 revision', () => {
    const memory = createMemoryPort();
    expect(readCommandPermissionSettings(memory.port)).toEqual({
      schema_version: 1,
      kind: 'command_permission_settings',
      revision: 0,
      permission_level: 'standard',
      internal_data_access: 'allowed',
      external_command_approval: 'user_only',
      gui_control: 'denied',
      local_ipc_control: 'denied',
      process_lifecycle: 'terminate_with_run',
    });

    const updated = updateCommandPermissionSettings({
      port: memory.port,
      update: {
        schema_version: 1,
        kind: 'command_permission_settings_update',
        expected_revision: 0,
        permission_level: 'read_only',
        internal_data_access: 'denied',
        external_command_approval: 'user_only',
      },
    });
    expect(updated).toMatchObject({
      revision: 1,
      permission_level: 'read_only',
      internal_data_access: 'denied',
      gui_control: 'denied',
      local_ipc_control: 'denied',
      process_lifecycle: 'terminate_with_run',
    });
    expect(readCommandPermissionSettings(memory.port)).toEqual(updated);
    expect(memory.readSerialized()?.endsWith('\n')).toBe(true);
  });

  it('0.4 之前写下的文档没有“命令行代批”一项：按只有用户能批读入，用户打开后才落盘为允许', () => {
    const legacy = {
      schema_version: 1,
      kind: 'command_permission_settings',
      revision: 4,
      permission_level: 'full_access',
      internal_data_access: 'denied',
      gui_control: 'denied',
      local_ipc_control: 'denied',
      process_lifecycle: 'terminate_with_run',
    };
    const memory = createMemoryPort(`${JSON.stringify(legacy, null, 2)}\n`);
    // 旧文档照常可读，其余设置原样保留；缺的那一项取最严的值。
    expect(readCommandPermissionSettings(memory.port)).toEqual({ ...legacy, external_command_approval: 'user_only' });

    const opened = updateCommandPermissionSettings({
      port: memory.port,
      update: {
        schema_version: 1,
        kind: 'command_permission_settings_update',
        expected_revision: 4,
        permission_level: 'full_access',
        internal_data_access: 'denied',
        external_command_approval: 'allowed',
      },
    });
    expect(opened).toEqual({ ...legacy, revision: 5, external_command_approval: 'allowed' });
    expect(JSON.parse(memory.readSerialized() ?? '')).toEqual(opened);

    // 更新必须写明这一项；缺省不被解释成“保持原值”或“关闭”。
    expect(() => updateCommandPermissionSettings({
      port: memory.port,
      update: {
        schema_version: 1,
        kind: 'command_permission_settings_update',
        expected_revision: 5,
        permission_level: 'full_access',
        internal_data_access: 'denied',
      },
    })).toThrow(expect.objectContaining({ code: 'invalid_update' }));
    expect(readCommandPermissionSettings(memory.port)).toEqual(opened);
  });

  it('缺失配置明确不可用，不能在普通读取路径静默恢复为 standard', () => {
    const missingPort: CommandPermissionSettingsPort = {
      read: () => ({ status: 'missing' }),
      write: () => ({ status: 'written' }),
    };
    expect(() => readCommandPermissionSettings(missingPort)).toThrow(
      expect.objectContaining({ code: 'invalid_config' }),
    );
    expect(snapshotCommandPermissionSettingsForRun({
      port: missingPort,
      rootAgentRunId: CommandAgentRunIdSchema.parse('run_missing_config'),
    })).toEqual({
      status: 'unavailable',
      code: 'permission_settings_unavailable',
      reason: 'invalid_config',
    });
  });

  it('拒绝旧 revision 覆盖新设置，并保留已经提交的文档', () => {
    const memory = createMemoryPort();
    const first = updateCommandPermissionSettings({
      port: memory.port,
      update: {
        schema_version: 1,
        kind: 'command_permission_settings_update',
        expected_revision: 0,
        permission_level: 'full_access',
        internal_data_access: 'allowed',
        external_command_approval: 'user_only',
      },
    });

    expect(() => updateCommandPermissionSettings({
      port: memory.port,
      update: {
        schema_version: 1,
        kind: 'command_permission_settings_update',
        expected_revision: 0,
        permission_level: 'read_only',
        internal_data_access: 'denied',
        external_command_approval: 'user_only',
      },
    })).toThrow(expect.objectContaining({ code: 'revision_conflict' }));
    expect(readCommandPermissionSettings(memory.port)).toEqual(first);
  });

  it.each([
    ['坏 JSON', '{'],
    ['未知版本', JSON.stringify({
      schema_version: 2,
      kind: 'command_permission_settings',
      revision: 1,
      permission_level: 'standard',
      internal_data_access: 'allowed',
      gui_control: 'denied',
      local_ipc_control: 'denied',
      process_lifecycle: 'terminate_with_run',
    })],
    ['未知权限', JSON.stringify({
      schema_version: 1,
      kind: 'command_permission_settings',
      revision: 1,
      permission_level: 'unrestricted',
      internal_data_access: 'allowed',
      gui_control: 'denied',
      local_ipc_control: 'denied',
      process_lifecycle: 'terminate_with_run',
    })],
  ])('%s 不得回退到默认权限', (_label, serialized) => {
    const memory = createMemoryPort(serialized);
    expect(() => readCommandPermissionSettings(memory.port)).toThrow(
      expect.objectContaining({
        code: 'invalid_config',
      }),
    );
    expect(snapshotCommandPermissionSettingsForRun({
      port: memory.port,
      rootAgentRunId: CommandAgentRunIdSchema.parse('run_corrupt_config'),
    })).toEqual({
      status: 'unavailable',
      code: 'permission_settings_unavailable',
      reason: 'invalid_config',
    });
  });

  it('读取失败形成不可用状态，不扩大为标准或完全访问', () => {
    const port: CommandPermissionSettingsPort = {
      read: () => ({ status: 'failed', message: 'disk unavailable' }),
      write: () => ({ status: 'written' }),
    };
    expect(snapshotCommandPermissionSettingsForRun({
      port,
      rootAgentRunId: CommandAgentRunIdSchema.parse('run_read_failed'),
    })).toEqual({
      status: 'unavailable',
      code: 'permission_settings_unavailable',
      reason: 'read_failed',
    });
  });

  it('command 初始权限只从根 run 快照投影并绑定自己的 execution identity', () => {
    const memory = createMemoryPort();
    const runPermission = snapshotCommandPermissionSettingsForRun({
      port: memory.port,
      rootAgentRunId: CommandAgentRunIdSchema.parse('run_permission_projection'),
      now: () => 100,
    });
    if (runPermission.status !== 'available') {
      throw new Error('expected available permission settings');
    }
    const identity = CommandExecutionIdentitySchema.parse({
      conversation_id: 'permission-projection-conversation',
      agent_run_id: 'run_permission_projection',
      origin_tool_call_id: 'permission-projection-tool-call',
      command_execution_id: 'command_execution_10000000-0000-4000-8000-000000000001',
      owner_generation_id: 'command_owner_10000000-0000-4000-8000-000000000002',
      created_at_ms: 101,
    });
    expect(createInitialCommandPermissionSnapshot({
      runSnapshot: runPermission.snapshot,
      identity,
    })).toEqual({
      protocol_version: 1,
      kind: 'command_permission_snapshot',
      identity,
      base_level: 'standard',
      effective_level: 'standard',
      grant_source: 'global_setting',
      internal_data_access: 'allowed',
    });
  });
});
