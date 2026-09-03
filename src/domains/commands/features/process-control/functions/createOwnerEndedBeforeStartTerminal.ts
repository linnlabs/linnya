import {
  COMMAND_RUNTIME_PROTOCOL_VERSION,
  type CommandExecutionIdentity,
  type CommandExecutionTerminalV1,
} from '@app/schemas/commands';

/** reserved 命令被 owner/对话结束时没有 child，因此不得伪造 exit、drain 或资源释放。 */
export function createOwnerEndedBeforeStartTerminal(input: {
  readonly identity: CommandExecutionIdentity;
  readonly settledAtMs: number;
}): CommandExecutionTerminalV1 {
  const terminal: CommandExecutionTerminalV1 = {
    protocol_version: COMMAND_RUNTIME_PROTOCOL_VERSION,
    kind: 'command_execution_terminal',
    identity: input.identity,
    settled_at_ms: input.settledAtMs,
    outcome: 'execution_ended',
    termination_cause: 'owner_ended',
    process_exit: { status: 'not_started' },
    output_drain: { status: 'not_started' },
    tree_cleanup: { status: 'not_required' },
    resource_release: { status: 'not_required' },
  };
  return Object.freeze(terminal);
}
