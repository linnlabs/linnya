import type {
  ConversationDirectoryCleanupFailure,
  ConversationDirectoryCleanupJob,
  ConversationDirectoryCleanupJobBeginResult,
  ConversationDirectoryCleanupJobScope,
} from '../definitions/conversationDirectoryCleanupJob';

export interface ConversationDirectoryCleanupJobPort {
  begin(job: ConversationDirectoryCleanupJob): Promise<ConversationDirectoryCleanupJobBeginResult>;
  read(
    conversationId: ConversationDirectoryCleanupJob['conversationId'],
  ): Promise<ConversationDirectoryCleanupJob | null>;
  list(): Promise<readonly ConversationDirectoryCleanupJob[]>;
  recordFailure(input: ConversationDirectoryCleanupJobScope & {
    readonly failure: ConversationDirectoryCleanupFailure;
  }): Promise<ConversationDirectoryCleanupJob | null>;
  complete(scope: ConversationDirectoryCleanupJobScope): Promise<boolean>;
}
