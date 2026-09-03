import { describe, expect, it } from 'vitest';

import {
  CommandApprovalReplyV1Schema,
  CommandApprovalRequestV1Schema,
  CommandApprovalSettlementV1Schema,
  CommandPermissionSnapshotV1Schema,
  ShellCommandProposalV1Schema,
} from './index';

const EXECUTION_ID = 'command_execution_018f47a8-7f3c-4cc7-8b8c-aea6ce8f4d2a';
const OWNER_GENERATION_ID = 'command_owner_018f47a8-7f3c-4cc7-8b8c-aea6ce8f4d2b';
const APPROVAL_REQUEST_ID = 'command_approval_018f47a8-7f3c-4cc7-8b8c-aea6ce8f4d2c';

const identity = {
  conversation_id: 'conversation-a',
  agent_run_id: 'run-a',
  origin_tool_call_id: 'shell-call-a',
  command_execution_id: EXECUTION_ID,
  owner_generation_id: OWNER_GENERATION_ID,
  created_at_ms: 1_000,
};
const matchingContext = {
  platform: 'macos',
  shell_semantics_id: 'zsh',
  matcher_revision: 'simple-command-v1',
};

function createPermission(overrides: Record<string, unknown> = {}) {
  return {
    protocol_version: 1,
    kind: 'command_permission_snapshot',
    identity,
    base_level: 'read_only',
    effective_level: 'read_only',
    grant_source: 'global_setting',
    internal_data_access: 'allowed',
    ...overrides,
  };
}

function createProposal(overrides: Record<string, unknown> = {}) {
  return {
    protocol_version: 1,
    kind: 'shell_command_proposal',
    identity,
    command: 'node -e "process.exit(0)"',
    cwd: '/tmp/linnya conversation',
    permission: createPermission(),
    ...overrides,
  };
}

function createRequest(overrides: Record<string, unknown> = {}) {
  return {
    protocol_version: 1,
    kind: 'command_approval_request',
    approval_request_id: APPROVAL_REQUEST_ID,
    proposal: createProposal(),
    reasons: [{
      type: 'permission_elevation',
      from_level: 'read_only',
      to_level: 'standard',
    }],
    available_choices: ['allow_once', 'deny'],
    requested_at_ms: 1_100,
    ...overrides,
  };
}

describe('command permission and proposal contracts', () => {
  it('keeps internal-data access independent from full access', () => {
    expect(CommandPermissionSnapshotV1Schema.parse(createPermission({
      base_level: 'full_access',
      effective_level: 'full_access',
      internal_data_access: 'denied',
    })).internal_data_access).toBe('denied');
  });

  it('only lets an approval produce standard effective permission', () => {
    expect(CommandPermissionSnapshotV1Schema.safeParse(createPermission({
      effective_level: 'full_access',
      grant_source: 'allow_once',
    })).success).toBe(false);

    expect(CommandPermissionSnapshotV1Schema.parse(createPermission({
      effective_level: 'standard',
      grant_source: 'allow_once',
    })).effective_level).toBe('standard');
  });

  it('binds the permission snapshot to the exact command execution', () => {
    const proposal = createProposal({
      permission: createPermission({
        identity: { ...identity, agent_run_id: 'run-b' },
      }),
    });

    expect(ShellCommandProposalV1Schema.safeParse(proposal).success).toBe(false);
  });

  it('rejects NUL and the confirmed 12,000-character boundary before proposal creation', () => {
    expect(ShellCommandProposalV1Schema.safeParse(createProposal({
      command: 'printf before\0printf after',
    })).success).toBe(false);
    expect(ShellCommandProposalV1Schema.safeParse(createProposal({
      command: 'a'.repeat(12_001),
    })).success).toBe(false);
    expect(ShellCommandProposalV1Schema.safeParse(createProposal({
      command: 'a'.repeat(12_000),
    })).success).toBe(true);
  });

  it('按 Unicode 字符而不是 JavaScript UTF-16 单元计算 emoji', () => {
    expect(ShellCommandProposalV1Schema.safeParse(createProposal({
      command: '😀'.repeat(6_001),
    })).success).toBe(true);
    expect(ShellCommandProposalV1Schema.safeParse(createProposal({
      command: '😀'.repeat(12_001),
    })).success).toBe(false);
  });

  it('rejects blank or NUL-containing cwd before approval', () => {
    expect(ShellCommandProposalV1Schema.safeParse(createProposal({ cwd: '   ' })).success)
      .toBe(false);
    expect(ShellCommandProposalV1Schema.safeParse(createProposal({
      cwd: '/tmp/before\0after',
    })).success).toBe(false);
  });
});

