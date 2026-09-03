import type { CommandConversationMatcherContext } from '@app/schemas/commands';

import {
  COMMAND_AUTHORIZATION_MATCHER_REVISION,
  SUPPORTED_SIMPLE_COMMAND_SHELLS,
} from '../definitions/simpleCommand';

export function isSupportedSimpleCommandContext(
  context: CommandConversationMatcherContext,
): boolean {
  if (context.matcher_revision !== COMMAND_AUTHORIZATION_MATCHER_REVISION) return false;
  if (context.platform === 'macos') {
    return SUPPORTED_SIMPLE_COMMAND_SHELLS.macos.some(
      shell => shell === context.shell_semantics_id,
    );
  }
  return SUPPORTED_SIMPLE_COMMAND_SHELLS.windows.some(
    shell => shell === context.shell_semantics_id,
  );
}
