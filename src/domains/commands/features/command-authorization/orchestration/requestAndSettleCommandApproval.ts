import {
  CommandApprovalReplyV1Schema,
  CommandApprovalSettlementV1Schema,
  type CommandApprovalRequestV1,
  type CommandApprovalSettlementV1,
} from '@app/schemas/commands';
import type { CommandAuthorizationRuntimeContext } from '../../../definitions/commandAuthorization';
import type { CommandApprovalPort, ConversationCommandApprovalPort } from '../../../ports';
import type { CommandProposalAuthorization } from '../definitions/commandProposalAuthorization';
import { acceptCommandApprovalReply } from '../functions/acceptCommandApprovalReply';
import { advanceCommandApprovalSettlement } from '../functions/advanceCommandApprovalSettlement';

function permissionUnavailable(): CommandProposalAuthorization {
  return { status: 'rejected', code: 'permission_unavailable' };
}

/** Shell 与文件访问共享回复、持久化和取消流程；各自的授权规则在调用前完成。 */
export async function requestAndSettleCommandApproval(input: {
  readonly request: CommandApprovalRequestV1;
  readonly context: CommandAuthorizationRuntimeContext;
  readonly approvals: ConversationCommandApprovalPort;
  readonly approval: CommandApprovalPort;
  readonly now: () => number;
  readonly abortSignal?: AbortSignal;
}): Promise<CommandProposalAuthorization> {
  const request = input.request;
  const approvalRequestId = request.approval_request_id;
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
      proposal_identity: request.proposal.identity,
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
      proposal_identity: request.proposal.identity,
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
      proposal_identity: request.proposal.identity,
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
        proposal_identity: request.proposal.identity,
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
          proposal_identity: request.proposal.identity,
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
          proposal_identity: request.proposal.identity,
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
              conversationId: request.proposal.identity.conversation_id,
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
              proposal_identity: request.proposal.identity,
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
            proposal_identity: request.proposal.identity,
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
            proposal_identity: request.proposal.identity,
            settled_at_ms: input.now(),
            outcome: 'approved',
            choice: acceptance.decision.type === 'approve_once'
              ? 'allow_once'
              : 'allow_for_conversation',
            permission: acceptance.decision.permission,
          });
          result = {
            status: 'authorized',
            context: input.context,
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
