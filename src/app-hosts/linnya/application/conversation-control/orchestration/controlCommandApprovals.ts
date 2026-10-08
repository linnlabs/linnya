import {
  CONVERSATION_CONTROL_SCHEMA_VERSION,
  type ConversationControlCommandApprovalsRequest,
  type ConversationControlCommandApprovalsResponse,
} from '@app/schemas';
import type { CommandApprovalPendingProjectionV1 } from '@app/schemas/commands';
import { ConversationControlError } from '../definitions/conversationControlError';
import type { ConversationControlUseCasePorts, ConversationControlRunRecord } from '../definitions/conversationControlUseCase';
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
  if (request.action === 'list') return { ...common, action: 'list', pending };
  const result = ports.commandApprovals.submitControlReply({
    conversationId: request.conversation_id,
    runId: request.run_id,
    approvalRequestId: request.approval_request_id,
    choice: request.choice,
  });
  if (result.status === 'unavailable') {
    throw new ConversationControlError('capability_unavailable', 'Command approval control is unavailable');
  }
  return { ...common, action: 'reply', approval_request_id: request.approval_request_id, status: result.status };
}
