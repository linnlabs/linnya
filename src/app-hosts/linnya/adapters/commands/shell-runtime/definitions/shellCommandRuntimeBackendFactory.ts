import type {
  CommandLaunchSnapshotV1,
  CommandRunnerInternalEnvironmentV1,
  CommandPipeOutputChannel,
  ProcessPtySizeV1,
} from '@app/schemas/commands';
import type {
  CommandOutputArtifactPort,
  CommandRunnerProcessPort,
  PreparedCommandExecutionRuntime,
  ShellLaunchRuntimePolicyContext,
} from '../../../../../../domains/commands';
import type {
  CommandOutputLogicalLineLimits,
  CommandTextProjectionLimits,
} from '../../../../../../infra/adapters/command-runtime/output';
import type {
  PtyCommandOutputObservationLimits,
} from '../../../../../../infra/adapters/command-runtime/pty';
import type { ToolOutputTextBlobWriter } from '../../../../../../tools/tool_output';
import type { LocalCommandOwnerPort } from '../../process-owner';

export type CommandTextOutputSource =
  | `shell_${CommandPipeOutputChannel}`
  | 'shell_terminal';

/**
 * App-level 子活动对 Shell prepared runtime 的唯一接点。具体实现可以持有 transport
 * credential，但 Commands domain、Shell tool 和 platform launcher 都只看到通用内部环境与装饰器。
 */
export interface ShellCommandExecutionScope {
  readonly internalEnvironment: CommandRunnerInternalEnvironmentV1;
  decorate(runtime: PreparedCommandExecutionRuntime): PreparedCommandExecutionRuntime;
}

export interface ShellCommandExecutionScopeFactory {
  prepareExecution(launch: CommandLaunchSnapshotV1): ShellCommandExecutionScope;
}

export interface ShellCommandRuntimeBackendFactoryDependencies {
  readonly runnerProcess: CommandRunnerProcessPort;
  readonly artifactPort: CommandOutputArtifactPort;
  readonly owner: LocalCommandOwnerPort;
  readonly executionScopes: ShellCommandExecutionScopeFactory;
  readonly launchRuntimeContext: ShellLaunchRuntimePolicyContext;
  readonly initialPtySize: ProcessPtySizeV1;
  readonly pipeText: {
    readonly currentLogicalLineLimits: CommandOutputLogicalLineLimits;
    readonly agentTextProjectionLimits: CommandTextProjectionLimits;
  };
  readonly ptyText: {
    readonly scrollbackLines: number;
    readonly agentTextProjectionLimits: CommandTextProjectionLimits;
    readonly observationLimits: PtyCommandOutputObservationLimits;
  };
  openTextWriter(input: {
    readonly launch: CommandLaunchSnapshotV1;
    readonly source: CommandTextOutputSource;
    readonly toolOutputInstanceId: string;
  }): Promise<ToolOutputTextBlobWriter>;
}
