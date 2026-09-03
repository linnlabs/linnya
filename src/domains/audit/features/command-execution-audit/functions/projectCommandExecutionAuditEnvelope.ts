import {
  AuditEnvelope,
  ConversationIdSchema,
  RunIdSchema,
  ToolCallIdSchema,
  type AuditEnvelope as AuditEnvelopeValue,
} from '@linnlabs/linnkit/contracts';

import type { CommandExecutionIdentity } from '@app/schemas/commands';

import {
  parseCommandExecutionAuditEvent,
  type CommandExecutionAuditEvent,
} from '../definitions/commandExecutionAuditEvent';

export const COMMAND_EXECUTION_AUDIT_ACTOR = Object.freeze({
  kind: 'host' as const,
  name: 'linnya-command-runtime',
});

export interface ProjectCommandExecutionAuditEnvelopeInput {
  readonly event: CommandExecutionAuditEvent;
}

function identityOf(event: CommandExecutionAuditEvent): CommandExecutionIdentity {
  switch (event.kind) {
    case 'proposal_created':
      return event.proposal.identity;
    case 'authorization_settled':
    case 'execution_rejected':
    case 'execution_started':
    case 'process_action':
    case 'protected_input':
      return event.identity;
    case 'execution_terminal':
      return event.terminal.identity;
  }
}

function actionOf(event: CommandExecutionAuditEvent): string {
  switch (event.kind) {
    case 'proposal_created':
      return 'command.proposal.created';
    case 'authorization_settled':
      return 'command.authorization.settled';
    case 'execution_rejected':
      return 'command.execution.rejected';
    case 'execution_started':
      return 'command.execution.started';
    case 'process_action':
      return 'command.process.action';
    case 'protected_input':
      return 'command.protected_input';
    case 'execution_terminal':
      return 'command.execution.terminal';
  }
}

function evidenceMetadata(event: CommandExecutionAuditEvent): Record<string, unknown> {
  switch (event.kind) {
    case 'proposal_created':
      // proposal 是命令、cwd、权限和执行身份的唯一冻结事实，后续阶段只引用它，不能重建命令。
      return {
        proposal: event.proposal,
        ...(event.binding ? { binding: event.binding } : {}),
      };
    case 'authorization_settled':
      return {
        settlement: event.settlement,
        ...(event.approval_settlement
          ? { approval_settlement: event.approval_settlement }
          : {}),
      };
    case 'execution_rejected':
      return {
        reason: event.reason,
        resource_state: event.resource_state,
      };
    case 'execution_started':
      return {
        mode: event.mode,
        runtime: event.runtime,
        ...(event.process_handle ? { process_handle: event.process_handle } : {}),
      };
    case 'process_action':
      return { action: event.action, result: event.result };
    case 'protected_input':
      return {
        source: 'user',
        process_handle: event.process_handle,
        input_bytes: event.input_bytes,
        result: event.result,
      };
    case 'execution_terminal':
      return { terminal: event.terminal };
  }
}

/**
 * 同一命令阶段重试投影时必须得到同一个身份，后续读取方才能明确识别重复事实。
 * 这里不假装 EventStore 已提供幂等追加；execution ID 是固定 UUID，process action 再追加
 * control tool-call，区分同一进程的多次操作。
 */
export function deriveCommandExecutionAuditEnvelopeId(
  event: CommandExecutionAuditEvent,
): string {
  const identity = identityOf(event);
  if (event.kind === 'process_action') {
    return `audit-command:${identity.command_execution_id}:${event.kind}:${event.control_tool_call_id}`;
  }
  if (event.kind === 'protected_input') {
    return `audit-command:${identity.command_execution_id}:${event.kind}:${event.attempt_id}`;
  }
  return `audit-command:${identity.command_execution_id}:${event.kind}`;
}

function decisionOf(event: CommandExecutionAuditEvent): AuditEnvelopeValue['decision'] {
  if (event.kind !== 'authorization_settled') return undefined;
  return event.settlement.outcome === 'authorized'
    ? {
        outcome: 'allowed',
        policy: event.settlement.permission.grant_source,
      }
    : {
        outcome: 'denied',
        reason: event.settlement.code,
      };
}

/**
 * 投影只负责把领域事实翻译成 Linnkit 标准信封。所有 Runtime 身份都重新经过正式 schema，
 * 避免因为命令协议里的字符串品牌不同而用类型断言伪造审计身份。
 */
export function projectCommandExecutionAuditEnvelope(
  input: ProjectCommandExecutionAuditEnvelopeInput,
): AuditEnvelopeValue {
  const event = parseCommandExecutionAuditEvent(input.event);
  const identity = identityOf(event);
  const toolCallId = event.kind === 'process_action'
    ? event.control_tool_call_id
    : identity.origin_tool_call_id;

  return AuditEnvelope.parse({
    envelopeId: deriveCommandExecutionAuditEnvelopeId(event),
    runId: RunIdSchema.parse(identity.agent_run_id),
    ts: event.occurred_at_ms,
    actor: COMMAND_EXECUTION_AUDIT_ACTOR,
    action: actionOf(event),
    decision: decisionOf(event),
    evidence: [{
      kind: 'command_execution_fact',
      metadata: evidenceMetadata(event),
    }],
    scope: {
      conversationId: ConversationIdSchema.parse(identity.conversation_id),
      runId: RunIdSchema.parse(identity.agent_run_id),
      toolCallId: ToolCallIdSchema.parse(toolCallId),
      toolName: event.kind === 'process_action' ? 'process' : 'shell',
      metadata: {
        command_execution_id: identity.command_execution_id,
        owner_generation_id: identity.owner_generation_id,
      },
    },
  });
}
