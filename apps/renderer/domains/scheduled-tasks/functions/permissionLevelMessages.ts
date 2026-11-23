import type { CommandPermissionLevel } from '@app/schemas/commands';
import type { SettingsMessageKey } from '@/domains/settings/public';

/** 定时任务沿用设置页的档位名称与说明；新增档位时这里类型报错，不会显示空文案。 */
export const PERMISSION_LEVEL_LABEL_KEYS = {
  read_only: 'settings.commandPermission.level.readOnly',
  standard: 'settings.commandPermission.level.standard',
  full_access: 'settings.commandPermission.level.fullAccess',
} as const satisfies Record<CommandPermissionLevel, SettingsMessageKey>;

export const PERMISSION_LEVEL_DESCRIPTION_KEYS = {
  read_only: 'settings.commandPermission.level.readOnlyDescription',
  standard: 'settings.commandPermission.level.standardDescription',
  full_access: 'settings.commandPermission.level.fullAccessDescription',
} as const satisfies Record<CommandPermissionLevel, SettingsMessageKey>;
