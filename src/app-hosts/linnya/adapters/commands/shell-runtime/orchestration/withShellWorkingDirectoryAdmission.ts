import {
  resolveShellWorkingDirectory,
  type ShellWorkingDirectoryFileSystemPort,
} from '../../../../../../domains/commands';
import type {
  ConversationWorkDirectoryAdmissionPort,
} from '../../../../application/conversation-lifecycle';
import type {
  ShellWorkingDirectoryAdmission,
  ShellWorkingDirectoryAdmissionRequest,
} from '../definitions/shellWorkingDirectoryAdmission';

/**
 * cwd 解析和调用方的 owner reservation 都必须留在 lifecycle callback 内。这里只编排
 * 两个 domain 的公开 port；审批、spawn 和命令运行不得放进这个临界区。
 */
export function withShellWorkingDirectoryAdmission<T>(input: {
  readonly request: ShellWorkingDirectoryAdmissionRequest;
  readonly conversationAdmission: ConversationWorkDirectoryAdmissionPort;
  readonly fileSystem: ShellWorkingDirectoryFileSystemPort;
  readonly admitted: (admission: ShellWorkingDirectoryAdmission) => Promise<T> | T;
}): Promise<T> {
  return input.conversationAdmission.withAdmission({
    conversationId: input.request.conversationId,
  }, async conversationDirectory => {
    const workingDirectory = await resolveShellWorkingDirectory({
      request: {
        conversationRoot: conversationDirectory.absolutePath,
        requestedCwd: input.request.requestedCwd,
        platform: input.request.platform,
        permissionLevel: input.request.permissionLevel,
      },
      fileSystem: input.fileSystem,
    });
    return input.admitted(Object.freeze({
      conversationDirectory,
      workingDirectory,
    }));
  });
}
