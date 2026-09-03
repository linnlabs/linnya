import { ToolCallWire, type RoutedRuntimeEvent } from '@linnlabs/linnkit/contracts';

import { CommandExecutionTerminalV1Schema } from '@app/schemas/commands';
import type { ExecutionAuditEventFact } from 'src/app-hosts/linnya/application/execution-audit-export';

function projectToolDecision(
  event: Extract<RoutedRuntimeEvent, { type: 'tool_call_decision' }>,
): readonly ExecutionAuditEventFact[] {
  const rawCalls = event.payload?.tool_calls;
  const calls = rawCalls && rawCalls.length > 0
    ? rawCalls.map(rawCall => ToolCallWire.parse(rawCall))
    : [{ id: event.tool_call_id, function: { name: event.tool_name } }];
  return calls.map(call => ({
    kind: 'tool_decision',
    runId: event.run_id,
    ...(event.parent_run_id ? { parentRunId: event.parent_run_id } : {}),
    emittedAt: event.timestamp,
    toolCallId: call.id,
    toolName: call.function.name,
  }));
}

function projectCommandTerminal(
  event: Extract<RoutedRuntimeEvent, { type: 'audit_envelope' }>,
): ExecutionAuditEventFact | null {
  if (event.envelope.action !== 'command.execution.terminal') return null;
  const evidence = event.envelope.evidence?.find(item => item.kind === 'command_execution_fact');
  const terminal = CommandExecutionTerminalV1Schema.parse(evidence?.metadata?.terminal);
  const processExit = terminal.process_exit.status === 'observed'
    ? {
        status: 'observed' as const,
        exitCode: terminal.process_exit.exit_code,
        signal: terminal.process_exit.signal,
      }
    : terminal.process_exit.status === 'unavailable'
      ? {
          status: 'unavailable' as const,
          reason: terminal.process_exit.reason,
        }
      : { status: 'not_started' as const };
  const common = {
    kind: 'command_terminal' as const,
    runId: event.run_id,
    emittedAt: event.envelope.ts,
    toolCallId: terminal.identity.origin_tool_call_id,
    commandExecutionId: terminal.identity.command_execution_id,
    processExit,
  };
  return terminal.outcome === 'execution_ended'
    ? {
        ...common,
        outcome: terminal.outcome,
        terminationCause: terminal.termination_cause,
      }
    : {
        ...common,
        outcome: terminal.outcome,
        runtimeFailureCode: terminal.failure.code,
      };
}

/**
 * 执行审计只读取稳定身份和终态，不复制参数、输出正文或错误正文。
 * tool_call_decision 是批次事实，因此必须展开 canonical tool_calls，而不能只看主调用。
 */
export function projectExecutionAuditEventFacts(
  event: RoutedRuntimeEvent,
): readonly ExecutionAuditEventFact[] {
  switch (event.type) {
    case 'tool_call_decision':
      return projectToolDecision(event);
    case 'tool_output':
      return [{
        kind: 'tool_terminal',
        runId: event.run_id,
        ...(event.parent_run_id ? { parentRunId: event.parent_run_id } : {}),
        emittedAt: event.timestamp,
        toolCallId: event.tool_call_id,
        toolName: event.tool_name,
        status: event.status,
      }];
    case 'audit_envelope': {
      const fact = projectCommandTerminal(event);
      return fact ? [fact] : [];
    }
    default:
      return [];
  }
}
