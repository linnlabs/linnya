import type { ConversationControlErrorCode } from '@app/schemas';

export class ConversationControlError extends Error {
  constructor(
    readonly code: ConversationControlErrorCode,
    message: string,
    readonly retryable = false,
  ) {
    super(message);
    this.name = 'ConversationControlError';
  }
}
