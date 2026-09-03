import {
  CommandPermissionSnapshotV1Schema,
  CommandPermissionSettingsUpdateV1Schema,
  CommandPermissionSettingsV1Schema,
  CommandRunPermissionSnapshotV1Schema,
  type CommandAgentRunId,
  type CommandExecutionIdentity,
  type CommandPermissionSnapshotV1,
  type CommandPermissionSettingsUpdateV1,
  type CommandPermissionSettingsV1,
  type CommandRunPermissionSnapshotV1,
} from '@app/schemas/commands';

import { CommandPermissionSettingsError } from '../definitions/commandPermissionSettings';

function formatValidationIssues(error: {
  readonly issues: ReadonlyArray<{ readonly path: ReadonlyArray<string | number>; readonly message: string }>;
}): string {
  return error.issues
    .map(issue => `${issue.path.join('.') || '<root>'}: ${issue.message}`)
    .join('; ');
}

export function validateCommandPermissionSettings(
  value: unknown,
): CommandPermissionSettingsV1 {
  const result = CommandPermissionSettingsV1Schema.safeParse(value);
  if (!result.success) {
    throw new CommandPermissionSettingsError(
      'invalid_config',
      `命令权限设置的结构或版本无效：${formatValidationIssues(result.error)}`,
    );
  }
  return result.data;
}

export function validateCommandPermissionSettingsUpdate(
  value: unknown,
): CommandPermissionSettingsUpdateV1 {
  const result = CommandPermissionSettingsUpdateV1Schema.safeParse(value);
  if (!result.success) {
    throw new CommandPermissionSettingsError(
      'invalid_update',
      `命令权限设置更新无效：${formatValidationIssues(result.error)}`,
    );
  }
  return result.data;
}

export function createCommandRunPermissionSnapshot(input: {
  readonly settings: CommandPermissionSettingsV1;
  readonly rootAgentRunId: CommandAgentRunId;
  readonly capturedAtMs: number;
}): CommandRunPermissionSnapshotV1 {
  return CommandRunPermissionSnapshotV1Schema.parse({
    protocol_version: 1,
    kind: 'command_run_permission_snapshot',
    root_agent_run_id: input.rootAgentRunId,
    settings_revision: input.settings.revision,
    captured_at_ms: input.capturedAtMs,
    permission_level: input.settings.permission_level,
    internal_data_access: input.settings.internal_data_access,
    gui_control: input.settings.gui_control,
    local_ipc_control: input.settings.local_ipc_control,
    process_lifecycle: input.settings.process_lifecycle,
  });
}

/**
 * command proposal 只从所属根 run 的快照投影初始权限，不能再次读取全局设置。
 * 单条批准产生的临时标准权限仍由 command-authorization 独立处理。
 */
export function createInitialCommandPermissionSnapshot(input: {
  readonly runSnapshot: CommandRunPermissionSnapshotV1;
  readonly identity: CommandExecutionIdentity;
}): CommandPermissionSnapshotV1 {
  return CommandPermissionSnapshotV1Schema.parse({
    protocol_version: 1,
    kind: 'command_permission_snapshot',
    identity: input.identity,
    base_level: input.runSnapshot.permission_level,
    effective_level: input.runSnapshot.permission_level,
    grant_source: 'global_setting',
    internal_data_access: input.runSnapshot.internal_data_access,
  });
}
