import { defineStore } from 'pinia';
import type { ConversationAttachmentRef, ConversationImageAttachmentErrorCode } from '@app/schemas';
import type { ConversationImageDraftItem } from '../definitions/conversationImageAttachmentDraft';
import type {
  ConversationImageEditOrderItem,
  ConversationImageEditSessionState,
} from '../definitions/conversationImageEditSession';

export const useConversationImageEditSessionStore = defineStore('conversationImageEditSession', {
  state: (): ConversationImageEditSessionState => ({
    messageId: null,
    existingAttachments: [],
    draftItems: [],
    order: [],
    isSubmitting: false,
    errorCode: null,
  }),
  actions: {
    start(messageId: string, attachments: readonly ConversationAttachmentRef[]): void {
      this.messageId = messageId;
      this.existingAttachments = [...attachments];
      this.draftItems = [];
      this.order = attachments.map(attachment => ({
        source: 'existing' as const,
        attachmentId: attachment.id,
      }));
      this.isSubmitting = false;
      this.errorCode = null;
    },
    appendUploading(item: Extract<ConversationImageDraftItem, { status: 'uploading' }>): void {
      this.draftItems.push(item);
      this.order.push({ source: 'draft', clientId: item.clientId });
      this.errorCode = null;
    },
    markUploading(clientId: string): void {
      const item = this.draftItems.find(candidate => candidate.clientId === clientId);
      if (!item) return;
      this.draftItems.splice(this.draftItems.indexOf(item), 1, { ...item, status: 'uploading' });
    },
    markReady(clientId: string, staged: Extract<ConversationImageDraftItem, { status: 'ready' }>['staged']): void {
      const item = this.draftItems.find(candidate => candidate.clientId === clientId);
      if (!item) return;
      this.draftItems.splice(this.draftItems.indexOf(item), 1, { ...item, status: 'ready', staged });
    },
    markFailed(clientId: string, errorCode: ConversationImageAttachmentErrorCode): void {
      const item = this.draftItems.find(candidate => candidate.clientId === clientId);
      if (!item) return;
      this.draftItems.splice(this.draftItems.indexOf(item), 1, { ...item, status: 'failed', errorCode });
    },
    remove(clientId: string): void {
      this.draftItems = this.draftItems.filter(item => item.clientId !== clientId);
      this.order = this.order.filter(item => item.source !== 'draft' || item.clientId !== clientId);
    },
    clearDraftItems(): void {
      this.draftItems = [];
    },
    removeExisting(attachmentId: string): void {
      this.order = this.order.filter(item => item.source !== 'existing' || item.attachmentId !== attachmentId);
    },
    move(item: ConversationImageEditOrderItem, offset: -1 | 1): void {
      const index = this.order.findIndex(candidate => (
        candidate.source === item.source
        && (candidate.source === 'existing'
          ? candidate.attachmentId === (item.source === 'existing' ? item.attachmentId : '')
          : candidate.clientId === (item.source === 'draft' ? item.clientId : ''))
      ));
      const target = index + offset;
      if (index < 0 || target < 0 || target >= this.order.length) return;
      const next = [...this.order];
      [next[index], next[target]] = [next[target], next[index]];
      this.order = next;
    },
    setSubmitting(value: boolean): void {
      this.isSubmitting = value;
    },
    setErrorCode(code: ConversationImageAttachmentErrorCode | null): void {
      this.errorCode = code;
    },
    clear(): void {
      this.messageId = null;
      this.existingAttachments = [];
      this.draftItems = [];
      this.order = [];
      this.isSubmitting = false;
      this.errorCode = null;
    },
  },
});
