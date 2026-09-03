import {
  getDefaultWritePaths,
  type SandboxRuntimeConfig,
} from '@anthropic-ai/sandbox-runtime';
import type { CommandPermissionLevel } from '@app/schemas/commands';

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
}): SandboxRuntimeConfig['filesystem'] {
  return {
    denyRead: [],
    allowRead: [],
    allowWrite: input.permissionLevel === 'standard' ? [input.conversationRoot] : [],
    // SRT 默认兼容目录包含用户日志和 /tmp/claude；只读/标准不能在这些位置留文件。
    // /dev 节点由 PTY/pipe 正常运行需要，因此不加入抵消列表。
    denyWrite: persistentDefaultWritePaths,
  };
}
