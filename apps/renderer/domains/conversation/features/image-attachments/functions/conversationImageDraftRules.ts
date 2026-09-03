import {
  CONVERSATION_IMAGE_MAX_ATTACHMENTS,
  CONVERSATION_IMAGE_MAX_TOTAL_BYTES,
  type ConversationDraftAttachmentRef,
} from '@app/schemas';
import type {
  ConversationImageDraftItem,
  ConversationImageDraftSubmissionSnapshot,
} from '../definitions/conversationImageAttachmentDraft';

export function validateConversationImageDraftAddition(
  currentItems: readonly ConversationImageDraftItem[],
  files: readonly File[],
): 'conversation.image.too_many_attachments' | 'conversation.image.total_bytes_exceeded' | null {
  if (currentItems.length + files.length > CONVERSATION_IMAGE_MAX_ATTACHMENTS) {
    return 'conversation.image.too_many_attachments';
  }
  const currentBytes = currentItems.reduce((total, item) => total + item.byteLength, 0);
  const addedBytes = files.reduce((total, file) => total + file.size, 0);
  return currentBytes + addedBytes > CONVERSATION_IMAGE_MAX_TOTAL_BYTES
    ? 'conversation.image.total_bytes_exceeded'
    : null;
}

export function createConversationImageDraftSubmissionSnapshot(
  items: readonly ConversationImageDraftItem[],
): ConversationImageDraftSubmissionSnapshot {
  const attachments: ConversationDraftAttachmentRef[] = [];
  for (const item of items) {
    if (item.status === 'ready') attachments.push(item.staged.draft);
  }
  return { attachments };
}

export function hasBlockingConversationImageDraft(
  items: readonly ConversationImageDraftItem[],
): boolean {
  return items.some(item => item.status !== 'ready');
}

export type ConversationImageSubmitBlockReason =
  | 'empty_input'
  | 'draft_pending'
  | 'draft_failed'
  | 'model_unsupported'
  | 'extension_unsupported';

export type ConversationImageSubmitPreflight =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: ConversationImageSubmitBlockReason };

/** 普通 composer 的发送规则只有这一处，UI 与 submit handler 必须消费同一结果。 */
export function resolveConversationImageSubmitPreflight(input: {
  readonly text: string;
  readonly items: readonly ConversationImageDraftItem[];
  readonly activeModelAcceptsUserImages: boolean;
  readonly extensionAcceptsAttachments: boolean;
}): ConversationImageSubmitPreflight {
  const hasImages = input.items.length > 0;
  if (!input.text.trim() && !hasImages) return { ok: false, reason: 'empty_input' };
  if (input.items.some(item => item.status === 'uploading')) {
    return { ok: false, reason: 'draft_pending' };
  }
  if (input.items.some(item => item.status === 'failed')) {
    return { ok: false, reason: 'draft_failed' };
  }
  if (hasImages && !input.extensionAcceptsAttachments) {
    return { ok: false, reason: 'extension_unsupported' };
  }
  if (hasImages && !input.activeModelAcceptsUserImages) {
    return { ok: false, reason: 'model_unsupported' };
  }
  return { ok: true };
}
