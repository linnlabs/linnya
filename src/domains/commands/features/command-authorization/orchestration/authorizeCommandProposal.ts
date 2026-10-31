import {
  CommandApprovalRequestIdSchema,
  CommandApprovalRequestV1Schema,
  type ShellCommandProposalV1,
} from '@app/schemas/commands';

import type {
  CommandApprovalPort,
  ConversationCommandApprovalPort,
} from '../../../ports';
import type { CommandAuthorizationPermissionRequirement } from '../definitions/commandAuthorizationDecision';
import type { CommandProposalAuthorization } from '../definitions/commandProposalAuthorization';
import { evaluateCommandAuthorization } from '../functions/evaluateCommandAuthorization';
import { requestAndSettleCommandApproval } from './requestAndSettleCommandApproval';

function permissionUnavailable(): CommandProposalAuthorization {
  return { status: 'rejected', code: 'permission_unavailable' };
}

/**
 * 这里固定“读取记忆 -> 纯授权 -> 一次审批 -> 必要时先持久化 -> 形成批准终态”的顺序。
 * spawn 不属于本 feature；host 只有拿到 authorized 后才能离开 admission gate 去 claim。
 */
export async function authorizeCommandProposal(input: {
  readonly proposal: ShellCommandProposalV1;
  readonly permissionRequirement: CommandAuthorizationPermissionRequirement;
  readonly platform: 'macos' | 'windows';
  readonly shellSemanticsId: string;
  readonly approvals: ConversationCommandApprovalPort;
  readonly approval: CommandApprovalPort;
  readonly createApprovalRequestUuid: () => string;
  readonly now: () => number;
  readonly abortSignal?: AbortSignal;
}): Promise<CommandProposalAuthorization> {
  let remembered;
  try {
    remembered = input.proposal.permission.base_level === 'full_access'
      ? []
      : await input.approvals.listForConversation(input.proposal.identity.conversation_id);
  } catch {
    return permissionUnavailable();
  }
  if (input.abortSignal?.aborted) return permissionUnavailable();

  const decision = evaluateCommandAuthorization({
    proposal: input.proposal,
    permissionRequirement: input.permissionRequirement,
    platform: input.platform,
    shellSemanticsId: input.shellSemanticsId,
    conversationApprovals: remembered,
  });
  if (decision.status === 'unavailable') return permissionUnavailable();
  if (decision.status === 'authorized') {
    if (input.abortSignal?.aborted) return permissionUnavailable();
    return {
      status: 'authorized',
      context: decision.context,
      permission: decision.permission,
      presentationSource: decision.evidence.source === 'global_setting'
        ? 'global_setting'
        : 'conversation_approval_reused',
      ...(decision.evidence.source === 'conversation_approval'
        ? { approvalRequestId: decision.evidence.approvalRequestId }
        : {}),
    };
  }
  if (input.abortSignal?.aborted) return permissionUnavailable();

  const approvalRequestId = CommandApprovalRequestIdSchema.parse(
    `command_approval_${input.createApprovalRequestUuid()}`,
  );
  const request = CommandApprovalRequestV1Schema.parse({
    protocol_version: 1,
    kind: 'command_approval_request',
    approval_request_id: approvalRequestId,
    proposal: decision.proposal,
    reasons: decision.reasons,
    requested_at_ms: input.now(),
    available_choices: decision.conversationCandidate
      ? ['allow_once', 'allow_for_conversation', 'deny']
      : ['allow_once', 'deny'],
    ...(decision.conversationCandidate
      ? { conversation_candidate: decision.conversationCandidate }
      : {}),
  });

  return requestAndSettleCommandApproval({
    request,
    context: decision.context,
    approvals: input.approvals,
    approval: input.approval,
    now: input.now,
    ...(input.abortSignal ? { abortSignal: input.abortSignal } : {}),
  });
}
