import type { CommandCardExecutionSettlementV1 } from '@app/schemas/commands';
import type { CommandExecutionPresentationData } from '../definitions/commandExecutionPresentation';

/** sidecar 只覆盖终态和时间，不得改写原 Shell 命令、权限、输出或 PTY 屏幕。 */
export function applyCommandCardSettlement(
  data: CommandExecutionPresentationData,
  settlement: CommandCardExecutionSettlementV1 | undefined
): CommandExecutionPresentationData {
  if (!settlement || data.kind === 'command_execution_lifecycle' || data.source !== 'shell') {
    return data;
  }
  const matchesProcessHandle =
    data.processHandle !== undefined && data.processHandle === settlement.process_handle;
  const matchesToolCall =
    data.toolCallId !== undefined &&
    settlement.origin_tool_call_id !== undefined &&
    data.toolCallId === settlement.origin_tool_call_id;
  if (!matchesProcessHandle && !matchesToolCall) return data;
  return {
    ...data,
    state: 'completed',
    terminal: settlement.terminal,
    executionFacts: {
      protocol_version: 1,
      kind: 'command_execution_presentation_facts',
      timing: {
        status: 'started',
        started_at_ms: settlement.started_at_ms,
        settled_at_ms: settlement.settled_at_ms,
      },
      ...(data.executionFacts?.permission ? { permission: data.executionFacts.permission } : {}),
      audit_status:
        data.executionFacts?.audit_status === 'incomplete' ||
        settlement.audit_status === 'incomplete'
          ? 'incomplete'
          : 'complete',
    },
  };
}
