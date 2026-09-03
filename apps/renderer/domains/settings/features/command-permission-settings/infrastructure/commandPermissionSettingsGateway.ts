import {
  CommandPermissionSettingsReadResultV1Schema,
  CommandPermissionSettingsUpdateResultV1Schema,
  type CommandPermissionSettingsReadResultV1,
  type CommandPermissionSettingsUpdateResultV1,
  type CommandPermissionSettingsUpdateV1,
} from '@app/schemas/commands';

export interface CommandPermissionSettingsGateway {
  read(): Promise<CommandPermissionSettingsReadResultV1>;
  update(
    update: CommandPermissionSettingsUpdateV1,
  ): Promise<CommandPermissionSettingsUpdateResultV1>;
}

export const commandPermissionSettingsGateway: CommandPermissionSettingsGateway = {
  async read() {
    const raw = await window.electronAPI.readCommandPermissionSettings();
    return CommandPermissionSettingsReadResultV1Schema.parse(raw);
  },
  async update(update) {
    const raw = await window.electronAPI.updateCommandPermissionSettings(update);
    return CommandPermissionSettingsUpdateResultV1Schema.parse(raw);
  },
};
