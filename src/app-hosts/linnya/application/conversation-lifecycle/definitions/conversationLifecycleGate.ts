import type {
  ConversationWorkDirectoryConversationId,
} from '../../../../../domains/conversation-files';

export type ConversationLifecycleOperation =
  | 'conversation_admission'
  | 'directory_cleanup_job';

export interface ConversationLifecycleGateScope {
  readonly conversationId: ConversationWorkDirectoryConversationId;
  readonly operation: ConversationLifecycleOperation;
}

export interface ConversationLifecycleGate {
  runExclusive<T>(input: {
    readonly scope: ConversationLifecycleGateScope;
    readonly run: () => Promise<T> | T;
  }): Promise<T>;
}
