import {
  CommandLaunchSnapshotV1Schema,
  hasSameCommandExecutionIdentity,
  type CommandLaunchSnapshotV1,
} from '@app/schemas/commands';

import type {
  AuthorizedShellExecution,
  ShellLaunchModeContext,
  ShellLaunchResolution,
  ShellLaunchRuntimeContext,
} from '../definitions/authorizedShellExecution';

function freezeLaunchSnapshot(
  launch: CommandLaunchSnapshotV1,
): CommandLaunchSnapshotV1 {
  // parse 已经切断调用方引用；由内向外冻结，避免审批完成后环境或 argv 被原地改写。
  Object.freeze(launch.proposal.identity);
  Object.freeze(launch.proposal.permission.identity);
  Object.freeze(launch.proposal.permission);
  Object.freeze(launch.proposal);
  Object.freeze(launch.permission.identity);
  Object.freeze(launch.permission);
  Object.freeze(launch.shell.argv_prefix);
  Object.freeze(launch.shell);
  Object.freeze(launch.environment.entries);
  Object.freeze(launch.environment);
  return Object.freeze(launch);
}

/**
 * 这是授权事实到 runner wire 的唯一 mapper。它不解析命令、不读取 process.env，
 * 也不把 initial wait 混入会改变命令命运的 launch。
 */
export function resolveShellLaunchRequest(params: {
  readonly authorized: AuthorizedShellExecution;
  readonly runtime: ShellLaunchRuntimeContext;
  readonly mode?: ShellLaunchModeContext;
  readonly conversationRoot: string;
}): ShellLaunchResolution {
  const { proposal, permission } = params.authorized;
  const mode = params.mode ?? { mode: 'pipe' as const };
  if (!hasSameCommandExecutionIdentity(proposal.identity, permission.identity)) {
    return Object.freeze({
      status: 'rejected',
      code: 'authorization_identity_mismatch',
    });
  }
  if (
    permission.base_level !== proposal.permission.base_level
    || permission.internal_data_access !== proposal.permission.internal_data_access
  ) {
    return Object.freeze({
      status: 'rejected',
      code: 'authorization_scope_mismatch',
    });
  }
  if (
    params.authorized.context.platform !== params.runtime.shell.platform
    || params.authorized.context.shellSemanticsId
      !== params.runtime.shell.shell_semantics_id
  ) {
    return Object.freeze({
      status: 'rejected',
      code: 'authorization_runtime_mismatch',
    });
  }
  if (params.runtime.shell.snapshot_revision !== params.runtime.environment.revision) {
    return Object.freeze({
      status: 'rejected',
      code: 'runtime_snapshot_mismatch',
    });
  }

  const parsed = CommandLaunchSnapshotV1Schema.safeParse({
    protocol_version: 1,
    kind: mode.mode === 'pipe'
      ? 'pipe_command_launch_snapshot'
      : 'pty_command_launch_snapshot',
    proposal,
    conversation_root: params.conversationRoot,
    permission,
    mode: mode.mode,
    shell: params.runtime.shell,
    environment: params.runtime.environment,
    stdin: mode.mode === 'pipe' ? 'closed' : 'pty',
    ...(mode.mode === 'pty'
      ? { terminal_size: mode.terminalSize }
      : {}),
    lifecycle_policy: 'terminate_with_run',
    hard_timeout_ms: params.runtime.hardTimeoutMs,
  });
  if (!parsed.success) {
    return Object.freeze({ status: 'rejected', code: 'invalid_launch_context' });
  }

  return Object.freeze({
    status: 'resolved',
    launch: freezeLaunchSnapshot(parsed.data),
  });
}
