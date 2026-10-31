import {
  CommandApprovalPendingProjectionV1Schema,
  type CommandApprovalPendingProjectionV1,
  type CommandApprovalRequestV1,
} from '@app/schemas/commands';

export function projectCommandApprovalPending(input: {
  readonly request: CommandApprovalRequestV1;
  readonly status: 'awaiting_reply' | 'processing';
}): CommandApprovalPendingProjectionV1 {
  // 页面只接收安全投影，完整 proposal identity 继续由业务 owner 持有。
  return CommandApprovalPendingProjectionV1Schema.parse({
    protocol_version: 1,
    kind: 'command_approval_pending_projection',
    approval_request_id: input.request.approval_request_id,
    conversation_id: input.request.proposal.identity.conversation_id,
    agent_run_id: input.request.proposal.identity.agent_run_id,
    origin_tool_call_id: input.request.proposal.identity.origin_tool_call_id,
    command_execution_id: input.request.proposal.identity.command_execution_id,
    command: input.request.proposal.kind === 'shell_command_proposal'
      ? input.request.proposal.command
      : `read_file ${JSON.stringify(input.request.proposal.file_path)}`,
    cwd: input.request.proposal.cwd,
    reasons: input.request.reasons,
    available_choices: input.request.available_choices,
    ...(input.request.conversation_candidate
      ? { conversation_token_prefix: input.request.conversation_candidate.token_prefix }
      : {}),
    requested_at_ms: input.request.requested_at_ms,
    status: input.status,
  });
}
