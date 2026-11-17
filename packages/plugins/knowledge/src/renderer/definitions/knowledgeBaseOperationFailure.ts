import type { UserFacingMessage } from '@app/schemas';

export interface KnowledgeBaseOperationFailure {
  readonly error: string;
  readonly userMessage?: UserFacingMessage;
}
