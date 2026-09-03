export class ConversationAttachmentPublishError extends Error {
  readonly name = 'ConversationAttachmentPublishError';

  constructor(readonly code: 'content_address_conflict') {
    super(code);
  }
}
