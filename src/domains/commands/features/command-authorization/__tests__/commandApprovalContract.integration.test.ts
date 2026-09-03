import { describe, expect, it } from 'vitest';
import {
  parseCommandApprovalReply,
  parseCommandApprovalRequest,
  parseCommandApprovalSettlement,
  type CommandApprovalRequestV1,
  type CommandApprovalSettlementV1,
} from '@app/schemas/commands';

import type { CommandApprovalState } from '../../../definitions/commandApproval';
import { acceptCommandApprovalReply } from '../functions/acceptCommandApprovalReply';
import { advanceCommandApprovalSettlement } from '../functions/advanceCommandApprovalSettlement';

const EXECUTION_ID = 'command_execution_018f47a8-7f3c-4cc7-8b8c-aea6ce8f4d2a';
const OTHER_EXECUTION_ID = 'command_execution_018f47a8-7f3c-4cc7-8b8c-aea6ce8f4d2d';
const OWNER_GENERATION_ID = 'command_owner_018f47a8-7f3c-4cc7-8b8c-aea6ce8f4d2b';
const APPROVAL_REQUEST_ID = 'command_approval_018f47a8-7f3c-4cc7-8b8c-aea6ce8f4d2c';
const OTHER_APPROVAL_REQUEST_ID = 'command_approval_018f47a8-7f3c-4cc7-8b8c-aea6ce8f4d2e';
const MATCHING_CONTEXT = {
  platform: 'macos' as const,
  shell_semantics_id: 'zsh',
  matcher_revision: 'simple-command-v1',
};

function createRequest(params: {
  readonly requestId?: string;
  readonly executionId?: string;
  readonly rememberable?: boolean;
  readonly baseLevel?: 'read_only' | 'standard';
  readonly internalDataAccess?: 'allowed' | 'denied';
} = {}): CommandApprovalRequestV1 {
  const identity = {
    conversation_id: 'conversation-a',
    agent_run_id: 'run-a',
    origin_tool_call_id: 'shell-call-a',
    command_execution_id: params.executionId ?? EXECUTION_ID,
    owner_generation_id: OWNER_GENERATION_ID,
    created_at_ms: 1_000,
  };
  const baseLevel = params.baseLevel ?? 'read_only';
  return parseCommandApprovalRequest({
    protocol_version: 1,
    kind: 'command_approval_request',
    approval_request_id: params.requestId ?? APPROVAL_REQUEST_ID,
    proposal: {
      protocol_version: 1,
      kind: 'shell_command_proposal',
      identity,
      command: 'node approved-command.mjs',
      cwd: '/tmp/linnya-approval',
      permission: {
        protocol_version: 1,
        kind: 'command_permission_snapshot',
        identity,
        base_level: baseLevel,
        effective_level: baseLevel,
        grant_source: 'global_setting',
        internal_data_access: params.internalDataAccess ?? 'allowed',
      },
    },
    reasons: baseLevel === 'read_only'
      ? [{
          type: 'permission_elevation',
          from_level: 'read_only',
          to_level: 'standard',
        }]
      : [{
          type: 'fixed_risk_rule',
          rule_id: 'macos.delete.recursive',
          category: 'delete',
        }],
    available_choices: params.rememberable
      ? ['allow_once', 'allow_for_conversation', 'deny']
      : ['allow_once', 'deny'],
    conversation_candidate: params.rememberable
      ? {
          token_prefix: ['node', 'approved-command.mjs'],
          matching_context: MATCHING_CONTEXT,
        }
      : undefined,
    requested_at_ms: 1_100,
  });
}

