import type {
  CommandApprovalReplyV1,
  CommandApprovalRequestV1,
  CommandApprovalSettlementV1,
} from '@app/schemas/commands';

export type CommandApprovalResponse =
  | {
      readonly status: 'replied';
      readonly reply: CommandApprovalReplyV1;
    }
  | {
      readonly status: 'invalidated';
      readonly reason: 'run_cancelled' | 'owner_ended';
    }
  | {
      readonly status: 'failed';
      readonly reason: 'authorization_unavailable';
    };

/**
 * Electron pending host 的窄业务口。renderer 只提交 reply；批准记忆仍由 Commands
 * orchestration 持久化，并在成功后通过 settlement 关闭同一 pending 请求。
 */
export interface CommandApprovalPort {
  request(input: {
    readonly request: CommandApprovalRequestV1;
    readonly abortSignal?: AbortSignal;
  }): Promise<CommandApprovalResponse>;
  settle(settlement: CommandApprovalSettlementV1): Promise<void>;
}
