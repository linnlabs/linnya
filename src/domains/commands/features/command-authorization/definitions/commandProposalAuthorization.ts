import type {
  CommandApprovalRequestId,
  CommandApprovalSettlementV1,
  CommandPermissionSnapshotV1,
  CommandPresentationPermissionSource,
} from '@app/schemas/commands';

import type { CommandAuthorizationRuntimeContext } from '../../../definitions/commandAuthorization';

export interface CommandAuthorizationApprovalFact {
  /**
   * 这是审批 host 已经接受的真实结算，不是为审计重新推导的副本。保留它是为了让
   * 后续执行、审计和诊断继续引用同一个 request identity，尤其不能丢失 allow_once。
   */
  readonly settlement: CommandApprovalSettlementV1;
}

export type CommandProposalAuthorization = (
  | {
      readonly status: 'authorized';
      readonly context: CommandAuthorizationRuntimeContext;
      readonly permission: CommandPermissionSnapshotV1;
      readonly presentationSource: CommandPresentationPermissionSource;
      readonly approvalRequestId?: CommandApprovalRequestId;
      readonly persistedApproval?: {
        readonly approvalRequestId: CommandApprovalRequestId;
        readonly created: boolean;
      };
    }
  | {
      readonly status: 'rejected';
      readonly code: 'approval_denied' | 'permission_unavailable';
    }
) & {
  readonly approval?: CommandAuthorizationApprovalFact;
};
