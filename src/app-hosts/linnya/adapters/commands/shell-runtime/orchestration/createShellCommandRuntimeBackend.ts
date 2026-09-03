import type {
  PipeCommandLaunchSnapshotV1,
  PtyCommandLaunchSnapshotV1,
} from '@app/schemas/commands';
import { CommandOutputArtifactOwnerSchema } from '../../../../../../domains/commands';
import { createDisposablePipeCommandPreparedRuntime } from '../../runner-runtime';
import { createDisposablePtyCommandPreparedRuntime } from '../../runner-runtime';
import { preparePtyCommandOutput } from '../../output';
import type {
  ShellCommandRuntimeBackend,
  ShellCommandToolOutputScope,
} from '../definitions/shellCommandRuntimeBackend';
import type {
  ShellCommandRuntimeBackendFactoryDependencies,
} from '../definitions/shellCommandRuntimeBackendFactory';

/**
 * App owner 内唯一的 pipe/PTY backend。它只拼装已有 primitive，不读取权限、不审批，
 * 也不创建第二张 execution 表；所有命令仍由上层先 reserve，再交给同一个 owner。
 */
export function createShellCommandRuntimeBackend(
  dependencies: ShellCommandRuntimeBackendFactoryDependencies,
): ShellCommandRuntimeBackend {
  function artifactOwner(launch: Parameters<ShellCommandRuntimeBackend['preparePipe']>[0]) {
    return CommandOutputArtifactOwnerSchema.parse({
      identity: launch.proposal.identity,
      instance_id: launch.proposal.identity.agent_run_id,
    });
  }

  return Object.freeze({
    owner: dependencies.owner,
    initialPtySize: dependencies.initialPtySize,
    readLaunchRuntimeContext: () => dependencies.launchRuntimeContext,

    preparePipe(
      launch: PipeCommandLaunchSnapshotV1,
      toolOutputScope: ShellCommandToolOutputScope
    ) {
      const scope = dependencies.executionScopes.prepareExecution(launch);
      const runtime = createDisposablePipeCommandPreparedRuntime({
        launch,
        artifactOwner: artifactOwner(launch),
        artifactPort: dependencies.artifactPort,
        runnerProcess: dependencies.runnerProcess,
        internalEnvironment: scope.internalEnvironment,
        text: {
          ...dependencies.pipeText,
          openWriter: channel => dependencies.openTextWriter({
            launch,
            source: `shell_${channel}`,
            toolOutputInstanceId: toolOutputScope.instanceId,
          }),
        },
      });
      return scope.decorate(runtime);
    },

    preparePty(
      launch: PtyCommandLaunchSnapshotV1,
      toolOutputScope: ShellCommandToolOutputScope
    ) {
      const scope = dependencies.executionScopes.prepareExecution(launch);
      const owner = CommandOutputArtifactOwnerSchema.parse({
        identity: launch.proposal.identity,
        instance_id: launch.proposal.identity.agent_run_id,
      });
      const output = preparePtyCommandOutput({
        owner,
        artifactPort: dependencies.artifactPort,
        projection: {
          columns: launch.terminal_size.columns,
          rows: launch.terminal_size.rows,
          scrollbackLines: dependencies.ptyText.scrollbackLines,
          agentTextProjectionLimits: dependencies.ptyText.agentTextProjectionLimits,
        },
        observationLimits: dependencies.ptyText.observationLimits,
        openWriter: () => dependencies.openTextWriter({
          launch,
          source: 'shell_terminal',
          toolOutputInstanceId: toolOutputScope.instanceId,
        }),
      });
      const runtime = createDisposablePtyCommandPreparedRuntime({
        launch,
        runnerProcess: dependencies.runnerProcess,
        internalEnvironment: scope.internalEnvironment,
        output,
      });
      return scope.decorate(runtime);
    },
  });
}
