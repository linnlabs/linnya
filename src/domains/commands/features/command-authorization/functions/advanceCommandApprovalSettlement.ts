import {
  hasSameCommandExecutionIdentity,
  type CommandApprovalSettlementV1,
} from '@app/schemas/commands';

import type {
  CommandApprovalSettlementAdvance,
  CommandApprovalState,
} from '../../../definitions/commandApproval';

/**
 * allow、reject、run cancel 与 owner end 可能同时到达；第一个合法终态获胜。
 * 迟到 renderer 回复只得到 stale，不能复活 request 或执行第二次命令。
 */
export function advanceCommandApprovalSettlement(params: {
  readonly state: CommandApprovalState;
  readonly settlement: CommandApprovalSettlementV1;
}): CommandApprovalSettlementAdvance {
  const { state, settlement } = params;

  if (state.status === 'settled') {
    return { status: 'stale', state, code: 'already_settled' };
  }
  if (state.request.approval_request_id !== settlement.approval_request_id) {
    return { status: 'stale', state, code: 'request_mismatch' };
  }
  if (!hasSameCommandExecutionIdentity(
    state.request.proposal.identity,
    settlement.proposal_identity,
  )) {
    return { status: 'stale', state, code: 'proposal_mismatch' };
  }
  if (
    settlement.outcome === 'approved'
    && !state.request.available_choices.some(choice => choice === settlement.choice)
  ) {
    return { status: 'stale', state, code: 'settlement_not_applicable' };
  }
  if (
    settlement.outcome === 'failed'
    && settlement.failure === 'conversation_approval_persistence_failed'
    && !state.request.available_choices.some(choice => choice === 'allow_for_conversation')
  ) {
    return { status: 'stale', state, code: 'settlement_not_applicable' };
  }
  if (
    settlement.outcome === 'approved'
    && (
      settlement.permission.base_level
        !== state.request.proposal.permission.base_level
      || settlement.permission.internal_data_access
        !== state.request.proposal.permission.internal_data_access
    )
  ) {
    return { status: 'stale', state, code: 'permission_snapshot_mismatch' };
  }

  return {
    status: 'accepted',
    state: {
      status: 'settled',
      request: state.request,
      settlement,
    },
  };
}
