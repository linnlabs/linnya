import {
  CommandPermissionSettingsV1Schema,
  type CommandPermissionSettingsUpdateV1,
  type CommandPermissionSettingsV1,
} from '@app/schemas/commands';

import type { CommandPermissionSettingsPort } from '../../../ports/commandPermissionSettingsPort';
import { CommandPermissionSettingsError } from '../definitions/commandPermissionSettings';
import { serializeCommandPermissionSettings } from '../functions/serializeCommandPermissionSettings';
import { validateCommandPermissionSettingsUpdate } from '../functions/validateCommandPermissionSettings';
import { readCommandPermissionSettings } from './readCommandPermissionSettings';

export function updateCommandPermissionSettings(input: {
  readonly port: CommandPermissionSettingsPort;
  readonly update: unknown;
}): CommandPermissionSettingsV1 {
  const update: CommandPermissionSettingsUpdateV1 =
    validateCommandPermissionSettingsUpdate(input.update);
  const current = readCommandPermissionSettings(input.port);
  if (current.revision !== update.expected_revision) {
    throw new CommandPermissionSettingsError(
      'revision_conflict',
      `命令权限设置已经变化：期望版本 ${update.expected_revision}，当前版本 ${current.revision}。`,
    );
  }

  const next = CommandPermissionSettingsV1Schema.parse({
    ...current,
    revision: current.revision + 1,
    permission_level: update.permission_level,
    internal_data_access: update.internal_data_access,
  });
  const written = input.port.write(serializeCommandPermissionSettings(next));
  if (written.status === 'failed') {
    throw new CommandPermissionSettingsError('write_failed', written.message);
  }
  return next;
}