function createSettlement(params: {
  readonly request?: CommandApprovalRequestV1;
  readonly requestId?: string;
  readonly executionId?: string;
  readonly outcome?: 'approved' | 'rejected' | 'invalidated';
} = {}): CommandApprovalSettlementV1 {
  const request = params.request ?? createRequest();
  const proposalIdentity = {
    ...request.proposal.identity,
    command_execution_id: params.executionId ?? request.proposal.identity.command_execution_id,
  };
  const outcome = params.outcome ?? 'approved';
  const base = {
    protocol_version: 1,
    kind: 'command_approval_settlement',
    approval_request_id: params.requestId ?? request.approval_request_id,
    proposal_identity: proposalIdentity,
    settled_at_ms: 1_200,
  };

  if (outcome === 'rejected') {
    return parseCommandApprovalSettlement({
      ...base,
      outcome,
      reason: 'user_rejected',
    });
  }
  if (outcome === 'invalidated') {
    return parseCommandApprovalSettlement({
      ...base,
      outcome,
      reason: 'owner_ended',
    });
  }
  return parseCommandApprovalSettlement({
    ...base,
    outcome,
    choice: 'allow_once',
    permission: {
      ...request.proposal.permission,
      identity: proposalIdentity,
      effective_level: 'standard',
      grant_source: 'allow_once',
    },
  });
}

describe('command approval reply contract', () => {
  it('resolves an allow-once reply without changing global or internal-data settings', () => {
    const request = createRequest({ internalDataAccess: 'denied' });
    const result = acceptCommandApprovalReply({
      request,
      reply: parseCommandApprovalReply({
        protocol_version: 1,
        kind: 'command_approval_reply',
        approval_request_id: request.approval_request_id,
        choice: 'allow_once',
      }),
    });

    expect(result).toEqual({
      status: 'accepted',
      decision: {
        type: 'approve_once',
        permission: {
          ...request.proposal.permission,
          effective_level: 'standard',
          grant_source: 'allow_once',
        },
      },
    });
  });

  it('marks conversation approval as requiring persistence before settlement', () => {
    const request = createRequest({ rememberable: true, baseLevel: 'standard' });
    const result = acceptCommandApprovalReply({
      request,
      reply: parseCommandApprovalReply({
        protocol_version: 1,
        kind: 'command_approval_reply',
        approval_request_id: request.approval_request_id,
        choice: 'allow_for_conversation',
      }),
    });

    expect(result.status).toBe('accepted');
    if (result.status !== 'accepted') return;
    expect(result.decision).toMatchObject({
      type: 'approve_for_conversation',
      requires_persistence: true,
      approvedCwd: request.proposal.cwd,
      candidate: {
        token_prefix: ['node', 'approved-command.mjs'],
        matching_context: MATCHING_CONTEXT,
      },
      permission: {
        base_level: 'standard',
        effective_level: 'standard',
        grant_source: 'conversation_approval',
      },
    });
  });

  it('rejects wrong request identity and unavailable conversation memory', () => {
    const request = createRequest();
    const wrongRequestResult = acceptCommandApprovalReply({
      request,
      reply: parseCommandApprovalReply({
        protocol_version: 1,
        kind: 'command_approval_reply',
        approval_request_id: OTHER_APPROVAL_REQUEST_ID,
        choice: 'allow_once',
      }),
    });
    const unavailableChoiceResult = acceptCommandApprovalReply({
      request,
      reply: parseCommandApprovalReply({
        protocol_version: 1,
        kind: 'command_approval_reply',
        approval_request_id: request.approval_request_id,
        choice: 'allow_for_conversation',
      }),
    });

    expect(wrongRequestResult).toEqual({
      status: 'rejected',
      code: 'request_mismatch',
    });
    expect(unavailableChoiceResult).toEqual({
      status: 'rejected',
      code: 'choice_not_available',
    });
  });

  it('returns an explicit non-execution decision for user rejection', () => {
    const request = createRequest();
    expect(acceptCommandApprovalReply({
      request,
      reply: parseCommandApprovalReply({
        protocol_version: 1,
        kind: 'command_approval_reply',
        approval_request_id: request.approval_request_id,
        choice: 'deny',
      }),
    })).toEqual({ status: 'accepted', decision: { type: 'reject' } });
  });
});

