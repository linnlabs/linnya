import type {
  CommandCardAuditStatus,
  CommandCardExecutionSettlementV1,
  CommandExecutionOwnerBindingV1,
  CommandExecutionTerminalV1,
} from '@app/schemas/commands';

export interface CommandCardSettlementRecordInput {
  readonly binding: CommandExecutionOwnerBindingV1;
  readonly startedAtMs: number;
  readonly auditStatus: CommandCardAuditStatus;
  readonly terminal: CommandExecutionTerminalV1;
}

export type CommandCardSettlementRecordResult =
  | { readonly status: 'recorded'; readonly settlement: CommandCardExecutionSettlementV1 }
  | { readonly status: 'already_recorded'; readonly settlement: CommandCardExecutionSettlementV1 }
  | { readonly status: 'conflict' };

export type CommandCardSettlementAuditMarkResult =
  | { readonly status: 'updated'; readonly settlement: CommandCardExecutionSettlementV1 }
  | { readonly status: 'terminal_not_recorded' }
  | { readonly status: 'conflict' };

/** UI-only 终态旁路；不能写 RuntimeEvent，也不能进入 Agent 上下文。 */
export interface CommandCardSettlementPort {
  recordTerminal(input: CommandCardSettlementRecordInput): Promise<CommandCardSettlementRecordResult>;
  markAuditIncomplete(
    binding: CommandExecutionOwnerBindingV1,
  ): Promise<CommandCardSettlementAuditMarkResult>;
  listForConversation(conversationId: string): Promise<readonly CommandCardExecutionSettlementV1[]>;
  deleteForConversation(conversationId: string): Promise<void>;
}
