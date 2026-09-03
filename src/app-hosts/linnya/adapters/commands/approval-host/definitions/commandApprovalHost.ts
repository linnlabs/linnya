import type {
  CommandApprovalPageSnapshotV1,
  CommandApprovalPageTicket,
  CommandApprovalReplyResultV1,
  CommandApprovalReplySubmissionV1,
} from '@app/schemas/commands';
import type { CommandApprovalPort } from 'src/domains/commands';

export type CommandApprovalRendererOwnerId = number;

export interface CommandApprovalRendererPagePort {
  openRendererPage(ownerId: CommandApprovalRendererOwnerId): CommandApprovalPageSnapshotV1 | undefined;
  readRendererPage(input: {
    readonly ownerId: CommandApprovalRendererOwnerId;
    readonly pageTicket: CommandApprovalPageTicket;
  }): CommandApprovalPageSnapshotV1 | undefined;
  invalidateRendererPage(input: {
    readonly ownerId: CommandApprovalRendererOwnerId;
    readonly pageTicket: CommandApprovalPageTicket;
  }): void;
  submitRendererReply(input: {
    readonly ownerId: CommandApprovalRendererOwnerId;
    readonly submission: CommandApprovalReplySubmissionV1;
  }): CommandApprovalReplyResultV1;
  subscribe(listener: () => void): () => void;
}

/** Desktop IPC 只依赖异步 gateway；本地与跨进程实现共享同一调用合同。 */
export interface CommandApprovalRendererGatewayPort {
  openRendererPage(ownerId: CommandApprovalRendererOwnerId): Promise<CommandApprovalPageSnapshotV1 | undefined>;
  readRendererPage(input: {
    readonly ownerId: CommandApprovalRendererOwnerId;
    readonly pageTicket: CommandApprovalPageTicket;
  }): Promise<CommandApprovalPageSnapshotV1 | undefined>;
  invalidateRendererPage(input: {
    readonly ownerId: CommandApprovalRendererOwnerId;
    readonly pageTicket: CommandApprovalPageTicket;
  }): void;
  submitRendererReply(input: {
    readonly ownerId: CommandApprovalRendererOwnerId;
    readonly submission: CommandApprovalReplySubmissionV1;
  }): Promise<CommandApprovalReplyResultV1>;
  subscribe(listener: () => void): () => void;
}

export interface CommandApprovalHost
  extends CommandApprovalPort, CommandApprovalRendererPagePort {
  endOwner(): void;
}
