import type {
  ConversationDraftAttachmentRef,
  ConversationImageAttachmentErrorCode,
  ConversationImageDraftStageResponse,
} from '@app/schemas';

interface ConversationImageDraftItemBase {
  readonly clientId: string;
  readonly fileName: string;
  readonly byteLength: number;
  /** 仅存在于当前 Renderer 进程；不会持久化或发送给 host。 */
  readonly previewUrl: string;
}

export interface ConversationImageUploadingDraftItem extends ConversationImageDraftItemBase {
  readonly status: 'uploading';
}

export interface ConversationImageReadyDraftItem extends ConversationImageDraftItemBase {
  readonly status: 'ready';
  readonly staged: ConversationImageDraftStageResponse;
}

export interface ConversationImageFailedDraftItem extends ConversationImageDraftItemBase {
  readonly status: 'failed';
  readonly errorCode: ConversationImageAttachmentErrorCode;
}

export type ConversationImageDraftItem =
  | ConversationImageUploadingDraftItem
  | ConversationImageReadyDraftItem
  | ConversationImageFailedDraftItem;

export type ConversationImageDraftAdditionResult =
  | { readonly kind: 'accepted'; readonly clientIds: readonly string[] }
  | {
      readonly kind: 'rejected';
      readonly code:
        | 'conversation.image.too_many_attachments'
        | 'conversation.image.total_bytes_exceeded';
    };

export interface ConversationImageDraftSubmissionSnapshot {
  readonly attachments: readonly ConversationDraftAttachmentRef[];
}

export interface ConversationImageDraftRuntime {
  readonly file: File;
  readonly previewUrl: string;
  abortController: AbortController;
  draftId?: string;
}

export class ConversationImageAttachmentApiError extends Error {
  readonly name = 'ConversationImageAttachmentApiError';

  constructor(readonly code: ConversationImageAttachmentErrorCode) {
    super(code);
  }
}
