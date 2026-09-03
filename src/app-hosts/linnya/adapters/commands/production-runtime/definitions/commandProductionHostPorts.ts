import type { CommandExecutionOwnerBindingV1 } from '@app/schemas/commands';
import type {
  CommandApprovalPort,
  CommandCardSettlementPort,
  CommandExecutionLifecycleObservationPort,
  CommandProcessControlPort,
} from 'src/domains/commands';
import type {
  CommandExecutionAuditPort,
} from 'src/domains/audit/features/command-execution-audit';

/** Commands 只需要审批宿主的业务 port 和 App owner 收口，不感知 Renderer page。 */
export interface CommandApprovalHostPort extends CommandApprovalPort {
  endOwner(): void;
}

/**
 * 命令卡片/受保护输入在宿主侧的窄边界。Electron IPC page 是其当前 adapter，
 * 但 Commands composition 不应知道 Electron owner id、WebContents 或 IPC ticket。
 */
export interface CommandExecutionPresentationHostPort {
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
