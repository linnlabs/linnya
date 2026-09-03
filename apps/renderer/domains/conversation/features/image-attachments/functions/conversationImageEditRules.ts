import {
  CONVERSATION_IMAGE_MAX_ATTACHMENTS,
  CONVERSATION_IMAGE_MAX_TOTAL_BYTES,
  type ConversationAttachmentSelection,
} from '@app/schemas';
import type {
  ConversationImageEditSessionState,
  ConversationImageEditSubmission,
} from '../definitions/conversationImageEditSession';

export function validateConversationImageEditAddition(
  state: ConversationImageEditSessionState,
  files: readonly File[],
): 'conversation.image.too_many_attachments' | 'conversation.image.total_bytes_exceeded' | null {
  if (state.order.length + files.length > CONVERSATION_IMAGE_MAX_ATTACHMENTS) {
    return 'conversation.image.too_many_attachments';
  }
  const existingBytes = state.order.reduce((total, item) => {
    if (item.source !== 'existing') return total;
    return total + (state.existingAttachments.find(candidate => candidate.id === item.attachmentId)?.byteLength ?? 0);
  }, 0);
  const draftBytes = state.draftItems.reduce((total, item) => total + item.byteLength, 0);
  const addedBytes = files.reduce((total, file) => total + file.size, 0);
  return existingBytes + draftBytes + addedBytes > CONVERSATION_IMAGE_MAX_TOTAL_BYTES
    ? 'conversation.image.total_bytes_exceeded'
    : null;
}

export function buildConversationImageEditSubmission(
  state: ConversationImageEditSessionState,
): ConversationImageEditSubmission | null {
  if (state.messageId === null || state.draftItems.some(item => item.status !== 'ready')) return null;
  const selection: Extract<ConversationAttachmentSelection, { mode: 'replace' }> = {
    mode: 'replace',
    items: state.order.map(item => {
      if (item.source === 'existing') {
        return { source: 'existing', attachmentId: item.attachmentId };
      }
      const draftItem = state.draftItems.find(candidate => candidate.clientId === item.clientId);
      if (!draftItem || draftItem.status !== 'ready') {
        throw new Error('[conversation-image-edit] order 引用了未就绪的 draft');
      }
      return { source: 'draft', draft: draftItem.staged.draft };
    }),
  };
  return { selection };
}

export function hasConversationImageSelectionChanged(
  state: ConversationImageEditSessionState,
  selection: Extract<ConversationAttachmentSelection, { mode: 'replace' }>,
): boolean {
  const originalIds = state.existingAttachments.map(attachment => attachment.id);
  if (selection.items.length !== originalIds.length) return true;
  return selection.items.some((item, index) => (
    item.source !== 'existing' || item.attachmentId !== originalIds[index]
  ));
}
