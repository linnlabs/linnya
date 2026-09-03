import type {
  CommandApprovalPendingProjectionV1,
  CommandApprovalReason,
} from '@app/schemas/commands';

export interface CommandApprovalView {
  readonly requestId: CommandApprovalPendingProjectionV1['approval_request_id'];
  readonly conversationId: CommandApprovalPendingProjectionV1['conversation_id'];
  readonly command: string;
  readonly cwd: string;
  readonly reasons: readonly CommandApprovalReason[];
  readonly canAllowForConversation: boolean;
  readonly conversationTokenPrefix: readonly string[] | undefined;
  readonly status: CommandApprovalPendingProjectionV1['status'];
}

export function projectCommandApprovalView(
  pending: CommandApprovalPendingProjectionV1,
): CommandApprovalView {
  return Object.freeze({
    requestId: pending.approval_request_id,
    conversationId: pending.conversation_id,
    command: pending.command,
    cwd: pending.cwd,
    reasons: pending.reasons,
    canAllowForConversation: pending.available_choices.includes('allow_for_conversation'),
    conversationTokenPrefix: pending.conversation_token_prefix,
    status: pending.status,
  });
}
