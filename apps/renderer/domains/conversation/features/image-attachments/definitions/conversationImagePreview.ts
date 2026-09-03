import type {
  ConversationAttachmentRef,
  ConversationImageAttachmentErrorCode,
} from '@app/schemas';

export type ConversationImagePreviewErrorCode = Extract<
  ConversationImageAttachmentErrorCode,
  | 'conversation.image.asset_not_found'
  | 'conversation.image.asset_integrity_failed'
  | 'conversation.image.preview_failed'
>;

interface ConversationImagePreviewItemBase {
  readonly attachment: ConversationAttachmentRef;
}

export type ConversationImagePreviewItem =
  | (ConversationImagePreviewItemBase & { readonly status: 'loading' })
  | (ConversationImagePreviewItemBase & {
      readonly status: 'ready';
      readonly objectUrl: string;
    })
  | (ConversationImagePreviewItemBase & {
      readonly status: 'error';
      readonly errorCode: ConversationImagePreviewErrorCode;
    });

export class ConversationImagePreviewApiError extends Error {
  readonly name = 'ConversationImagePreviewApiError';

  constructor(readonly code: ConversationImagePreviewErrorCode) {
    super(code);
  }
}
