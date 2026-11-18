import type { CommandPermissionLevel } from '@app/schemas/commands';

export const commandPermissionLabelKeys = {
  read_only: 'settings.commandPermission.level.readOnly',
  standard: 'settings.commandPermission.level.standard',
  full_access: 'settings.commandPermission.level.fullAccess',
} as const satisfies Record<CommandPermissionLevel, string>;
