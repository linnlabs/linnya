import {
  CommandPermissionSettingsV1Schema,
  type CommandPermissionSettingsV1,
  type CommandRunPermissionSnapshotV1,
} from '@app/schemas/commands';

export const DEFAULT_COMMAND_PERMISSION_SETTINGS: CommandPermissionSettingsV1 =
  Object.freeze(CommandPermissionSettingsV1Schema.parse({
    schema_version: 1,
    kind: 'command_permission_settings',
    revision: 0,
    permission_level: 'standard',
    internal_data_access: 'allowed',
    gui_control: 'denied',
    local_ipc_control: 'denied',
    process_lifecycle: 'terminate_with_run',
  }));

export type CommandPermissionSettingsFailureCode =
  | 'invalid_config'
  | 'invalid_update'
  | 'read_failed'
  | 'write_failed'
  | 'revision_conflict';

export class CommandPermissionSettingsError extends Error {
  readonly name = 'CommandPermissionSettingsError';

  constructor(
    readonly code: CommandPermissionSettingsFailureCode,
    message: string,
  ) {
    super(message);
  }
}

export type CommandRunPermissionContext =
  | {
      readonly status: 'available';
      readonly snapshot: CommandRunPermissionSnapshotV1;
    }
  | {
      readonly status: 'unavailable';
      readonly code: 'permission_settings_unavailable';
      readonly reason: 'invalid_config' | 'read_failed' | 'run_snapshot_missing';
    };
