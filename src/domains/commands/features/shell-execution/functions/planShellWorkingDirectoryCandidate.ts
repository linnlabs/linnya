import path from 'node:path';

import type { CommandPermissionLevel, CommandRuntimePlatform } from '@app/schemas/commands';

import {
  ShellWorkingDirectoryError,
  type ShellWorkingDirectoryCandidate,
} from '../definitions/shellWorkingDirectory';

function isWindowsAmbiguousPath(value: string): boolean {
  return /^[A-Za-z]:(?:$|[^\\/])/u.test(value) || /^[\\/](?![\\/])/u.test(value);
}

function isWindowsNetworkPath(value: string): boolean {
  return value.startsWith('\\\\') || value.startsWith('//');
}

export function isNetworkShellWorkingDirectory(input: {
  readonly absolutePath: string;
  readonly platform: CommandRuntimePlatform;
}): boolean {
  return input.platform === 'windows' && isWindowsNetworkPath(input.absolutePath);
}

/**
 * 相对 cwd 永远以本对话根为基准。Windows 的盘符相对路径和单反斜杠路径依赖宿主
 * 当前盘状态，会让同一请求在不同启动入口落到不同目录，因此即使完全访问也拒绝。
 */
export function planShellWorkingDirectoryCandidate(input: {
  readonly canonicalConversationRoot: string;
  readonly requestedCwd?: string;
  readonly platform: CommandRuntimePlatform;
  readonly permissionLevel: CommandPermissionLevel;
}): ShellWorkingDirectoryCandidate {
  const pathApi = input.platform === 'windows' ? path.win32 : path.posix;
  if (!pathApi.isAbsolute(input.canonicalConversationRoot)) {
    throw new ShellWorkingDirectoryError(
      'cwd_resolution_failed',
      'resolve_conversation_root',
    );
  }
  if (input.requestedCwd === undefined) {
    return Object.freeze({
      absolutePath: input.canonicalConversationRoot,
      source: 'conversation_root',
    });
  }
  if (input.platform === 'windows' && isWindowsAmbiguousPath(input.requestedCwd)) {
    throw new ShellWorkingDirectoryError('cwd_denied', 'plan_requested_cwd');
  }
  if (
    input.permissionLevel !== 'full_access'
    && isNetworkShellWorkingDirectory({
      absolutePath: input.requestedCwd,
      platform: input.platform,
    })
  ) {
    // 受限档在任何 realpath/stat 前拒绝明确可识别的 UNC 和 WSL 网络路径，
    // 避免路径校验本身触发远端认证或挂起。
    throw new ShellWorkingDirectoryError('cwd_denied', 'enforce_permission');
  }

  return Object.freeze({
    absolutePath: pathApi.isAbsolute(input.requestedCwd)
      ? pathApi.normalize(input.requestedCwd)
      : pathApi.resolve(input.canonicalConversationRoot, input.requestedCwd),
    source: 'explicit',
  });
}
