import type { CommandPermissionLevel, CommandRuntimePlatform } from '@app/schemas/commands';

import type {
  ShellWorkingDirectoryResolution,
} from '../../../../../../domains/commands';
import type {
  ConversationWorkDirectoryResolution,
} from '../../../../../../domains/conversation-files';

export interface ShellWorkingDirectoryAdmissionRequest {
  readonly conversationId: unknown;
  readonly requestedCwd?: string;
  readonly platform: CommandRuntimePlatform;
  readonly permissionLevel: CommandPermissionLevel;
}

export interface ShellWorkingDirectoryAdmission {
  readonly conversationDirectory: ConversationWorkDirectoryResolution;
  readonly workingDirectory: ShellWorkingDirectoryResolution;
}
