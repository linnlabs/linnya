import type {
  ConversationAttachmentRef,
  ConversationAttachmentSelection,
  ConversationImageAttachmentErrorCode,
} from '@app/schemas';
import type { ConversationImageDraftItem } from './conversationImageAttachmentDraft';

export type ConversationImageEditOrderItem =
  | { readonly source: 'existing'; readonly attachmentId: string }
  | { readonly source: 'draft'; readonly clientId: string };

export interface ConversationImageEditSessionState {
  messageId: string | null;
  existingAttachments: ConversationAttachmentRef[];
  draftItems: ConversationImageDraftItem[];
  order: ConversationImageEditOrderItem[];
  isSubmitting: boolean;
  errorCode: ConversationImageAttachmentErrorCode | null;
}

export type ConversationImageEditSubmission = {
  readonly selection: Extract<ConversationAttachmentSelection, { mode: 'replace' }>;
};