describe('command approval wire contracts', () => {
  it('only offers conversation memory when a visible simple-command prefix exists', () => {
    expect(CommandApprovalRequestV1Schema.safeParse(createRequest({
      available_choices: ['allow_once', 'allow_for_conversation', 'deny'],
      conversation_candidate: { token_prefix: ['git', 'status'] },
    })).success).toBe(false);

    const parsed = CommandApprovalRequestV1Schema.parse(createRequest({
      available_choices: ['allow_once', 'allow_for_conversation', 'deny'],
      conversation_candidate: {
        token_prefix: ['git', 'status'],
        matching_context: matchingContext,
      },
    }));
    expect(parsed.conversation_candidate?.token_prefix).toEqual(['git', 'status']);
    expect(parsed.conversation_candidate?.matching_context).toEqual({
      platform: 'macos',
      shell_semantics_id: 'zsh',
      matcher_revision: 'simple-command-v1',
    });
  });

  it('allows an empty argument token but rejects an empty executable and oversized prefixes', () => {
    expect(CommandApprovalRequestV1Schema.safeParse(createRequest({
      available_choices: ['allow_once', 'allow_for_conversation', 'deny'],
      conversation_candidate: {
        token_prefix: ['printf', ''],
        matching_context: matchingContext,
      },
    })).success).toBe(true);
    expect(CommandApprovalRequestV1Schema.safeParse(createRequest({
      available_choices: ['allow_once', 'allow_for_conversation', 'deny'],
      conversation_candidate: {
        token_prefix: ['', 'status'],
        matching_context: matchingContext,
      },
    })).success).toBe(false);
    expect(CommandApprovalRequestV1Schema.safeParse(createRequest({
      available_choices: ['allow_once', 'allow_for_conversation', 'deny'],
      conversation_candidate: {
        token_prefix: ['git', 'a'.repeat(12_000)],
        matching_context: matchingContext,
      },
    })).success).toBe(false);
  });

  it('rejects elevation that is detached from the proposal permission snapshot', () => {
    const request = createRequest({
      proposal: createProposal({
        permission: createPermission({
          base_level: 'standard',
          effective_level: 'standard',
        }),
      }),
    });

    expect(CommandApprovalRequestV1Schema.safeParse(request).success).toBe(false);
  });

  it('requires a read-only request to disclose its standard-permission elevation', () => {
    expect(CommandApprovalRequestV1Schema.safeParse(createRequest({
      reasons: [{
        type: 'fixed_risk_rule',
        rule_id: 'macos.external-upload.fixture',
        category: 'external_upload',
      }],
    })).success).toBe(false);
  });

  it('does not create approval requests for full-access proposals', () => {
    const request = createRequest({
      proposal: createProposal({
        permission: createPermission({
          base_level: 'full_access',
          effective_level: 'full_access',
        }),
      }),
      reasons: [{
        type: 'fixed_risk_rule',
        rule_id: 'macos.delete.recursive-root',
        category: 'delete',
      }],
    });

    expect(CommandApprovalRequestV1Schema.safeParse(request).success).toBe(false);
  });

  it('does not create another request from a permission snapshot already modified by approval', () => {
    const request = createRequest({
      proposal: createProposal({
        permission: createPermission({
          effective_level: 'standard',
          grant_source: 'allow_once',
        }),
      }),
      reasons: [{
        type: 'fixed_risk_rule',
        rule_id: 'macos.delete.recursive-root',
        category: 'delete',
      }],
    });

    expect(CommandApprovalRequestV1Schema.safeParse(request).success).toBe(false);
  });

  it('rejects renderer attempts to replace the approved command or cwd', () => {
    expect(CommandApprovalReplyV1Schema.safeParse({
      protocol_version: 1,
      kind: 'command_approval_reply',
      approval_request_id: APPROVAL_REQUEST_ID,
      choice: 'allow_once',
      command: 'different command',
      cwd: '/different/cwd',
    }).success).toBe(false);
  });

  it('binds approved permission to the proposal and the selected grant source', () => {
    const approved = {
      protocol_version: 1,
      kind: 'command_approval_settlement',
      approval_request_id: APPROVAL_REQUEST_ID,
      proposal_identity: identity,
      settled_at_ms: 1_200,
      outcome: 'approved',
      choice: 'allow_once',
      permission: createPermission({
        effective_level: 'standard',
        grant_source: 'allow_once',
      }),
    };

    expect(CommandApprovalSettlementV1Schema.safeParse(approved).success).toBe(true);
    expect(CommandApprovalSettlementV1Schema.safeParse({
      ...approved,
      permission: createPermission({
        effective_level: 'standard',
        grant_source: 'conversation_approval',
      }),
    }).success).toBe(false);
    expect(CommandApprovalSettlementV1Schema.safeParse({
      ...approved,
      permission: createPermission({
        identity: { ...identity, command_execution_id: 'command_execution_018f47a8-7f3c-4cc7-8b8c-aea6ce8f4d2d' },
        effective_level: 'standard',
        grant_source: 'allow_once',
      }),
    }).success).toBe(false);
  });

  it('keeps invalidation and backend failure distinct from user rejection', () => {
    const base = {
      protocol_version: 1,
      kind: 'command_approval_settlement',
      approval_request_id: APPROVAL_REQUEST_ID,
      proposal_identity: identity,
      settled_at_ms: 1_200,
    };

    expect(CommandApprovalSettlementV1Schema.parse({
      ...base,
      outcome: 'rejected',
      reason: 'user_rejected',
    }).outcome).toBe('rejected');
    expect(CommandApprovalSettlementV1Schema.parse({
      ...base,
      outcome: 'invalidated',
      reason: 'owner_ended',
    }).outcome).toBe('invalidated');
    expect(CommandApprovalSettlementV1Schema.parse({
      ...base,
      outcome: 'failed',
      failure: 'conversation_approval_persistence_failed',
    }).outcome).toBe('failed');
  });
});
