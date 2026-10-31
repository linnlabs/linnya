import {
  getDefaultWritePaths,
  type SandboxRuntimeConfig,
} from '@anthropic-ai/sandbox-runtime';
import type {
  CommandInternalStorageBoundary,
  CommandPermissionLevel,
} from '@app/schemas/commands';

const persistentDefaultWritePaths = getDefaultWritePaths().filter(
  defaultPath => !defaultPath.startsWith('/dev/'),
);

/**
 * pipe 与 PTY 必须使用同一份 macOS 文件边界。cwd 只决定进程从哪里启动，
 * 标准档的唯一写入根始终是当前对话目录，不能随本次 cd 漂移。
 */
export function createMacOsCommandFilesystemPolicy(input: {
  readonly permissionLevel: CommandPermissionLevel;
  readonly conversationRoot: string;
  readonly internalStorage: CommandInternalStorageBoundary;
  readonly internalStorageAccess: boolean;
}): SandboxRuntimeConfig['filesystem'] {
  return {
    // 这些是 Host 拥有的真实路径；用户名或目录名中的方括号不能被解释成 glob。
    denyRead: input.internalStorageAccess ? [] : input.internalStorage.protected_roots.map(
      path => ({ path, literal: true }),
    ),
    // 对话工作目录可能位于 AppData 内；只给当前目录开口，不能放行整个会话父目录。
    allowRead: input.internalStorageAccess
      ? []
      : [input.conversationRoot, ...input.internalStorage.readable_roots].map(
          path => ({ path, literal: true }),
        ),
    allowWrite: input.permissionLevel === 'standard'
      ? [input.conversationRoot, ...(input.internalStorageAccess
          ? input.internalStorage.protected_roots
          : [])].map(path => ({ path, literal: true }))
      : [],
    // SRT 默认兼容目录包含用户日志和 /tmp/claude；只读/标准不能在这些位置留文件。
    // /dev 节点由 PTY/pipe 正常运行需要，因此不加入抵消列表。
    denyWrite: persistentDefaultWritePaths,
  };
}
