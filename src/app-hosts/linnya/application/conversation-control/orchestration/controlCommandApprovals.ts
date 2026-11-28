import {
  CONVERSATION_CONTROL_SCHEMA_VERSION,
  type ConversationControlCommandApprovalsRequest,
  type ConversationControlCommandApprovalsResponse,
} from '@app/schemas';
import type { CommandApprovalPendingProjectionV1 } from '@app/schemas/commands';
import { ConversationControlError } from '../definitions/conversationControlError';
import type { ConversationControlUseCasePorts, ConversationControlRunRecord } from '../definitions/conversationControlUseCase';
import {
  describeExternalCommandApproval,
  refuseExternalApprovalReply,
} from '../functions/externalCommandApproval';
import { selectCommandApprovalRunScope } from '../functions/selectCommandApprovalRunScope';

export function readCommandApprovals(
  ports: Pick<ConversationControlUseCasePorts, 'commandApprovals'>,
  conversationId: string,
  runId: string,
  runs: readonly ConversationControlRunRecord[],
): CommandApprovalPendingProjectionV1[] {
  const scope = selectCommandApprovalRunScope(conversationId, runId, runs);
  const pending = ports.commandApprovals.readControlPending(conversationId);
  if (!pending) throw new ConversationControlError('capability_unavailable', 'Command approval control is unavailable');
  return pending.filter(value => scope.has(value.agent_run_id));
}

export async function controlCommandApprovals(
  ports: ConversationControlUseCasePorts,
  request: ConversationControlCommandApprovalsRequest,
): Promise<ConversationControlCommandApprovalsResponse> {
  const runs = await ports.runs.findByConversation(request.conversation_id);
  const pending = readCommandApprovals(ports, request.conversation_id, request.run_id, runs);
  const common = {
    schema_version: CONVERSATION_CONTROL_SCHEMA_VERSION,
    ok: true as const,
    command: 'command_approvals' as const,
    conversation_id: request.conversation_id,
    run_id: request.run_id,
  };
  // 每次现读：用户在设置里打开或关上之后，下一次查询和回复立刻按新值走。
  const policy = ports.externalCommandApproval.read();
  if (request.action === 'list') {
    return {
      ...common,
      action: 'list',
      pending,
      external_approval: describeExternalCommandApproval(policy),
    };
  }
  const refusal = refuseExternalApprovalReply(request.choice, policy);
  if (refusal !== undefined) {
    // 请求仍留在待处理里，等用户在桌面端或运行时终端里决定；这里不结算、也不当成拒绝。
    throw new ConversationControlError('approval_requires_user', refusal);
  }
  const result = ports.commandApprovals.submitControlReply({
    conversationId: request.conversation_id,
    runId: request.run_id,
    approvalRequestId: request.approval_request_id,
    choice: request.choice,
    ...(request.deny_reason === undefined ? {} : { denyReason: request.deny_reason }),
  });
  if (result.status === 'unavailable') {
    throw new ConversationControlError('capability_unavailable', 'Command approval control is unavailable');
  }
  return { ...common, action: 'reply', approval_request_id: request.approval_request_id, status: result.status };
}
