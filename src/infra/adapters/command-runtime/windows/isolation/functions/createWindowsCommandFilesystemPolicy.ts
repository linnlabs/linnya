import type { CommandInternalStorageBoundary, CommandPermissionLevel } from '@app/schemas/commands';
import type { WindowsCommandIsolationInput } from '../definitions/windowsCommandIsolation';

/** 与 macOS 使用相同的业务边界：标准档只写本对话，内部批准只对本次身份生效。 */
export function createWindowsCommandFilesystemPolicy(input: {
  readonly helperPath: string;
  readonly permissionLevel: Exclude<CommandPermissionLevel, 'full_access'>;
  readonly conversationRoot: string;
  readonly internalStorage: CommandInternalStorageBoundary;
  readonly internalStorageAccess: boolean;
}): WindowsCommandIsolationInput {
  const readableRoots = input.internalStorageAccess
    ? input.internalStorage.protected_roots
    : [input.conversationRoot, ...input.internalStorage.readable_roots];
  return {
    helperPath: input.helperPath,
    protectedRoots: input.internalStorage.protected_roots,
    readableRoots,
    writeRoots: input.permissionLevel === 'standard'
      ? [input.conversationRoot, ...(input.internalStorageAccess ? input.internalStorage.protected_roots : [])]
      : [],
  };
}
