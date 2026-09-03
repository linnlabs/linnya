import { ipcMain } from 'electron';

import {
  COMMAND_PERMISSION_SETTINGS_READ_CHANNEL,
  COMMAND_PERMISSION_SETTINGS_UPDATE_CHANNEL,
  CommandPermissionSettingsReadResultV1Schema,
  CommandPermissionSettingsUpdateResultV1Schema,
  CommandPermissionSettingsUpdateV1Schema,
} from '@app/schemas/commands';
import type { CommandPermissionSettingsRendererGatewayPort } from 'src/app-hosts/linnya/adapters/commands/permission-settings-authority';

export interface RegisterCommandPermissionSettingsHandlersOptions {
  readonly gateway: CommandPermissionSettingsRendererGatewayPort;
}

export function registerCommandPermissionSettingsHandlers(
  options: RegisterCommandPermissionSettingsHandlersOptions,
): void {
  const { gateway } = options;

  ipcMain.handle(
    COMMAND_PERMISSION_SETTINGS_READ_CHANNEL,
    async () => {
      return CommandPermissionSettingsReadResultV1Schema.parse(await gateway.read());
    },
  );

  ipcMain.handle(
    COMMAND_PERMISSION_SETTINGS_UPDATE_CHANNEL,
    async (_event, rawUpdate: unknown) => {
      const parsed = CommandPermissionSettingsUpdateV1Schema.safeParse(rawUpdate);
      if (!parsed.success) {
        return CommandPermissionSettingsUpdateResultV1Schema.parse({
          success: false,
          code: 'invalid_update',
        });
      }
      return CommandPermissionSettingsUpdateResultV1Schema.parse(
        await gateway.update(parsed.data),
      );
    },
  );
}
