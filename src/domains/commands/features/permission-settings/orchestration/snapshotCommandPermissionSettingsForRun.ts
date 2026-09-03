import type { CommandAgentRunId } from '@app/schemas/commands';

import type { CommandPermissionSettingsPort } from '../../../ports/commandPermissionSettingsPort';
import {
  CommandPermissionSettingsError,
  type CommandRunPermissionContext,
} from '../definitions/commandPermissionSettings';
import { createCommandRunPermissionSnapshot } from '../functions/validateCommandPermissionSettings';
import { readCommandPermissionSettings } from './readCommandPermissionSettings';

export function snapshotCommandPermissionSettingsForRun(input: {
  readonly port: CommandPermissionSettingsPort;
  readonly rootAgentRunId: CommandAgentRunId;
  readonly now?: () => number;
}): CommandRunPermissionContext {
  try {
    const settings = readCommandPermissionSettings(input.port);
    return {
      status: 'available',
      snapshot: createCommandRunPermissionSnapshot({
        settings,
        rootAgentRunId: input.rootAgentRunId,
        capturedAtMs: (input.now ?? Date.now)(),
      }),
    };
  } catch (error: unknown) {
    if (!(error instanceof CommandPermissionSettingsError)) {
      throw error;
    }
    if (error.code !== 'invalid_config' && error.code !== 'read_failed') {
      throw error;
    }
    return {
      status: 'unavailable',
      code: 'permission_settings_unavailable',
      reason: error.code,
    };
  }
}
