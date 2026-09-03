import type { CommandPermissionSettingsV1 } from '@app/schemas/commands';

/** 持久化格式集中在 domain，避免 UI 与运行时各自产生不同的设置文档。 */
export function serializeCommandPermissionSettings(
  settings: CommandPermissionSettingsV1,
): string {
  return `${JSON.stringify(settings, null, 2)}\n`;
}
