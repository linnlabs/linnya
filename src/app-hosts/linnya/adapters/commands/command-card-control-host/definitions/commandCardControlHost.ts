import type {
  CommandCardCancelResultV1,
  CommandCardCancelSubmissionV1,
  CommandCardControlPageSnapshotV1,
  CommandCardControlPageTicket,
  CommandProtectedInputResultV1,
  CommandProtectedInputSubmissionV1,
  CommandExecutionOwnerBindingV1,
} from '@app/schemas/commands';
import type {
  CommandCardSettlementPort,
  CommandExecutionLifecycleObservationPort,
  CommandProcessControlPort,
} from 'src/domains/commands';
import type { CommandExecutionAuditPort } from 'src/domains/audit/features/command-execution-audit';

export interface CommandCardRendererControlPort {
  openRendererPage(ownerId: number, conversationId: string): Promise<CommandCardControlPageSnapshotV1 | undefined>;
  readRendererPage(input: {
    readonly ownerId: number;
    readonly pageTicket: CommandCardControlPageTicket;
  }): Promise<CommandCardControlPageSnapshotV1 | undefined>;
  invalidateRendererPage(input: {
    readonly ownerId: number;
    readonly pageTicket: CommandCardControlPageTicket;
  }): void;
  cancel(input: {
    readonly ownerId: number;
    readonly submission: CommandCardCancelSubmissionV1;
  }): Promise<CommandCardCancelResultV1>;
  submitProtectedInput(input: {
    readonly ownerId: number;
    readonly submission: CommandProtectedInputSubmissionV1;
  }): Promise<CommandProtectedInputResultV1>;
  subscribe(listener: () => void): () => void;
}

/** Desktop IPC 的异步调用面；本地与 App Server RPC adapter 必须实现相同语义。 */
export interface CommandCardRendererGatewayPort {
  openRendererPage(ownerId: number, conversationId: string): Promise<CommandCardControlPageSnapshotV1 | undefined>;
  readRendererPage(input: {
    readonly ownerId: number;
    readonly pageTicket: CommandCardControlPageTicket;
  }): Promise<CommandCardControlPageSnapshotV1 | undefined>;
  invalidateRendererPage(input: {
    readonly ownerId: number;
    readonly pageTicket: CommandCardControlPageTicket;
  }): void;
  cancel(input: {
    readonly ownerId: number;
    readonly submission: CommandCardCancelSubmissionV1;
  }): Promise<CommandCardCancelResultV1>;
  submitProtectedInput(input: {
    readonly ownerId: number;
    readonly submission: CommandProtectedInputSubmissionV1;
  }): Promise<CommandProtectedInputResultV1>;
  subscribe(listener: () => void): () => void;
}

export interface CommandCardControlHost extends CommandCardRendererControlPort {
  bindRuntime(input: {
    readonly control: CommandProcessControlPort;
    readonly lifecycle: CommandExecutionLifecycleObservationPort;
    readonly settlements: CommandCardSettlementPort;
    readonly audit: CommandExecutionAuditPort;
  }): void;
  reportAuditFailure(input: {
    readonly binding: CommandExecutionOwnerBindingV1;
  }): void;
  hasAuditFailure(binding: CommandExecutionOwnerBindingV1): boolean;
  drainProtectedInputs(): Promise<void>;
  drainConversation(conversationId: string): Promise<void>;
  deleteConversationSettlements(conversationId: string): Promise<void>;
  endAndDrain(): Promise<void>;
}
