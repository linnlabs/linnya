import type {
  CommandExecutionOwnerBindingV1,
  CommandExecutionTerminalV1,
} from '@app/schemas/commands';

export type CommandExecutionLifecycleEvent =
  | { readonly type: 'handle_published'; readonly binding: CommandExecutionOwnerBindingV1 }
  | {
      readonly type: 'terminal_settled';
      readonly binding: CommandExecutionOwnerBindingV1;
      readonly startedAtMs: number;
      readonly terminal: CommandExecutionTerminalV1;
    }
  | { readonly type: 'conversation_stopping'; readonly conversationId: string }
  | { readonly type: 'conversation_forgotten'; readonly conversationId: string }
  | { readonly type: 'owner_ending' };

export interface CommandExecutionLifecycleObservationPort {
  subscribeExecutionLifecycle(
    listener: (event: CommandExecutionLifecycleEvent) => void,
  ): () => void;
}
