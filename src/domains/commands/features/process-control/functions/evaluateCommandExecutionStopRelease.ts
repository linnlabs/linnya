import type { CommandExecutionTerminalV1 } from '@app/schemas/commands';

export type CommandExecutionStopReleaseDecision =
  | { readonly status: 'releasable' }
  | {
      readonly status: 'blocked';
      readonly reason: 'tree_cleanup_failed' | 'resource_release_failed';
    };

/**
 * 删除对话前不仅要等到 terminal，还要确认业务进程留下的整棵树和运行资源都已收口。
 * 输出不完整是独立事实，不阻止目录删除；未启动的命令则没有平台资源需要证明。
 */
export function evaluateCommandExecutionStopRelease(
  terminal: CommandExecutionTerminalV1,
): CommandExecutionStopReleaseDecision {
  if (terminal.process_exit.status === 'not_started') {
    return { status: 'releasable' };
  }
  // 先保留平台明确报告的失败原因；自然终态可能同时是 tree not_required 与资源释放失败。
  if (terminal.tree_cleanup.status === 'failed') {
    return { status: 'blocked', reason: 'tree_cleanup_failed' };
  }
  if (terminal.resource_release.status === 'failed') {
    return { status: 'blocked', reason: 'resource_release_failed' };
  }
  if (terminal.tree_cleanup.status !== 'succeeded') {
    return { status: 'blocked', reason: 'tree_cleanup_failed' };
  }
  if (terminal.resource_release.status !== 'succeeded') {
    return { status: 'blocked', reason: 'resource_release_failed' };
  }
  return { status: 'releasable' };
}

export function hasExplicitCommandExecutionReleaseFailure(
  terminal: CommandExecutionTerminalV1,
): boolean {
  return terminal.tree_cleanup.status === 'failed'
    || terminal.resource_release.status === 'failed';
}
