import type {
  CommandLaunchEnvironmentV1,
  CommandExecutionMode,
  CommandLaunchSnapshotV1,
  CommandPermissionSnapshotV1,
  CommandResolvedShellV1,
  ProcessPtySizeV1,
  ShellCommandProposalV1,
} from '@app/schemas/commands';

import type { CommandAuthorizationRuntimeContext } from '../../../definitions/commandAuthorization';

/** command-authorization 向执行侧交付的最小事实，不把审批过程带进 runner。 */
export interface AuthorizedShellExecution {
  readonly context: CommandAuthorizationRuntimeContext;
  readonly proposal: ShellCommandProposalV1;
  readonly permission: CommandPermissionSnapshotV1;
}

export interface ShellLaunchRuntimeContext {
  readonly shell: CommandResolvedShellV1;
  readonly environment: CommandLaunchEnvironmentV1;
  readonly hardTimeoutMs: number;
}

/** host 同时交付固定默认值和上限；单条命令选择后再收窄为 launch context。 */
export interface ShellLaunchRuntimePolicyContext {
  readonly shell: CommandResolvedShellV1;
  readonly environment: CommandLaunchEnvironmentV1;
  readonly defaultHardTimeoutMs: number;
  readonly maximumHardTimeoutMs: number;
}

export interface ShellLaunchModeContext {
  readonly mode: CommandExecutionMode;
  readonly terminalSize?: ProcessPtySizeV1;
}

export type ShellLaunchRejectionCode =
  | 'authorization_identity_mismatch'
  | 'authorization_scope_mismatch'
  | 'authorization_runtime_mismatch'
  | 'runtime_snapshot_mismatch'
  | 'invalid_launch_context';

export type ShellLaunchResolution =
  | {
      readonly status: 'resolved';
      readonly launch: CommandLaunchSnapshotV1;
    }
  | {
      readonly status: 'rejected';
      readonly code: ShellLaunchRejectionCode;
    };
