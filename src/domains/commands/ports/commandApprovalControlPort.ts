import type {
  CommandApprovalChoice,
  CommandApprovalPendingProjectionV1,
  CommandApprovalRequestId,
} from '@app/schemas/commands';

/** 外部控制端复用同一审批 owner；不创建页面票据，也不直接授予命令权限。 */
export interface CommandApprovalControlPort {
  readControlPending(conversationId: string): readonly CommandApprovalPendingProjectionV1[] | undefined;
  submitControlReply(input: {
    readonly conversationId: string;
    readonly runId: string;
    readonly approvalRequestId: CommandApprovalRequestId;
    readonly choice: CommandApprovalChoice;
  }): { readonly status: 'accepted' | 'stale' | 'unavailable' };
}

/** 只有已鉴权控制端的组合根可以声明入口可用；查询或回复本身不能注册新展示端。 */
export interface CommandApprovalControlEndpointPort extends CommandApprovalControlPort {
  setControlEndpointAvailable(available: boolean): void;
}
