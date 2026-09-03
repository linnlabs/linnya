import type {
  CommandPermissionLevel,
  CommandRuntimePlatform,
  ShellToolArgumentsV1,
} from '@app/schemas/commands';

import type {
  ShellWorkingDirectoryFileSystemOperation,
} from '../../../ports/shellWorkingDirectoryFileSystemPort';

export interface ShellWorkingDirectoryRequest {
  readonly conversationRoot: string;
  readonly requestedCwd?: ShellToolArgumentsV1['cwd'];
  readonly platform: CommandRuntimePlatform;
  readonly permissionLevel: CommandPermissionLevel;
}

export type ShellWorkingDirectorySource = 'conversation_root' | 'explicit';

export interface ShellWorkingDirectoryResolution {
  readonly canonicalPath: string;
  readonly canonicalConversationRoot: string;
  readonly source: ShellWorkingDirectorySource;
  readonly withinConversationRoot: boolean;
}

export type ShellWorkingDirectoryErrorCode =
  | 'cwd_not_found'
  | 'cwd_not_directory'
  | 'cwd_denied'
  | 'cwd_resolution_failed';

export type ShellWorkingDirectoryFailureStage =
  | 'resolve_conversation_root'
  | 'plan_requested_cwd'
  | 'resolve_requested_cwd'
  | 'enforce_permission';

export class ShellWorkingDirectoryError extends Error {
  readonly name = 'ShellWorkingDirectoryError';

  constructor(
    readonly code: ShellWorkingDirectoryErrorCode,
    readonly stage: ShellWorkingDirectoryFailureStage,
    readonly osCode?: string,
    readonly fileSystemOperation?: ShellWorkingDirectoryFileSystemOperation,
  ) {
    super(`${code} at ${stage}`);
  }
}

export interface ShellWorkingDirectoryCandidate {
  readonly absolutePath: string;
  readonly source: ShellWorkingDirectorySource;
}
