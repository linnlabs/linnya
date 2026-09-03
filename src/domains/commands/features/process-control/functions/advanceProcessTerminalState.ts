import type {
  CommandExecutionIdentity,
  CommandExecutionTerminalV1,
} from '@app/schemas/commands';

export type ProcessTerminalAdvanceResult =
  | {
      readonly status: 'accepted';
      readonly terminal: CommandExecutionTerminalV1;
    }
  | {
      readonly status: 'ignored';
      readonly reason:
        | 'owner_generation_mismatch'
        | 'execution_identity_mismatch'
        | 'already_terminal';
      readonly terminal?: CommandExecutionTerminalV1;
    };

function hasSameExecutionIdentity(
  expected: CommandExecutionIdentity,
  actual: CommandExecutionIdentity,
): boolean {
  return expected.conversation_id === actual.conversation_id
    && expected.agent_run_id === actual.agent_run_id
    && expected.origin_tool_call_id === actual.origin_tool_call_id
    && expected.command_execution_id === actual.command_execution_id
    && expected.created_at_ms === actual.created_at_ms;
}

/**
 * 第一个通过完整身份校验的终态获胜。先校验 generation 和 execution identity，
 * 是为了让旧 runner 的迟到回调留下准确诊断，而不是被误记成当前命令的普通迟到事件。
 */
export function advanceProcessTerminalState(params: {
  readonly expectedIdentity: CommandExecutionIdentity;
  readonly currentTerminal: CommandExecutionTerminalV1 | undefined;
  readonly candidate: CommandExecutionTerminalV1;
}): ProcessTerminalAdvanceResult {
  const { expectedIdentity, currentTerminal, candidate } = params;

  if (candidate.identity.owner_generation_id !== expectedIdentity.owner_generation_id) {
    return { status: 'ignored', reason: 'owner_generation_mismatch' };
  }
  if (!hasSameExecutionIdentity(expectedIdentity, candidate.identity)) {
    return { status: 'ignored', reason: 'execution_identity_mismatch' };
  }
  if (currentTerminal) {
    return {
      status: 'ignored',
      reason: 'already_terminal',
      terminal: currentTerminal,
    };
  }

  return { status: 'accepted', terminal: candidate };
}
