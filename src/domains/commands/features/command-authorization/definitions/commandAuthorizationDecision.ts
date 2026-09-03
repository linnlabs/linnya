import type {
  CommandApprovalRequestId,
  CommandApprovalReason,
  CommandExecutionIdentity,
  CommandConversationApprovalCandidate,
  CommandPermissionSnapshotV1,
  ShellCommandProposalV1,
} from '@app/schemas/commands';

import type { CommandAuthorizationRuntimeContext } from '../../../definitions/commandAuthorization';

export interface CommandAuthorizationPermissionRequirement {
  readonly identity: CommandExecutionIdentity;
  readonly level: 'selected_level' | 'standard';
}

export type CommandAuthorizationEvidence =
  | {
      readonly source: 'global_setting';
    }
  | {
      readonly source: 'conversation_approval';
      readonly approvalRequestId: CommandApprovalRequestId;
    };

export type CommandAuthorizationDecision =
  | {
      readonly status: 'authorized';
      readonly context: CommandAuthorizationRuntimeContext;
      readonly proposal: ShellCommandProposalV1;
      readonly permission: CommandPermissionSnapshotV1;
      readonly evidence: CommandAuthorizationEvidence;
    }
  | {
      readonly status: 'approval_required';
      readonly context: CommandAuthorizationRuntimeContext;
      readonly proposal: ShellCommandProposalV1;
      readonly reasons: readonly CommandApprovalReason[];
      readonly conversationCandidate?: CommandConversationApprovalCandidate;
    }
  | {
      readonly status: 'unavailable';
      readonly context: CommandAuthorizationRuntimeContext;
      readonly proposal: ShellCommandProposalV1;
      readonly code:
        | 'authorization_context_unsupported'
        | 'permission_requirement_identity_mismatch'
        | 'risk_catalog_invalid'
        | 'risk_matcher_failed'
        | 'conversation_approval_invalid'
        | 'permission_resolution_failed';
    };
