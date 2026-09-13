import type {
  CommandApprovalChoice,
  CommandApprovalPendingProjectionV1,
  CommandApprovalRequestId,
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

export interface CommandApprovalHostPresenterSnapshot {
  readonly pending: readonly CommandApprovalPendingProjectionV1[];
}

export interface CommandApprovalHostPresenterPort {
  enableHostPresenter(): void;
  readHostPresenter(): CommandApprovalHostPresenterSnapshot | undefined;
  submitHostReply(input: {
    readonly approvalRequestId: CommandApprovalRequestId;
    readonly choice: CommandApprovalChoice;
  }): { readonly status: 'accepted' | 'stale' | 'unavailable' };
  subscribe(listener: () => void): () => void;
}

export interface CommandApprovalHostPresenterGatewayPort {
  read(): Promise<CommandApprovalHostPresenterSnapshot | undefined>;
  submit(input: {
    readonly approvalRequestId: CommandApprovalRequestId;
    readonly choice: CommandApprovalChoice;
  }): Promise<{ readonly status: 'accepted' | 'stale' | 'unavailable' }>;
  subscribe(listener: () => void): () => void;
}

export interface CommandApprovalHost
  extends CommandApprovalPort, CommandApprovalRendererPagePort,
    CommandApprovalHostPresenterPort {
  endOwner(): void;
}
