import {
  CommandApprovalReplyV1Schema,
  CommandApprovalRequestIdSchema,
  CommandApprovalRequestV1Schema,
  CommandApprovalSettlementV1Schema,
  type CommandApprovalSettlementV1,
  type ShellCommandProposalV1,
} from '@app/schemas/commands';

import type {
  CommandApprovalPort,
  ConversationCommandApprovalPort,
} from '../../../ports';
import type { CommandAuthorizationPermissionRequirement } from '../definitions/commandAuthorizationDecision';
import type { CommandProposalAuthorization } from '../definitions/commandProposalAuthorization';
import { acceptCommandApprovalReply } from '../functions/acceptCommandApprovalReply';
import { advanceCommandApprovalSettlement } from '../functions/advanceCommandApprovalSettlement';
import { evaluateCommandAuthorization } from '../functions/evaluateCommandAuthorization';

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
    remembered = await input.approvals.listForConversation(
      input.proposal.identity.conversation_id,
    );
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

  let response;
  try {
    response = await input.approval.request({
      request,
      ...(input.abortSignal ? { abortSignal: input.abortSignal } : {}),
    });
  } catch {
    const failed = CommandApprovalSettlementV1Schema.parse({
      protocol_version: 1,
      kind: 'command_approval_settlement',
      approval_request_id: approvalRequestId,
      proposal_identity: input.proposal.identity,
      settled_at_ms: input.now(),
      outcome: 'failed',
      failure: 'authorization_unavailable',
    });
    try {
      await input.approval.settle(failed);
    } catch {
      return permissionUnavailable();
    }
    return {
      ...permissionUnavailable(),
      approval: { settlement: failed },
    };
  }

  let settlement: CommandApprovalSettlementV1;
  let result: CommandProposalAuthorization;
  if (response.status === 'invalidated') {
    settlement = CommandApprovalSettlementV1Schema.parse({
      protocol_version: 1,
      kind: 'command_approval_settlement',
      approval_request_id: approvalRequestId,
      proposal_identity: input.proposal.identity,
      settled_at_ms: input.now(),
      outcome: 'invalidated',
      reason: response.reason,
    });
    result = permissionUnavailable();
  } else if (response.status === 'failed') {
    settlement = CommandApprovalSettlementV1Schema.parse({
      protocol_version: 1,
      kind: 'command_approval_settlement',
      approval_request_id: approvalRequestId,
      proposal_identity: input.proposal.identity,
      settled_at_ms: input.now(),
      outcome: 'failed',
      failure: 'authorization_unavailable',
    });
    result = permissionUnavailable();
  } else {
    const parsedReply = CommandApprovalReplyV1Schema.safeParse(response.reply);
    if (!parsedReply.success) {
      settlement = CommandApprovalSettlementV1Schema.parse({
        protocol_version: 1,
        kind: 'command_approval_settlement',
        approval_request_id: approvalRequestId,
        proposal_identity: input.proposal.identity,
        settled_at_ms: input.now(),
        outcome: 'failed',
        failure: 'authorization_unavailable',
      });
      result = permissionUnavailable();
    } else {
      const acceptance = acceptCommandApprovalReply({ request, reply: parsedReply.data });
      if (acceptance.status === 'rejected') {
        settlement = CommandApprovalSettlementV1Schema.parse({
          protocol_version: 1,
          kind: 'command_approval_settlement',
          approval_request_id: approvalRequestId,
          proposal_identity: input.proposal.identity,
          settled_at_ms: input.now(),
          outcome: 'failed',
          failure: 'authorization_unavailable',
        });
        result = permissionUnavailable();
      } else if (acceptance.decision.type === 'reject') {
        settlement = CommandApprovalSettlementV1Schema.parse({
          protocol_version: 1,
          kind: 'command_approval_settlement',
          approval_request_id: approvalRequestId,
          proposal_identity: input.proposal.identity,
          settled_at_ms: input.now(),
          outcome: 'rejected',
          reason: 'user_rejected',
        });
        result = { status: 'rejected', code: 'approval_denied' };
      } else {
        let persistedApproval: Extract<
          CommandProposalAuthorization,
          { readonly status: 'authorized' }
        >['persistedApproval'];
        if (acceptance.decision.type === 'approve_for_conversation') {
          try {
            const save = await input.approvals.remember({
              approvalRequestId,
              conversationId: input.proposal.identity.conversation_id,
              candidate: acceptance.decision.candidate,
              approvedCwd: acceptance.decision.approvedCwd,
              approvedAtMs: input.now(),
            });
            persistedApproval = {
              approvalRequestId,
              created: save.status === 'created',
            };
          } catch {
            settlement = CommandApprovalSettlementV1Schema.parse({
              protocol_version: 1,
              kind: 'command_approval_settlement',
              approval_request_id: approvalRequestId,
              proposal_identity: input.proposal.identity,
              settled_at_ms: input.now(),
              outcome: 'failed',
              failure: 'conversation_approval_persistence_failed',
            });
            result = permissionUnavailable();
            const advanced = advanceCommandApprovalSettlement({
              state: { status: 'pending', request },
              settlement,
            });
            if (advanced.status !== 'accepted') return permissionUnavailable();
            try {
              await input.approval.settle(settlement);
            } catch {
              return permissionUnavailable();
            }
            return { ...result, approval: { settlement } };
          }
        }

        if (input.abortSignal?.aborted) {
          if (persistedApproval?.created) {
            try {
              await input.approvals.revoke(persistedApproval.approvalRequestId);
            } catch {
              return permissionUnavailable();
            }
          }
          settlement = CommandApprovalSettlementV1Schema.parse({
            protocol_version: 1,
            kind: 'command_approval_settlement',
            approval_request_id: approvalRequestId,
            proposal_identity: input.proposal.identity,
            settled_at_ms: input.now(),
            outcome: 'invalidated',
            reason: 'run_cancelled',
          });
          result = permissionUnavailable();
        } else {
          settlement = CommandApprovalSettlementV1Schema.parse({
            protocol_version: 1,
            kind: 'command_approval_settlement',
            approval_request_id: approvalRequestId,
            proposal_identity: input.proposal.identity,
            settled_at_ms: input.now(),
            outcome: 'approved',
            choice: acceptance.decision.type === 'approve_once'
              ? 'allow_once'
              : 'allow_for_conversation',
            permission: acceptance.decision.permission,
          });
          result = {
            status: 'authorized',
            context: decision.context,
            permission: acceptance.decision.permission,
            presentationSource: acceptance.decision.type === 'approve_once'
              ? 'allow_once'
              : persistedApproval?.created
                ? 'conversation_approval_created'
                : 'conversation_approval_reused',
            approvalRequestId,
            ...(persistedApproval ? { persistedApproval } : {}),
          };
        }
      }
    }
  }

  const advanced = advanceCommandApprovalSettlement({
    state: { status: 'pending', request },
    settlement,
  });
  if (advanced.status !== 'accepted') return permissionUnavailable();
  try {
    await input.approval.settle(settlement);
  } catch {
    if (result.status === 'authorized' && result.persistedApproval?.created) {
      try {
        await input.approvals.revoke(result.persistedApproval.approvalRequestId);
      } catch {
        return permissionUnavailable();
      }
    }
    return permissionUnavailable();
  }
  if (input.abortSignal?.aborted && result.status === 'authorized') {
    if (result.persistedApproval?.created) {
      try {
        await input.approvals.revoke(result.persistedApproval.approvalRequestId);
      } catch {
        return permissionUnavailable();
      }
    }
    return { ...permissionUnavailable(), approval: { settlement } };
  }
  return { ...result, approval: { settlement } };
}