describe('command approval terminal arbitration', () => {
  it('lets the first legal terminal win and treats later replies as stale', () => {
    const request = createRequest();
    const pending: CommandApprovalState = { status: 'pending', request };
    const rejected = advanceCommandApprovalSettlement({
      state: pending,
      settlement: createSettlement({ request, outcome: 'rejected' }),
    });
    expect(rejected.status).toBe('accepted');
    if (rejected.status !== 'accepted') return;

    const lateApproval = advanceCommandApprovalSettlement({
      state: rejected.state,
      settlement: createSettlement({ request, outcome: 'approved' }),
    });
    expect(lateApproval).toMatchObject({
      status: 'stale',
      code: 'already_settled',
      state: { settlement: { outcome: 'rejected' } },
    });
  });

  it('does not settle another request or another command execution', () => {
    const request = createRequest();
    const pending: CommandApprovalState = { status: 'pending', request };

    expect(advanceCommandApprovalSettlement({
      state: pending,
      settlement: createSettlement({ request, requestId: OTHER_APPROVAL_REQUEST_ID }),
    })).toMatchObject({ status: 'stale', code: 'request_mismatch' });
    expect(advanceCommandApprovalSettlement({
      state: pending,
      settlement: createSettlement({ request, executionId: OTHER_EXECUTION_ID }),
    })).toMatchObject({ status: 'stale', code: 'proposal_mismatch' });
  });

  it('does not settle a choice the host did not offer', () => {
    const request = createRequest();
    const pending: CommandApprovalState = { status: 'pending', request };
    const settlement = parseCommandApprovalSettlement({
      protocol_version: 1,
      kind: 'command_approval_settlement',
      approval_request_id: request.approval_request_id,
      proposal_identity: request.proposal.identity,
      settled_at_ms: 1_200,
      outcome: 'approved',
      choice: 'allow_for_conversation',
      permission: {
        ...request.proposal.permission,
        effective_level: 'standard',
        grant_source: 'conversation_approval',
      },
    });

    expect(advanceCommandApprovalSettlement({ state: pending, settlement }))
      .toMatchObject({ status: 'stale', code: 'settlement_not_applicable' });
  });

  it('does not let a settlement replace the proposal permission snapshot', () => {
    const request = createRequest({ internalDataAccess: 'denied' });
    const pending: CommandApprovalState = { status: 'pending', request };
    const valid = createSettlement({ request });
    if (valid.outcome !== 'approved') throw new Error('expected approved settlement fixture');
    const settlement = parseCommandApprovalSettlement({
      ...valid,
      permission: {
        ...valid.permission,
        internal_data_access: 'allowed',
      },
    });

    expect(advanceCommandApprovalSettlement({ state: pending, settlement }))
      .toMatchObject({ status: 'stale', code: 'permission_snapshot_mismatch' });
  });

  it('keeps concurrent requests isolated when replies arrive in reverse order', () => {
    const firstRequest = createRequest();
    const secondRequest = createRequest({
      requestId: OTHER_APPROVAL_REQUEST_ID,
      executionId: OTHER_EXECUTION_ID,
    });
    const firstPending: CommandApprovalState = { status: 'pending', request: firstRequest };
    const secondPending: CommandApprovalState = { status: 'pending', request: secondRequest };

    const secondResult = advanceCommandApprovalSettlement({
      state: secondPending,
      settlement: createSettlement({ request: secondRequest }),
    });
    const firstResult = advanceCommandApprovalSettlement({
      state: firstPending,
      settlement: createSettlement({ request: firstRequest, outcome: 'rejected' }),
    });

    expect(secondResult).toMatchObject({
      status: 'accepted',
      state: { settlement: { outcome: 'approved' } },
    });
    expect(firstResult).toMatchObject({
      status: 'accepted',
      state: { settlement: { outcome: 'rejected' } },
    });
  });
});
