import type {
  CommandPermissionSettingsReadResultV1,
  CommandPermissionSettingsUpdateResultV1,
  CommandPermissionSettingsUpdateV1,
} from '@app/schemas/commands';

export interface CommandPermissionSettingsRendererGatewayPort {
  read(): Promise<CommandPermissionSettingsReadResultV1>;
  update(
    update: CommandPermissionSettingsUpdateV1,
  ): Promise<CommandPermissionSettingsUpdateResultV1>;
}
