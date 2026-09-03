import type { CommandPermissionSettingsV1 } from '@app/schemas/commands';

import type { CommandPermissionSettingsPort } from '../../../ports/commandPermissionSettingsPort';
import {
  CommandPermissionSettingsError,
} from '../definitions/commandPermissionSettings';
import { validateCommandPermissionSettings } from '../functions/validateCommandPermissionSettings';

export function readCommandPermissionSettings(
  port: CommandPermissionSettingsPort,
): CommandPermissionSettingsV1 {
  const result = port.read();
  if (result.status === 'missing') {
    throw new CommandPermissionSettingsError(
      'invalid_config',
      '命令权限设置缺失。首次默认值必须由 App 初始化流程显式创建。',
    );
  }
  if (result.status === 'failed') {
    throw new CommandPermissionSettingsError('read_failed', result.message);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(result.serialized) as unknown;
  } catch (error: unknown) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new CommandPermissionSettingsError(
      'invalid_config',
      `命令权限设置不是有效 JSON：${reason}`,
    );
  }
  return validateCommandPermissionSettings(parsed);
}
