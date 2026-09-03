import { z } from 'zod';

import {
  CommandConversationApprovalCandidateSchema,
  CommandApprovalRequestIdSchema,
  CommandConversationIdSchema,
  type CommandApprovalReplyV1,
  type CommandApprovalRequestV1,
  type CommandApprovalSettlementV1,
  type CommandConversationApprovalCandidate,
  type CommandPermissionSnapshotV1,
} from '@app/schemas/commands';

export const ConversationCommandApprovalSchema = z.object({
  approvalRequestId: CommandApprovalRequestIdSchema,
  conversationId: CommandConversationIdSchema,
  candidate: CommandConversationApprovalCandidateSchema,
  approvedCwd: z.string().min(1).refine(
    value => value.trim().length > 0 && !value.includes('\0'),
    'approved cwd must not be blank or contain NUL',
  ),
  approvedAtMs: z.number().int().nonnegative().safe(),
}).strict();
export type ConversationCommandApproval = z.infer<
  typeof ConversationCommandApprovalSchema
>;

export type ConversationCommandApprovalSaveResult =
  | {
      readonly status: 'created';
      readonly approval: ConversationCommandApproval;
    }
  | {
      readonly status: 'existing';
      readonly approval: ConversationCommandApproval;
    };

export type ConversationCommandApprovalFailureCode =
  | 'conversation_approval_invalid'
  | 'conversation_approval_identity_conflict'
  | 'conversation_approval_corrupt'
  | 'conversation_approval_persistence_failed';

export type ConversationCommandApprovalFailureStage =
  | 'remember'
  | 'list'
  | 'revoke'
  | 'delete';

export class ConversationCommandApprovalError extends Error {
  constructor(
    readonly code: ConversationCommandApprovalFailureCode,
    readonly stage: ConversationCommandApprovalFailureStage,
    readonly storageCode?: string,
  ) {
    super(`${code} at ${stage}`);
    this.name = 'ConversationCommandApprovalError';
  }
}

export type CommandApprovalReplyDecision =
  | {
      readonly type: 'reject';
    }
  | {
      readonly type: 'approve_once';
      readonly permission: CommandPermissionSnapshotV1;
    }
  | {
      readonly type: 'approve_for_conversation';
      readonly permission: CommandPermissionSnapshotV1;
      readonly candidate: CommandConversationApprovalCandidate;
      readonly approvedCwd: string;
      readonly requires_persistence: true;
    };

export type CommandApprovalReplyAcceptance =
  | {
      readonly status: 'accepted';
      readonly decision: CommandApprovalReplyDecision;
    }
  | {
      readonly status: 'rejected';
      readonly code:
        | 'request_mismatch'
        | 'choice_not_available'
        | 'permission_not_approvable';
    };

export type CommandApprovalState =
  | {
      readonly status: 'pending';
      readonly request: CommandApprovalRequestV1;
    }
  | {
      readonly status: 'settled';
      readonly request: CommandApprovalRequestV1;
      readonly settlement: CommandApprovalSettlementV1;
    };

export type CommandApprovalSettlementAdvance =
  | {
      readonly status: 'accepted';
      readonly state: Extract<CommandApprovalState, { status: 'settled' }>;
    }
  | {
      readonly status: 'stale';
      readonly state: CommandApprovalState;
      readonly code:
        | 'already_settled'
        | 'request_mismatch'
        | 'proposal_mismatch'
        | 'settlement_not_applicable'
        | 'permission_snapshot_mismatch';
    };

export interface CommandApprovalReplyContext {
  readonly request: CommandApprovalRequestV1;
  readonly reply: CommandApprovalReplyV1;
}
