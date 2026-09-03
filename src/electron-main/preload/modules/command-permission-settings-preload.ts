import {
  COMMAND_PERMISSION_SETTINGS_READ_CHANNEL,
  COMMAND_PERMISSION_SETTINGS_UPDATE_CHANNEL,
  type CommandPermissionSettingsUpdateV1,
} from '@app/schemas/commands';

export interface CommandPermissionSettingsIpcRenderer {
  invoke(channel: string, ...args: unknown[]): Promise<unknown>;
}

export function buildCommandPermissionSettingsPreloadApi(
  ipcRenderer: CommandPermissionSettingsIpcRenderer,
) {
  return {
    readCommandPermissionSettings: (): Promise<unknown> =>
      ipcRenderer.invoke(COMMAND_PERMISSION_SETTINGS_READ_CHANNEL),
    updateCommandPermissionSettings: (
      update: CommandPermissionSettingsUpdateV1,
    ): Promise<unknown> => ipcRenderer.invoke(
      COMMAND_PERMISSION_SETTINGS_UPDATE_CHANNEL,
      update,
    ),
  };
}
