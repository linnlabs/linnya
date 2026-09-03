import type {
  CommandInternalDataAccess,
  CommandPermissionLevel,
  CommandPermissionSettingsV1,
} from '@app/schemas/commands';

export interface CommandPermissionSettingsProjection {
  readonly revision: number;
  readonly permissionLevel: CommandPermissionLevel;
  readonly internalDataAccess: CommandInternalDataAccess;
  readonly guiControl: 'denied';
  readonly localIpcControl: 'denied';
  readonly processLifecycle: 'terminate_with_run';
}

export interface CommandPermissionSettingsDraft {
  readonly permissionLevel: CommandPermissionLevel;
  readonly internalDataAccess: CommandInternalDataAccess;
}

export function createCommandPermissionSettingsDraft(
  projection: CommandPermissionSettingsProjection,
): CommandPermissionSettingsDraft {
  return {
    permissionLevel: projection.permissionLevel,
    internalDataAccess: projection.internalDataAccess,
  };
}

export function projectCommandPermissionSettings(
  settings: CommandPermissionSettingsV1,
): CommandPermissionSettingsProjection {
  return {
    revision: settings.revision,
    permissionLevel: settings.permission_level,
    internalDataAccess: settings.internal_data_access,
    guiControl: settings.gui_control,
    localIpcControl: settings.local_ipc_control,
    processLifecycle: settings.process_lifecycle,
  };
}
