import {
  parseCommandExecutionTerminal,
  type CommandExecutionIdentity,
  type CommandExecutionTerminalV1,
  type CommandOwnerTerminationCause,
} from '@app/schemas/commands';

export function createCommandPrelaunchFailureTerminal(input: {
  readonly identity: CommandExecutionIdentity;
  readonly settledAtMs: number;
  readonly failureCode: 'runtime_unavailable' | 'internal_failure';
}): CommandExecutionTerminalV1 {
  return parseCommandExecutionTerminal({
    protocol_version: 1,
    kind: 'command_execution_terminal',
    identity: input.identity,
    settled_at_ms: input.settledAtMs,
    outcome: 'runtime_failure',
    failure: { code: input.failureCode },
    process_exit: { status: 'not_started' },
    output_drain: { status: 'not_started' },
    tree_cleanup: { status: 'not_required' },
    resource_release: { status: 'not_required' },
  });
}

export function createCommandRuntimeLostTerminal(input: {
  readonly identity: CommandExecutionIdentity;
  readonly settledAtMs: number;
  readonly candidate?: CommandExecutionTerminalV1;
  readonly resourceRelease: 'succeeded' | 'failed';
}): CommandExecutionTerminalV1 {
  const candidateMatchesSource = input.candidate
    && input.candidate.process_exit.status !== 'not_started';
  return parseCommandExecutionTerminal({
    protocol_version: 1,
    kind: 'command_execution_terminal',
    identity: input.identity,
    settled_at_ms: input.settledAtMs,
    outcome: 'runtime_failure',
    failure: { code: 'runtime_lost' },
    process_exit: candidateMatchesSource
      ? input.candidate?.process_exit
      : { status: 'unavailable', reason: 'runtime_lost' },
    output_drain: {
      status: 'failed',
      code: 'output_drain_failed',
      reason: 'runtime_lost',
    },
    tree_cleanup: candidateMatchesSource
      ? input.candidate?.tree_cleanup
      : { status: 'failed', code: 'tree_cleanup_failed' },
    resource_release: candidateMatchesSource
      ? input.candidate?.resource_release
      : input.resourceRelease === 'succeeded'
        ? { status: 'succeeded' }
        : { status: 'failed', code: 'resource_release_failed' },
  });
}

export function createCommandPrelaunchTerminationTerminal(input: {
  readonly identity: CommandExecutionIdentity;
  readonly settledAtMs: number;
  readonly cause: CommandOwnerTerminationCause;
}): CommandExecutionTerminalV1 {
  return parseCommandExecutionTerminal({
    protocol_version: 1,
    kind: 'command_execution_terminal',
    identity: input.identity,
    settled_at_ms: input.settledAtMs,
    outcome: 'execution_ended',
    termination_cause: input.cause,
    process_exit: { status: 'not_started' },
    output_drain: { status: 'not_started' },
    tree_cleanup: { status: 'not_required' },
    resource_release: { status: 'not_required' },
  });
}

/** 兼容已完成的 pipe 调用点；终态本身不包含输出模式，PTY 复用上面的通用命名。 */
export const createPipeCommandPrelaunchFailureTerminal = createCommandPrelaunchFailureTerminal;
export const createPipeCommandRuntimeLostTerminal = createCommandRuntimeLostTerminal;
export const createPipeCommandPrelaunchTerminationTerminal =
  createCommandPrelaunchTerminationTerminal;
